import axios from 'axios';
import type { CrUXData, CrUXMetric, MetricStatus } from './types.js';
import { CWV_THRESHOLDS } from './types.js';

const CRUX_API_ENDPOINT =
  'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

/**
 * CrUX API response types
 */
interface CrUXApiResponse {
  record?: {
    key?: {
      origin?: string;
      url?: string;
    };
    metrics?: {
      largest_contentful_paint?: CrUXMetricData;
      interaction_to_next_paint?: CrUXMetricData;
      cumulative_layout_shift?: CrUXMetricData;
      first_contentful_paint?: CrUXMetricData;
      first_input_delay?: CrUXMetricData;
    };
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

interface CrUXMetricData {
  histogram: Array<{
    start: number | string;
    end?: number | string;
    density: number;
  }>;
  percentiles: {
    p75: number | string;
  };
}

/**
 * Determine metric status based on thresholds
 */
function getMetricStatus(
  metricName: 'lcp' | 'inp' | 'cls',
  value: number
): MetricStatus {
  const thresholds = CWV_THRESHOLDS[metricName];

  if (value <= thresholds.good) {
    return 'good';
  } else if (value <= thresholds.needsImprovement) {
    return 'needs-improvement';
  } else {
    return 'poor';
  }
}

/**
 * Parse CrUX metric data into our format
 */
function parseMetric(
  data: CrUXMetricData | undefined,
  metricName: 'lcp' | 'inp' | 'cls'
): CrUXMetric | undefined {
  if (!data?.percentiles?.p75) {
    return undefined;
  }

  // CLS is returned as a decimal (e.g., 0.15)
  // LCP and INP are returned in milliseconds
  const p75 =
    typeof data.percentiles.p75 === 'string'
      ? parseFloat(data.percentiles.p75)
      : data.percentiles.p75;

  return {
    p75,
    status: getMetricStatus(metricName, p75),
  };
}

/**
 * Determine overall CWV status
 * PASS requires all three metrics in "good" range
 */
function getOverallStatus(data: Omit<CrUXData, 'overall'>): 'PASS' | 'FAIL' {
  const metrics = [data.lcp, data.inp, data.cls];

  // If any metric is missing, we can't determine pass status
  if (metrics.some((m) => !m)) {
    return 'FAIL';
  }

  // All metrics must be "good" to pass
  if (metrics.every((m) => m?.status === 'good')) {
    return 'PASS';
  }

  return 'FAIL';
}

/**
 * Fetch CrUX data for an origin
 */
export async function fetchCrUXData(
  origin: string,
  apiKey: string
): Promise<CrUXData> {
  try {
    const response = await axios.post<CrUXApiResponse>(
      `${CRUX_API_ENDPOINT}?key=${apiKey}`,
      {
        origin: origin.replace(/\/$/, ''), // Remove trailing slash
        formFactor: 'PHONE', // Mobile data
      },
      {
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.error) {
      throw new Error(
        `CrUX API error: ${response.data.error.message} (${response.data.error.status})`
      );
    }

    const metrics = response.data.record?.metrics;

    if (!metrics) {
      return {
        overall: 'FAIL',
      };
    }

    const lcp = parseMetric(metrics.largest_contentful_paint, 'lcp');
    const inp = parseMetric(metrics.interaction_to_next_paint, 'inp');
    const cls = parseMetric(metrics.cumulative_layout_shift, 'cls');

    const cruxData = { lcp, inp, cls };

    return {
      ...cruxData,
      overall: getOverallStatus(cruxData),
    };
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      // Handle 404 - no data available for this origin
      if (error.response?.status === 404) {
        return {
          overall: 'FAIL',
        };
      }

      throw new Error(`CrUX API request failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch CrUX data for multiple origins
 */
export async function fetchCrUXDataForOrigins(
  origins: string[],
  apiKey: string,
  verbose: boolean = false
): Promise<Map<string, CrUXData>> {
  const results = new Map<string, CrUXData>();

  for (const origin of origins) {
    try {
      if (verbose) {
        console.log(`  Fetching CrUX data for ${origin}...`);
      }

      const data = await fetchCrUXData(origin, apiKey);
      results.set(origin, data);

      if (verbose) {
        const status = data.overall === 'PASS' ? '✓' : '✗';
        console.log(`    ${status} ${origin}: ${data.overall}`);
      }
    } catch (error: any) {
      if (verbose) {
        console.warn(
          `    Warning: Failed to fetch CrUX data for ${origin}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      // Store empty data on error
      results.set(origin, { overall: 'FAIL' });
    }
  }

  return results;
}

/**
 * Format CrUX metric value for display
 */
export function formatCrUXValue(
  metric: CrUXMetric | undefined,
  metricType: 'lcp' | 'inp' | 'cls'
): string {
  if (!metric) {
    return 'N/A';
  }

  if (metricType === 'cls') {
    return metric.p75.toFixed(2);
  }

  // LCP and INP in milliseconds, convert to seconds for display
  if (metricType === 'lcp') {
    return `${(metric.p75 / 1000).toFixed(1)}s`;
  }

  return `${Math.round(metric.p75)}ms`;
}

/**
 * Get status emoji for display
 */
export function getStatusEmoji(status: MetricStatus | undefined): string {
  switch (status) {
    case 'good':
      return '🟢';
    case 'needs-improvement':
      return '🟠';
    case 'poor':
      return '🔴';
    default:
      return '⚪';
  }
}
