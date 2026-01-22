import axios from 'axios';
import type { PSIResult, URLTestResult } from './types.js';

const PSI_API_ENDPOINT =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * PSI API response structure (simplified)
 */
interface PSIApiResponse {
  lighthouseResult?: {
    categories?: {
      performance?: {
        score: number;
      };
    };
    audits?: {
      'largest-contentful-paint'?: { numericValue: number };
      'interaction-to-next-paint'?: { numericValue: number };
      'cumulative-layout-shift'?: { numericValue: number };
      'first-contentful-paint'?: { numericValue: number };
      'server-response-time'?: { numericValue: number };
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch PSI data for a single URL with retry logic
 */
export async function fetchPSIData(
  url: string,
  apiKey: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  maxRetries: number = 3
): Promise<PSIResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const params = new URLSearchParams({
        url,
        key: apiKey,
        strategy: strategy === 'mobile' ? 'mobile' : 'desktop',
        category: 'performance',
      });

      const response = await axios.get<PSIApiResponse>(
        `${PSI_API_ENDPOINT}?${params.toString()}`,
        {
          timeout: 120000, // 2 minute timeout for PSI
        }
      );

      if (response.data.error) {
        throw new Error(
          `PSI API error: ${response.data.error.message} (code: ${response.data.error.code})`
        );
      }

      const lighthouse = response.data.lighthouseResult;

      if (!lighthouse) {
        throw new Error('No Lighthouse results in response');
      }

      const score = lighthouse.categories?.performance?.score ?? 0;
      const audits = lighthouse.audits ?? {};

      return {
        url,
        score: Math.round(score * 100),
        lcp: audits['largest-contentful-paint']?.numericValue ?? 0,
        inp: audits['interaction-to-next-paint']?.numericValue ?? 0,
        cls: audits['cumulative-layout-shift']?.numericValue ?? 0,
        fcp: audits['first-contentful-paint']?.numericValue ?? 0,
        ttfb: audits['server-response-time']?.numericValue ?? 0,
      };
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on client errors (400-499)
      if (axios.isAxiosError(error) && error.response?.status) {
        const status = error.response.status;
        if (status >= 400 && status < 500) {
          break;
        }
      }

      // Exponential backoff for retries
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
      }
    }
  }

  // Return error result if all retries failed
  return {
    url,
    score: 0,
    lcp: 0,
    inp: 0,
    cls: 0,
    fcp: 0,
    ttfb: 0,
    error: lastError?.message || 'Unknown error',
  };
}

/**
 * Progress callback type
 */
export type ProgressCallback = (current: number, total: number, url: string) => void;

/**
 * Fetch PSI data for multiple URLs with rate limiting
 */
export async function fetchPSIDataForUrls(
  urls: string[],
  apiKey: string,
  options: {
    strategy?: 'mobile' | 'desktop';
    delayBetweenRequests?: number;
    onProgress?: ProgressCallback;
  } = {}
): Promise<PSIResult[]> {
  const {
    strategy = 'mobile',
    delayBetweenRequests = 1000,
    onProgress,
  } = options;

  const results: PSIResult[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (onProgress) {
      onProgress(i + 1, urls.length, url);
    }

    const result = await fetchPSIData(url, apiKey, strategy);
    results.push(result);

    // Add delay between requests (except for the last one)
    if (i < urls.length - 1 && delayBetweenRequests > 0) {
      await sleep(delayBetweenRequests);
    }
  }

  return results;
}

/**
 * Calculate average metrics from PSI results
 */
export function calculateAverages(results: PSIResult[]): {
  avgScore: number;
  avgLcp: number;
  avgInp: number;
  avgCls: number;
  avgFcp: number;
  avgTtfb: number;
} {
  // Filter out results with errors
  const validResults = results.filter((r) => !r.error);

  if (validResults.length === 0) {
    return {
      avgScore: 0,
      avgLcp: 0,
      avgInp: 0,
      avgCls: 0,
      avgFcp: 0,
      avgTtfb: 0,
    };
  }

  const sum = validResults.reduce(
    (acc, r) => ({
      score: acc.score + r.score,
      lcp: acc.lcp + r.lcp,
      inp: acc.inp + r.inp,
      cls: acc.cls + r.cls,
      fcp: acc.fcp + r.fcp,
      ttfb: acc.ttfb + r.ttfb,
    }),
    { score: 0, lcp: 0, inp: 0, cls: 0, fcp: 0, ttfb: 0 }
  );

  const count = validResults.length;

  return {
    avgScore: Math.round(sum.score / count),
    avgLcp: Math.round(sum.lcp),
    avgInp: Math.round(sum.inp),
    avgCls: parseFloat((sum.cls / count).toFixed(3)),
    avgFcp: Math.round(sum.fcp),
    avgTtfb: Math.round(sum.ttfb),
  };
}

/**
 * Format PSI metric value for display
 */
export function formatPSIValue(
  value: number,
  metricType: 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb' | 'score'
): string {
  if (metricType === 'score') {
    return value.toString();
  }

  if (metricType === 'cls') {
    return value.toFixed(2);
  }

  // Time metrics in milliseconds, convert to seconds for LCP/FCP
  if (metricType === 'lcp' || metricType === 'fcp') {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${Math.round(value)}ms`;
}

/**
 * Test a single URL for both mobile and desktop
 */
export async function fetchPSIDataDualStrategy(
  url: string,
  apiKey: string,
  options: {
    delayBetweenRequests?: number;
    onProgress?: (strategy: string) => void;
  } = {}
): Promise<URLTestResult> {
  const { delayBetweenRequests = 1000, onProgress } = options;

  if (onProgress) {
    onProgress('mobile');
  }
  const mobile = await fetchPSIData(url, apiKey, 'mobile');

  // Add delay between mobile and desktop requests
  if (delayBetweenRequests > 0) {
    await sleep(delayBetweenRequests);
  }

  if (onProgress) {
    onProgress('desktop');
  }
  const desktop = await fetchPSIData(url, apiKey, 'desktop');

  return { url, mobile, desktop };
}

/**
 * Test multiple URLs for both mobile and desktop
 */
export async function fetchPSIDataForUrlsDualStrategy(
  urls: string[],
  apiKey: string,
  options: {
    delayBetweenRequests?: number;
    onProgress?: (current: number, total: number, url: string, strategy: string) => void;
  } = {}
): Promise<URLTestResult[]> {
  const { delayBetweenRequests = 1000, onProgress } = options;

  const results: URLTestResult[] = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    const result = await fetchPSIDataDualStrategy(url, apiKey, {
      delayBetweenRequests,
      onProgress: onProgress
        ? (strategy) => onProgress(i + 1, urls.length, url, strategy)
        : undefined,
    });

    results.push(result);

    // Add delay between URLs (except for the last one)
    if (i < urls.length - 1 && delayBetweenRequests > 0) {
      await sleep(delayBetweenRequests);
    }
  }

  return results;
}
