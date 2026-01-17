import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  Report,
  ReportSummary,
  OriginReport,
  CrUXData,
  PSIResult,
  PageTypeSamples,
  PageType,
} from './types.js';
import { formatCrUXValue, getStatusEmoji } from './crux.js';
import { calculateAverages, formatPSIValue } from './psi.js';

/**
 * Build page type samples from PSI results
 */
export function buildPageTypeSamples(
  results: PSIResult[],
  pageType: PageType
): PageTypeSamples {
  const validResults = results.filter((r) => !r.error);
  const averages = calculateAverages(results);

  return {
    count: results.length,
    avgScore: averages.avgScore,
    avgLcp: averages.avgLcp,
    avgInp: averages.avgInp,
    avgCls: averages.avgCls,
    urls: results,
  };
}

/**
 * Determine the worst metric across all origins
 */
function findWorstMetric(
  cruxDataMap: Map<string, CrUXData>
): string | undefined {
  const metricScores = {
    lcp: 0,
    inp: 0,
    cls: 0,
  };

  for (const data of cruxDataMap.values()) {
    if (data.lcp?.status === 'poor') metricScores.lcp += 2;
    else if (data.lcp?.status === 'needs-improvement') metricScores.lcp += 1;

    if (data.inp?.status === 'poor') metricScores.inp += 2;
    else if (data.inp?.status === 'needs-improvement') metricScores.inp += 1;

    if (data.cls?.status === 'poor') metricScores.cls += 2;
    else if (data.cls?.status === 'needs-improvement') metricScores.cls += 1;
  }

  const maxScore = Math.max(...Object.values(metricScores));
  if (maxScore === 0) return undefined;

  if (metricScores.cls === maxScore) return 'CLS';
  if (metricScores.lcp === maxScore) return 'LCP';
  if (metricScores.inp === maxScore) return 'INP';

  return undefined;
}

/**
 * Generate recommendation based on worst metric
 */
function generateRecommendation(worstMetric: string | undefined): string {
  switch (worstMetric) {
    case 'CLS':
      return 'Focus on CLS issues - investigate image/ad layout shifts and ensure elements have explicit dimensions';
    case 'LCP':
      return 'Focus on LCP optimization - consider image optimization, server response time, and render-blocking resources';
    case 'INP':
      return 'Focus on INP improvements - optimize JavaScript execution, reduce main thread blocking, and improve event handlers';
    default:
      return 'Review all Core Web Vitals metrics and prioritize based on user impact';
  }
}

/**
 * Build the report summary
 */
export function buildSummary(
  cruxDataMap: Map<string, CrUXData>
): ReportSummary {
  const totalOrigins = cruxDataMap.size;
  const passedOrigins = Array.from(cruxDataMap.values()).filter(
    (d) => d.overall === 'PASS'
  ).length;

  const status = passedOrigins === totalOrigins ? 'PASS' : 'FAIL';
  const worstMetric = findWorstMetric(cruxDataMap);
  const recommendation = generateRecommendation(worstMetric);

  return {
    status,
    passedOrigins,
    totalOrigins,
    worstMetric,
    recommendation,
  };
}

/**
 * Generate the full report object
 */
export function buildReport(
  cruxDataMap: Map<string, CrUXData>,
  originReports: Map<string, OriginReport>
): Report {
  const summary = buildSummary(cruxDataMap);

  const origins: Record<string, OriginReport> = {};
  for (const [origin, report] of originReports.entries()) {
    origins[origin] = report;
  }

  return {
    generated: new Date().toISOString(),
    summary,
    origins,
  };
}

/**
 * Generate Markdown report
 */
export function generateMarkdownReport(report: Report): string {
  const lines: string[] = [];

  // Header
  lines.push('# Viking Core Web Vitals Report');
  const date = new Date(report.generated);
  lines.push(
    `Generated: ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  );
  lines.push('');

  // Summary
  lines.push('## Summary');
  const statusIcon = report.summary.status === 'PASS' ? '✅' : '❌';
  lines.push(
    `**Status: ${statusIcon} ${report.summary.status}** (${report.summary.passedOrigins}/${report.summary.totalOrigins} origins passing)`
  );
  lines.push('');

  // CrUX overview table
  lines.push('| Origin | LCP | INP | CLS | Status |');
  lines.push('|--------|-----|-----|-----|--------|');

  for (const [origin, data] of Object.entries(report.origins)) {
    const crux = data.crux;
    const lcpValue = formatCrUXValue(crux.lcp, 'lcp');
    const inpValue = formatCrUXValue(crux.inp, 'inp');
    const clsValue = formatCrUXValue(crux.cls, 'cls');

    const lcpEmoji = getStatusEmoji(crux.lcp?.status);
    const inpEmoji = getStatusEmoji(crux.inp?.status);
    const clsEmoji = getStatusEmoji(crux.cls?.status);

    const statusEmoji = crux.overall === 'PASS' ? '✅' : '❌';

    lines.push(
      `| ${origin} | ${lcpValue} ${lcpEmoji} | ${inpValue} ${inpEmoji} | ${clsValue} ${clsEmoji} | ${statusEmoji} |`
    );
  }
  lines.push('');

  // Page Type Breakdown
  lines.push('## Page Type Breakdown (Lab Data)');
  lines.push('');

  for (const [origin, data] of Object.entries(report.origins)) {
    lines.push(`### ${data.name} (${origin})`);
    lines.push('');

    // Check if samples is nested (has sub-properties like ocean/expedition)
    const samples = data.samples;
    const firstKey = Object.keys(samples)[0];
    const isNested =
      firstKey &&
      typeof samples[firstKey] === 'object' &&
      'count' in (samples[firstKey] as object) === false;

    if (isNested) {
      // Nested structure (e.g., ocean -> itinerary)
      for (const [subProperty, pageTypes] of Object.entries(samples)) {
        lines.push(`#### ${subProperty.charAt(0).toUpperCase() + subProperty.slice(1)}`);
        lines.push('');
        lines.push('| Page Type | Samples | Avg Score | Avg LCP | Avg CLS |');
        lines.push('|-----------|---------|-----------|---------|---------|');

        for (const [pageType, pageData] of Object.entries(
          pageTypes as Record<string, PageTypeSamples>
        )) {
          if ((pageData as PageTypeSamples).count > 0) {
            const pt = pageData as PageTypeSamples;
            lines.push(
              `| ${pageType} | ${pt.count} | ${pt.avgScore} | ${formatPSIValue(pt.avgLcp, 'lcp')} | ${pt.avgCls.toFixed(2)} |`
            );
          }
        }
        lines.push('');
      }
    } else {
      // Flat structure
      lines.push('| Page Type | Samples | Avg Score | Avg LCP | Avg CLS |');
      lines.push('|-----------|---------|-----------|---------|---------|');

      for (const [pageType, pageData] of Object.entries(samples)) {
        if ((pageData as PageTypeSamples).count > 0) {
          const pt = pageData as PageTypeSamples;
          lines.push(
            `| ${pageType} | ${pt.count} | ${pt.avgScore} | ${formatPSIValue(pt.avgLcp, 'lcp')} | ${pt.avgCls.toFixed(2)} |`
          );
        }
      }
      lines.push('');
    }
  }

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');

  if (report.summary.worstMetric) {
    lines.push(`1. **${report.summary.worstMetric}** is the primary failing metric`);
  }

  if (report.summary.recommendation) {
    lines.push(`2. ${report.summary.recommendation}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Save report to files
 */
export function saveReport(
  report: Report,
  outputDir: string,
  format: 'json' | 'markdown' | 'both' = 'both'
): { jsonPath?: string; markdownPath?: string } {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const paths: { jsonPath?: string; markdownPath?: string } = {};

  if (format === 'json' || format === 'both') {
    const jsonPath = join(outputDir, `cwv-report-${timestamp}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    paths.jsonPath = jsonPath;
  }

  if (format === 'markdown' || format === 'both') {
    const markdown = generateMarkdownReport(report);
    const mdPath = join(outputDir, `cwv-report-${timestamp}.md`);
    writeFileSync(mdPath, markdown);
    paths.markdownPath = mdPath;
  }

  return paths;
}

/**
 * Print summary to console
 */
export function printSummary(report: Report): void {
  console.log('\n========================================');
  console.log('       Core Web Vitals Summary');
  console.log('========================================\n');

  const statusIcon = report.summary.status === 'PASS' ? '✅' : '❌';
  console.log(
    `Status: ${statusIcon} ${report.summary.status} (${report.summary.passedOrigins}/${report.summary.totalOrigins} origins passing)\n`
  );

  console.log('Origin Results:');
  console.log('---------------');

  for (const [origin, data] of Object.entries(report.origins)) {
    const crux = data.crux;
    const status = crux.overall === 'PASS' ? '✅' : '❌';

    console.log(`\n${data.name} (${origin}): ${status}`);

    if (crux.lcp) {
      console.log(
        `  LCP: ${formatCrUXValue(crux.lcp, 'lcp')} ${getStatusEmoji(crux.lcp.status)}`
      );
    }
    if (crux.inp) {
      console.log(
        `  INP: ${formatCrUXValue(crux.inp, 'inp')} ${getStatusEmoji(crux.inp.status)}`
      );
    }
    if (crux.cls) {
      console.log(
        `  CLS: ${formatCrUXValue(crux.cls, 'cls')} ${getStatusEmoji(crux.cls.status)}`
      );
    }
  }

  if (report.summary.worstMetric) {
    console.log(`\nWorst Metric: ${report.summary.worstMetric}`);
  }

  if (report.summary.recommendation) {
    console.log(`Recommendation: ${report.summary.recommendation}`);
  }

  console.log('\n========================================\n');
}
