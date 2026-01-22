// Core Web Vitals thresholds
export const CWV_THRESHOLDS = {
  lcp: { good: 2500, needsImprovement: 4000 },
  inp: { good: 200, needsImprovement: 500 },
  cls: { good: 0.1, needsImprovement: 0.25 },
} as const;

export type MetricStatus = 'good' | 'needs-improvement' | 'poor';
export type OverallStatus = 'PASS' | 'FAIL';

// Configuration types
export interface OriginConfig {
  name: string;
  origin: string;
  sitemapUrl?: string;
  pathFilter?: string;
  cruxOnly?: boolean;
}

export interface Config {
  origins: OriginConfig[];
  samplesPerType: number;
  delayBetweenRequests: number;
  strategy: 'mobile' | 'desktop';
  outputDir: string;
  apiKey?: string;
}

// Sitemap types
export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

// Categorization types
export type PageType = 'itinerary' | 'ship' | 'destination' | 'landing' | 'other';

export interface CategorizedUrl {
  url: string;
  pageType: PageType;
  property?: string;
}

// CrUX types
export interface CrUXMetric {
  p75: number;
  status: MetricStatus;
}

export interface CrUXData {
  lcp?: CrUXMetric;
  inp?: CrUXMetric;
  cls?: CrUXMetric;
  overall: OverallStatus;
}

// PSI types
export interface PSIResult {
  url: string;
  score: number;
  lcp: number;
  inp: number;
  cls: number;
  fcp: number;
  ttfb: number;
  error?: string;
}

export interface PageTypeSamples {
  count: number;
  avgScore: number;
  avgLcp: number;
  avgInp: number;
  avgCls: number;
  urls: PSIResult[];
}

// Report types
export interface PropertySamples {
  [pageType: string]: PageTypeSamples;
}

export interface SubPropertySamples {
  [subProperty: string]: PropertySamples;
}

export interface OriginReport {
  name: string;
  crux: CrUXData;
  samples: PropertySamples | SubPropertySamples;
}

export interface ReportSummary {
  status: OverallStatus;
  passedOrigins: number;
  totalOrigins: number;
  worstMetric?: string;
  recommendation?: string;
  // Average scores across all tested pages
  averageScore?: number;
  averageLcp?: number;
  averageInp?: number;
  averageCls?: number;
  totalPagesTested?: number;
}

export interface Report {
  generated: string;
  summary: ReportSummary;
  origins: {
    [origin: string]: OriginReport;
  };
}

// CLI options
export interface CLIOptions {
  samples?: number;
  cruxOnly?: boolean;
  property?: string;
  format?: 'json' | 'markdown' | 'html' | 'both';
  verbose?: boolean;
  config?: string;
  urls?: string[]; // Specific URLs to test (1-10)
}

// Robots.txt types
export interface RobotsRule {
  userAgent: string;
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

// URL Test types (for testing specific URLs with mobile/desktop)
export interface URLTestResult {
  url: string;
  mobile: PSIResult;
  desktop: PSIResult;
}

export interface URLTestSummary {
  totalUrls: number;
  averageMobileScore: number;
  averageDesktopScore: number;
  averageMobileLcp: number;
  averageDesktopLcp: number;
  averageMobileInp: number;
  averageDesktopInp: number;
  averageMobileCls: number;
  averageDesktopCls: number;
}

export interface URLTestReport {
  generated: string;
  summary: URLTestSummary;
  results: URLTestResult[];
}
