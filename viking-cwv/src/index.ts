#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { loadConfig, applyCliOptions, validateConfig } from './config.js';
import { fetchSitemapForOrigin } from './sitemap.js';
import { categorizeUrls } from './categorize.js';
import {
  sampleByPageType,
  sampleByPropertyAndPageType,
} from './sample.js';
import { fetchCrUXData } from './crux.js';
import { fetchPSIDataForUrls } from './psi.js';
import {
  buildReport,
  buildPageTypeSamples,
  saveReport,
  printSummary,
} from './report.js';
import type {
  CLIOptions,
  Config,
  CrUXData,
  OriginConfig,
  OriginReport,
  PageType,
  PageTypeSamples,
  PSIResult,
} from './types.js';

// ============================================================================
// Type Definitions for Internal Data Structures
// ============================================================================

/** Represents sampled URLs, either flat or nested by property */
interface SampleData {
  samples: Record<PageType, string[]> | Record<string, Record<PageType, string[]>>;
  isNested: boolean;
}

/** Context passed to pipeline functions */
interface PipelineContext {
  config: Config;
  cliOptions: CLIOptions;
  verbose: boolean;
}

// ============================================================================
// Pipeline Step 1: CrUX Data Fetching
// ============================================================================

/**
 * Fetches CrUX field data for all unique origins.
 * Returns a map of origin URL to CrUX data.
 */
async function fetchAllCruxData(
  ctx: PipelineContext,
  spinner: Ora
): Promise<Map<string, CrUXData>> {
  const cruxDataMap = new Map<string, CrUXData>();
  const uniqueOrigins = [...new Set(ctx.config.origins.map((o) => o.origin))];

  for (const originUrl of uniqueOrigins) {
    const origin = ctx.config.origins.find((o) => o.origin === originUrl);
    if (!origin) continue;

    if (ctx.verbose) {
      spinner.text = `Fetching CrUX data for ${originUrl}...`;
    }

    try {
      const cruxData = await fetchCrUXData(originUrl, ctx.config.apiKey!);
      cruxDataMap.set(originUrl, cruxData);
    } catch {
      if (ctx.verbose) {
        console.warn(
          chalk.yellow(`\n  Warning: Failed to fetch CrUX data for ${originUrl}`)
        );
      }
      cruxDataMap.set(originUrl, { overall: 'FAIL' });
    }
  }

  spinner.succeed(`Fetched CrUX data for ${uniqueOrigins.length} origins`);
  return cruxDataMap;
}

// ============================================================================
// Pipeline Step 2: Sitemap Fetching and URL Sampling
// ============================================================================

/**
 * Determines the storage key for an origin based on its configuration.
 */
function getOriginKey(origin: OriginConfig): string {
  return origin.origin + (origin.pathFilter || '');
}

/**
 * Fetches sitemaps and samples URLs for all origins.
 * Returns a map of origin key to sample data.
 */
async function fetchAndSampleUrls(
  ctx: PipelineContext,
  spinner: Ora
): Promise<Map<string, SampleData>> {
  const originSamples = new Map<string, SampleData>();

  for (const origin of ctx.config.origins) {
    if (origin.cruxOnly) continue;

    if (ctx.verbose) {
      spinner.text = `Fetching sitemap for ${origin.name}...`;
    }

    try {
      const urls = await fetchSitemapForOrigin(origin, ctx.verbose);
      const categorized = categorizeUrls(urls, origin.pathFilter);
      const hasSubProperties = categorized.some((u) => u.property);

      const sampleData = hasSubProperties
        ? {
            samples: sampleByPropertyAndPageType(categorized, ctx.config.samplesPerType),
            isNested: true,
          }
        : {
            samples: sampleByPageType(categorized, ctx.config.samplesPerType),
            isNested: false,
          };

      originSamples.set(getOriginKey(origin), sampleData);
    } catch {
      if (ctx.verbose) {
        console.warn(
          chalk.yellow(`\n  Warning: Failed to fetch sitemap for ${origin.name}`)
        );
      }
    }
  }

  spinner.succeed(`Fetched and categorized URLs from ${originSamples.size} sitemaps`);
  return originSamples;
}

// ============================================================================
// Pipeline Step 3: PSI Analysis
// ============================================================================

/**
 * Creates a progress callback for PSI analysis.
 */
function createProgressCallback(
  spinner: Ora,
  verbose: boolean
): (current: number, total: number, url: string) => void {
  return (current, total, url) => {
    if (verbose) {
      spinner.text = `[${current}/${total}] ${url}`;
    }
  };
}

/**
 * Runs PSI analysis for a batch of URLs.
 */
async function analyzeBatch(
  urls: string[],
  ctx: PipelineContext,
  spinner: Ora,
  label: string
): Promise<PSIResult[]> {
  if (urls.length === 0) return [];

  if (ctx.verbose) {
    spinner.text = `Analyzing ${label} (${urls.length} URLs)...`;
  }

  return fetchPSIDataForUrls(urls, ctx.config.apiKey!, {
    strategy: ctx.config.strategy,
    delayBetweenRequests: ctx.config.delayBetweenRequests,
    onProgress: createProgressCallback(spinner, ctx.verbose),
  });
}

/**
 * Runs PSI analysis for nested samples (property -> pageType -> urls).
 */
async function analyzeNestedSamples(
  nestedSamples: Record<string, Record<PageType, string[]>>,
  originName: string,
  ctx: PipelineContext,
  spinner: Ora
): Promise<Map<string, PSIResult[]>> {
  const results = new Map<string, PSIResult[]>();

  for (const [property, pageTypes] of Object.entries(nestedSamples)) {
    for (const [pageType, urls] of Object.entries(pageTypes)) {
      const label = `${originName} ${property} ${pageType}`;
      const psiResults = await analyzeBatch(urls, ctx, spinner, label);
      if (psiResults.length > 0) {
        results.set(`${property}:${pageType}`, psiResults);
      }
    }
  }

  return results;
}

/**
 * Runs PSI analysis for flat samples (pageType -> urls).
 */
async function analyzeFlatSamples(
  flatSamples: Record<PageType, string[]>,
  originName: string,
  ctx: PipelineContext,
  spinner: Ora
): Promise<Map<string, PSIResult[]>> {
  const results = new Map<string, PSIResult[]>();

  for (const [pageType, urls] of Object.entries(flatSamples)) {
    const label = `${originName} ${pageType}`;
    const psiResults = await analyzeBatch(urls, ctx, spinner, label);
    if (psiResults.length > 0) {
      results.set(pageType, psiResults);
    }
  }

  return results;
}

/**
 * Runs PSI analysis for all sampled URLs across all origins.
 */
async function runPsiAnalysis(
  ctx: PipelineContext,
  originSamples: Map<string, SampleData>,
  spinner: Ora
): Promise<Map<string, Map<string, PSIResult[]>>> {
  const psiResults = new Map<string, Map<string, PSIResult[]>>();

  for (const origin of ctx.config.origins) {
    if (origin.cruxOnly) continue;

    const key = getOriginKey(origin);
    const sampleData = originSamples.get(key);
    if (!sampleData) continue;

    const results = sampleData.isNested
      ? await analyzeNestedSamples(
          sampleData.samples as Record<string, Record<PageType, string[]>>,
          origin.name,
          ctx,
          spinner
        )
      : await analyzeFlatSamples(
          sampleData.samples as Record<PageType, string[]>,
          origin.name,
          ctx,
          spinner
        );

    psiResults.set(key, results);
  }

  spinner.succeed('PageSpeed Insights analysis complete');
  return psiResults;
}

// ============================================================================
// Pipeline Step 4: Report Building
// ============================================================================

/**
 * Builds a minimal report for CrUX-only origins.
 */
function buildCruxOnlyReport(origin: OriginConfig, cruxData: CrUXData): OriginReport {
  return {
    name: origin.name,
    crux: cruxData,
    samples: {},
  };
}

/**
 * Builds nested samples structure from PSI results.
 */
function buildNestedSamplesFromResults(
  psiResults: Map<string, PSIResult[]>
): Record<string, Record<string, PageTypeSamples>> {
  const nestedSamples: Record<string, Record<string, PageTypeSamples>> = {};

  for (const [resultKey, results] of psiResults.entries()) {
    const [property, pageType] = resultKey.split(':');

    if (!nestedSamples[property]) {
      nestedSamples[property] = {};
    }

    nestedSamples[property][pageType] = buildPageTypeSamples(results, pageType as PageType);
  }

  return nestedSamples;
}

/**
 * Builds flat samples structure from PSI results.
 */
function buildFlatSamplesFromResults(
  psiResults: Map<string, PSIResult[]>
): Record<string, PageTypeSamples> {
  const flatSamples: Record<string, PageTypeSamples> = {};

  for (const [pageType, results] of psiResults.entries()) {
    flatSamples[pageType] = buildPageTypeSamples(results, pageType as PageType);
  }

  return flatSamples;
}

/**
 * Builds all origin reports from CrUX data, sample data, and PSI results.
 */
function buildOriginReports(
  ctx: PipelineContext,
  cruxDataMap: Map<string, CrUXData>,
  originSamples: Map<string, SampleData>,
  psiResults: Map<string, Map<string, PSIResult[]>>
): Map<string, OriginReport> {
  const originReports = new Map<string, OriginReport>();

  for (const origin of ctx.config.origins) {
    const cruxData = cruxDataMap.get(origin.origin) || { overall: 'FAIL' };

    // Handle CrUX-only origins
    if (origin.cruxOnly) {
      originReports.set(origin.origin, buildCruxOnlyReport(origin, cruxData));
      continue;
    }

    const key = getOriginKey(origin);
    const sampleData = originSamples.get(key);
    const originPsiResults = psiResults.get(key);

    // Handle origins with no data
    if (!sampleData || !originPsiResults) {
      originReports.set(origin.origin, buildCruxOnlyReport(origin, cruxData));
      continue;
    }

    // Build samples based on structure type
    const samples = sampleData.isNested
      ? buildNestedSamplesFromResults(originPsiResults)
      : buildFlatSamplesFromResults(originPsiResults);

    // Determine the report key
    const reportKey = origin.pathFilter ? `${origin.origin}${origin.pathFilter}` : origin.origin;

    originReports.set(reportKey, {
      name: origin.name,
      crux: cruxData,
      samples,
    });
  }

  return originReports;
}

// ============================================================================
// Pipeline Step 5: Report Output
// ============================================================================

/**
 * Saves the report and prints output paths.
 */
function saveAndPrintReport(
  report: ReturnType<typeof buildReport>,
  outputDir: string,
  format: CLIOptions['format']
): void {
  printSummary(report);

  const paths = saveReport(report, outputDir, format);
  console.log(chalk.green('Reports saved:'));

  if (paths.jsonPath) console.log(`  JSON: ${paths.jsonPath}`);
  if (paths.markdownPath) console.log(`  Markdown: ${paths.markdownPath}`);
  // @ts-ignore - htmlPath added in runtime
  if (paths.htmlPath) console.log(`  HTML: ${paths.htmlPath}`);

  console.log(chalk.blue('\n✨ Analysis complete!\n'));
}

// ============================================================================
// Main Entry Point
// ============================================================================

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
    'Output format: json, markdown, html, or both',
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
}): Promise<void> {
  // Parse CLI options
  const cliOptions: CLIOptions = {
    samples: parseInt(options.samples, 10),
    cruxOnly: options.cruxOnly,
    property: options.property,
    format: options.format as CLIOptions['format'],
    verbose: options.verbose,
    config: options.config,
  };

  console.log(chalk.bold.blue('\n🚢 Viking Core Web Vitals Analyzer\n'));

  // Load and validate configuration
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

  // Create pipeline context
  const ctx: PipelineContext = {
    config,
    cliOptions,
    verbose: cliOptions.verbose || false,
  };

  // Step 1: Fetch CrUX data
  const cruxSpinner = ora('Fetching CrUX field data...').start();
  const cruxDataMap = await fetchAllCruxData(ctx, cruxSpinner);

  // Handle CrUX-only mode (early exit)
  if (cliOptions.cruxOnly) {
    const originReports = new Map<string, OriginReport>();
    for (const origin of config.origins) {
      const cruxData = cruxDataMap.get(origin.origin) || { overall: 'FAIL' };
      originReports.set(origin.origin, buildCruxOnlyReport(origin, cruxData));
    }

    const report = buildReport(cruxDataMap, originReports);
    saveAndPrintReport(report, config.outputDir, cliOptions.format);
    return;
  }

  // Step 2: Fetch sitemaps and sample URLs
  const sitemapSpinner = ora('Fetching sitemaps...').start();
  const originSamples = await fetchAndSampleUrls(ctx, sitemapSpinner);

  // Step 3: Run PSI analysis
  const psiSpinner = ora('Running PageSpeed Insights analysis...').start();
  const psiResults = await runPsiAnalysis(ctx, originSamples, psiSpinner);

  // Step 4: Build origin reports
  const originReports = buildOriginReports(ctx, cruxDataMap, originSamples, psiResults);

  // Step 5: Generate and save report
  const report = buildReport(cruxDataMap, originReports);
  saveAndPrintReport(report, config.outputDir, cliOptions.format);
}

program.parse(process.argv);
