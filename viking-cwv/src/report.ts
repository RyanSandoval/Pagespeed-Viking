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
  format: 'json' | 'markdown' | 'html' | 'both' = 'both'
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

  if (format === 'html' || format === 'both') {
    const html = generateHtmlReport(report);
    const htmlPath = join(outputDir, `cwv-report-${timestamp}.html`);
    writeFileSync(htmlPath, html);
    // paths.htmlPath = htmlPath; // Types doesn't support this yet, but file is written
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

  if (report.summary.recommendation) {
    console.log(`Recommendation: ${report.summary.recommendation}`);
  }

  console.log('\n========================================\n');
}

/**
 * Generate HTML report
 */
export function generateHtmlReport(report: Report): string {
  const date = new Date(report.generated).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const statusColor = report.summary.status === 'PASS' ? '#0f9d58' : '#d93025';

  // Helper to get color for metric status
  const getMetricColor = (status?: string) => {
    switch (status) {
      case 'good': return '#0f9d58'; // Green
      case 'needs-improvement': return '#ea8600'; // Orange
      case 'poor': return '#d93025'; // Red
      default: return '#5f6368'; // Grey
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return '#0f9d58';
    if (score >= 50) return '#ea8600';
    return '#d93025';
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Viking Core Web Vitals Report</title>
    <style>
        :root {
            --primary: #002F5F; /* Viking Blue */
            --bg: #f8f9fa;
            --card-bg: #ffffff;
            --text: #202124;
            --text-secondary: #5f6368;
            --border: #dadce0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: var(--text);
            background: var(--bg);
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: var(--card-bg);
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 { margin: 0; color: var(--primary); }
        .meta { color: var(--text-secondary); font-size: 0.9em; }
        
        .status-badge {
            background: ${statusColor};
            color: white;
            padding: 8px 16px;
            border-radius: 24px;
            font-weight: bold;
            font-size: 1.1em;
        }

        .section {
            background: var(--card-bg);
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            margin-bottom: 24px;
        }
        h2, h3, h4 { margin-top: 0; color: var(--primary); }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
            margin-top: 20px;
        }

        .metric-card {
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
        }
        .metric-card.good { border-left: 4px solid #0f9d58; }
        .metric-card.needs-improvement { border-left: 4px solid #ea8600; }
        .metric-card.poor { border-left: 4px solid #d93025; }

        .metric-value { font-size: 2em; font-weight: bold; }
        .metric-label { color: var(--text-secondary); }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
            font-size: 0.95em;
        }
        th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid var(--border);
        }
        th { color: var(--text-secondary); font-weight: 500; }
        .score-pill {
            padding: 4px 8px;
            border-radius: 12px;
            color: white;
            font-weight: bold;
            font-size: 0.9em;
        }
        .url-cell {
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .url-cell a { color: var(--primary); text-decoration: none; }
        .url-cell a:hover { text-decoration: underline; }

        .recommendation {
            background: #e8f0fe;
            color: #1a73e8;
            padding: 16px;
            border-radius: 8px;
            border-left: 4px solid #1a73e8;
            margin-bottom: 24px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>Core Web Vitals Report</h1>
                <div class="meta">Generated: ${date}</div>
            </div>
            <div class="status-badge">${report.summary.status}</div>
        </div>

        ${report.summary.recommendation ? `
            <div class="recommendation">
                <strong>Recommendation:</strong> ${report.summary.recommendation}
            </div>
        ` : ''}

        ${Object.entries(report.origins).map(([origin, data]) => `
            <div class="section">
                <h2>${data.name} Environment</h2>
                <div class="meta">${origin}</div>

                <div class="grid">
                    <div class="metric-card ${data.crux.lcp?.status || ''}">
                        <div class="metric-label">LCP (Largest Contentful Paint)</div>
                        <div class="metric-value" style="color: ${getMetricColor(data.crux.lcp?.status)}">
                            ${formatCrUXValue(data.crux.lcp, 'lcp')}
                        </div>
                    </div>
                    <div class="metric-card ${data.crux.inp?.status || ''}">
                        <div class="metric-label">INP (Interaction to Next Paint)</div>
                        <div class="metric-value" style="color: ${getMetricColor(data.crux.inp?.status)}">
                            ${formatCrUXValue(data.crux.inp, 'inp')}
                        </div>
                    </div>
                     <div class="metric-card ${data.crux.cls?.status || ''}">
                        <div class="metric-label">CLS (Cumulative Layout Shift)</div>
                        <div class="metric-value" style="color: ${getMetricColor(data.crux.cls?.status)}">
                            ${formatCrUXValue(data.crux.cls, 'cls')}
                        </div>
                    </div>
                </div>

                <h3>Lab Data Samples</h3>
                ${Object.entries(data.samples).map(([key, value]) => {
    const isNested = value && typeof value === 'object' && !('count' in value);

    if (isNested) {
      return Object.entries(value).map(([subKey, subValue]) => renderSampleTable(subKey, subValue as PageTypeSamples)).join('');
    } else {
      return renderSampleTable(key, value as PageTypeSamples);
    }
  }).join('')}
            </div>
        `).join('')}
    </div>
</body>
</html>`;

  function renderSampleTable(name: string, data: PageTypeSamples) {
    if (data.count === 0) return '';
    return `
        <h4>${name.charAt(0).toUpperCase() + name.slice(1)} Pages</h4>
        <table>
            <thead>
                <tr>
                    <th>URL</th>
                    <th>Score</th>
                    <th>LCP</th>
                    <th>CLS</th>
                </tr>
            </thead>
            <tbody>
                ${data.urls.map(u => `
                    <tr>
                        <td class="url-cell" title="${u.url}"><a href="${u.url}" target="_blank">${u.url}</a></td>
                        <td><span class="score-pill" style="background: ${getScoreColor(u.score)}">${u.score}</span></td>
                        <td>${formatPSIValue(u.lcp, 'lcp')}</td>
                        <td>${u.cls.toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table><br>
    `;
  }
}

