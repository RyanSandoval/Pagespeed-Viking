#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, applyCliOptions, validateConfig } from './config.js';
import { fetchSitemapForOrigin } from './sitemap.js';
import { categorizeUrls } from './categorize.js';
import {
  sampleByPageType,
  sampleByPropertyAndPageType,
  flattenSamples,
  flattenNestedSamples,
} from './sample.js';
import { fetchCrUXData } from './crux.js';
import { fetchPSIDataForUrls, calculateAverages } from './psi.js';
import {
  buildReport,
  buildPageTypeSamples,
  saveReport,
  printSummary,
} from './report.js';
import type {
  CLIOptions,
  CrUXData,
  OriginReport,
  PageType,
  PageTypeSamples,
  PSIResult,
} from './types.js';

const program = new Command();

program
  .name('viking-cwv')
  .description('Core Web Vitals scorecard generator for Viking web properties')
  .version('1.0.0')
  .option('-s, --samples <number>', 'Number of samples per page type', '5')
  .option('--crux-only', 'Only fetch CrUX data, skip PSI sampling')
  .option('-p, --property <name>', 'Only analyze a specific property')
  .option(
    '-f, --format <format>',
    'Output format: json, markdown, or both',
    'both'
  )
  .option('-v, --verbose', 'Show verbose output')
  .option('-c, --config <path>', 'Path to config file')
  .action(run);

async function run(options: {
  samples: string;
  cruxOnly?: boolean;
  property?: string;
  format: string;
  verbose?: boolean;
  config?: string;
}) {
  const cliOptions: CLIOptions = {
    samples: parseInt(options.samples, 10),
    cruxOnly: options.cruxOnly,
    property: options.property,
    format: options.format as 'json' | 'markdown' | 'both',
    verbose: options.verbose,
    config: options.config,
  };

  console.log(chalk.bold.blue('\n🚢 Viking Core Web Vitals Analyzer\n'));

  // Load and validate config
  let config = loadConfig(cliOptions.config);
  config = applyCliOptions(config, cliOptions);

  try {
    validateConfig(config, cliOptions.cruxOnly || false);
  } catch (error) {
    console.error(
      chalk.red(`Configuration error: ${error instanceof Error ? error.message : error}`)
    );
    process.exit(1);
  }

  const cruxDataMap = new Map<string, CrUXData>();
  const originReports = new Map<string, OriginReport>();

  // Get unique origins for CrUX
  const uniqueOrigins = [...new Set(config.origins.map((o) => o.origin))];

  // Step 1: Fetch CrUX data
  const cruxSpinner = ora('Fetching CrUX field data...').start();

  for (const originUrl of uniqueOrigins) {
    try {
      const origin = config.origins.find((o) => o.origin === originUrl);
      if (!origin) continue;

      if (cliOptions.verbose) {
        cruxSpinner.text = `Fetching CrUX data for ${originUrl}...`;
      }

      const cruxData = await fetchCrUXData(originUrl, config.apiKey!);
      cruxDataMap.set(originUrl, cruxData);
    } catch (error) {
      if (cliOptions.verbose) {
        console.warn(
          chalk.yellow(
            `\n  Warning: Failed to fetch CrUX data for ${originUrl}`
          )
        );
      }
      cruxDataMap.set(originUrl, { overall: 'FAIL' });
    }
  }

  cruxSpinner.succeed(`Fetched CrUX data for ${uniqueOrigins.length} origins`);

  // If crux-only, skip the rest
  if (cliOptions.cruxOnly) {
    // Build minimal report with just CrUX data
    for (const origin of config.origins) {
      const cruxData = cruxDataMap.get(origin.origin) || { overall: 'FAIL' };
      originReports.set(origin.origin, {
        name: origin.name,
        crux: cruxData,
        samples: {},
      });
    }

    const report = buildReport(cruxDataMap, originReports);
    printSummary(report);

    const paths = saveReport(report, config.outputDir, cliOptions.format);
    console.log(chalk.green('Reports saved:'));
    if (paths.jsonPath) console.log(`  JSON: ${paths.jsonPath}`);
    if (paths.markdownPath) console.log(`  Markdown: ${paths.markdownPath}`);

    return;
  }

  // Step 2: Fetch sitemaps and categorize URLs
  const sitemapSpinner = ora('Fetching sitemaps...').start();

  const originSamples = new Map<
    string,
    {
      samples: Record<PageType, string[]> | Record<string, Record<PageType, string[]>>;
      isNested: boolean;
    }
  >();

  for (const origin of config.origins) {
    if (origin.cruxOnly) continue;

    if (cliOptions.verbose) {
      sitemapSpinner.text = `Fetching sitemap for ${origin.name}...`;
    }

    try {
      const urls = await fetchSitemapForOrigin(origin, cliOptions.verbose);
      const categorized = categorizeUrls(urls, origin.pathFilter);

      // Determine if we need nested sampling (for vikingcruises.com with Ocean/Expedition)
      const hasSubProperties = categorized.some((u) => u.property);

      if (hasSubProperties) {
        const samples = sampleByPropertyAndPageType(
          categorized,
          config.samplesPerType
        );
        originSamples.set(origin.origin + (origin.pathFilter || ''), {
          samples,
          isNested: true,
        });
      } else {
        const samples = sampleByPageType(categorized, config.samplesPerType);
        originSamples.set(origin.origin, {
          samples,
          isNested: false,
        });
      }
    } catch (error) {
      if (cliOptions.verbose) {
        console.warn(
          chalk.yellow(
            `\n  Warning: Failed to fetch sitemap for ${origin.name}`
          )
        );
      }
    }
  }

  sitemapSpinner.succeed(
    `Fetched and categorized URLs from ${originSamples.size} sitemaps`
  );

  // Step 3: Run PSI analysis on sampled URLs
  const psiSpinner = ora('Running PageSpeed Insights analysis...').start();

  const psiResults = new Map<string, Map<string, PSIResult[]>>();

  for (const origin of config.origins) {
    if (origin.cruxOnly) continue;

    const key = origin.origin + (origin.pathFilter || '');
    const sampleData = originSamples.get(key);

    if (!sampleData) continue;

    const originPsiResults = new Map<string, PSIResult[]>();

    if (sampleData.isNested) {
      // Nested samples (property -> pageType -> urls)
      const nestedSamples = sampleData.samples as Record<
        string,
        Record<PageType, string[]>
      >;

      for (const [property, pageTypes] of Object.entries(nestedSamples)) {
        for (const [pageType, urls] of Object.entries(pageTypes)) {
          if (urls.length === 0) continue;

          if (cliOptions.verbose) {
            psiSpinner.text = `Analyzing ${origin.name} ${property} ${pageType} (${urls.length} URLs)...`;
          }

          const results = await fetchPSIDataForUrls(urls, config.apiKey!, {
            strategy: config.strategy,
            delayBetweenRequests: config.delayBetweenRequests,
            onProgress: (current, total, url) => {
              if (cliOptions.verbose) {
                psiSpinner.text = `[${current}/${total}] ${url}`;
              }
            },
          });

          originPsiResults.set(`${property}:${pageType}`, results);
        }
      }
    } else {
      // Flat samples (pageType -> urls)
      const flatSamples = sampleData.samples as Record<PageType, string[]>;

      for (const [pageType, urls] of Object.entries(flatSamples)) {
        if (urls.length === 0) continue;

        if (cliOptions.verbose) {
          psiSpinner.text = `Analyzing ${origin.name} ${pageType} (${urls.length} URLs)...`;
        }

        const results = await fetchPSIDataForUrls(urls, config.apiKey!, {
          strategy: config.strategy,
          delayBetweenRequests: config.delayBetweenRequests,
          onProgress: (current, total, url) => {
            if (cliOptions.verbose) {
              psiSpinner.text = `[${current}/${total}] ${url}`;
            }
          },
        });

        originPsiResults.set(pageType, results);
      }
    }

    psiResults.set(key, originPsiResults);
  }

  psiSpinner.succeed('PageSpeed Insights analysis complete');

  // Step 4: Build origin reports
  for (const origin of config.origins) {
    const cruxData = cruxDataMap.get(origin.origin) || { overall: 'FAIL' };

    if (origin.cruxOnly) {
      originReports.set(origin.origin, {
        name: origin.name,
        crux: cruxData,
        samples: {},
      });
      continue;
    }

    const key = origin.origin + (origin.pathFilter || '');
    const sampleData = originSamples.get(key);
    const originPsiResults = psiResults.get(key);

    if (!sampleData || !originPsiResults) {
      originReports.set(origin.origin, {
        name: origin.name,
        crux: cruxData,
        samples: {},
      });
      continue;
    }

    if (sampleData.isNested) {
      // Build nested samples structure
      const nestedSamples: Record<string, Record<string, PageTypeSamples>> = {};

      for (const [resultKey, results] of originPsiResults.entries()) {
        const [property, pageType] = resultKey.split(':');

        if (!nestedSamples[property]) {
          nestedSamples[property] = {};
        }

        nestedSamples[property][pageType] = buildPageTypeSamples(
          results,
          pageType as PageType
        );
      }

      // Use the full key for origins with path filters
      const reportKey = origin.pathFilter
        ? `${origin.origin}${origin.pathFilter}`
        : origin.origin;

      originReports.set(reportKey, {
        name: origin.name,
        crux: cruxData,
        samples: nestedSamples,
      });
    } else {
      // Build flat samples structure
      const flatSamples: Record<string, PageTypeSamples> = {};

      for (const [pageType, results] of originPsiResults.entries()) {
        flatSamples[pageType] = buildPageTypeSamples(
          results,
          pageType as PageType
        );
      }

      originReports.set(origin.origin, {
        name: origin.name,
        crux: cruxData,
        samples: flatSamples,
      });
    }
  }

  // Step 5: Generate and save report
  const report = buildReport(cruxDataMap, originReports);
  printSummary(report);

  const paths = saveReport(report, config.outputDir, cliOptions.format);
  console.log(chalk.green('Reports saved:'));
  if (paths.jsonPath) console.log(`  JSON: ${paths.jsonPath}`);
  if (paths.markdownPath) console.log(`  Markdown: ${paths.markdownPath}`);

  console.log(chalk.blue('\n✨ Analysis complete!\n'));
}

program.parse();
