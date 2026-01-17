import type { SitemapUrl, CategorizedUrl, PageType } from './types.js';

/**
 * Page type patterns for URL categorization
 * Patterns are checked in order - first match wins
 */
export const pageTypePatterns: Record<PageType, (string | RegExp)[]> = {
  itinerary: ['/cruise-destinations/', '/cruises/', '/itinerary/'],
  ship: ['/ships/'],
  destination: ['/destinations/'],
  landing: ['/index.html', /\/[^/]+\/?$/],
  other: [], // Catch-all
};

/**
 * Determine the page type for a given URL path
 */
export function getPageType(urlPath: string): PageType {
  const normalizedPath = urlPath.toLowerCase();

  for (const [pageType, patterns] of Object.entries(pageTypePatterns)) {
    if (pageType === 'other') continue; // Skip catch-all

    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        if (normalizedPath.includes(pattern)) {
          return pageType as PageType;
        }
      } else if (pattern instanceof RegExp) {
        if (pattern.test(normalizedPath)) {
          return pageType as PageType;
        }
      }
    }
  }

  return 'other';
}

/**
 * Determine property (Ocean/Expedition) from URL path
 * Only applicable for vikingcruises.com
 */
export function getProperty(urlPath: string): string | undefined {
  const normalizedPath = urlPath.toLowerCase();

  if (normalizedPath.includes('/oceans/')) {
    return 'ocean';
  }

  if (normalizedPath.includes('/expeditions/')) {
    return 'expedition';
  }

  return undefined;
}

/**
 * Categorize a list of sitemap URLs
 */
export function categorizeUrls(
  urls: SitemapUrl[],
  pathFilter?: string
): CategorizedUrl[] {
  const categorized: CategorizedUrl[] = [];

  for (const sitemapUrl of urls) {
    try {
      const url = new URL(sitemapUrl.loc);
      const urlPath = url.pathname;

      // Apply path filter if specified
      if (pathFilter && !urlPath.includes(pathFilter)) {
        continue;
      }

      const pageType = getPageType(urlPath);
      const property = getProperty(urlPath);

      categorized.push({
        url: sitemapUrl.loc,
        pageType,
        property,
      });
    } catch {
      // Skip invalid URLs
      continue;
    }
  }

  return categorized;
}

/**
 * Group categorized URLs by page type
 */
export function groupByPageType(
  urls: CategorizedUrl[]
): Record<PageType, CategorizedUrl[]> {
  const groups: Record<PageType, CategorizedUrl[]> = {
    itinerary: [],
    ship: [],
    destination: [],
    landing: [],
    other: [],
  };

  for (const url of urls) {
    groups[url.pageType].push(url);
  }

  return groups;
}

/**
 * Group categorized URLs by property, then by page type
 * Useful for vikingcruises.com (Ocean + Expedition)
 */
export function groupByPropertyAndPageType(
  urls: CategorizedUrl[]
): Record<string, Record<PageType, CategorizedUrl[]>> {
  const groups: Record<string, Record<PageType, CategorizedUrl[]>> = {};

  for (const url of urls) {
    const property = url.property || 'unknown';

    if (!groups[property]) {
      groups[property] = {
        itinerary: [],
        ship: [],
        destination: [],
        landing: [],
        other: [],
      };
    }

    groups[property][url.pageType].push(url);
  }

  return groups;
}

/**
 * Get statistics about categorized URLs
 */
export function getCategoryStats(
  urls: CategorizedUrl[]
): Record<PageType, number> {
  const stats: Record<PageType, number> = {
    itinerary: 0,
    ship: 0,
    destination: 0,
    landing: 0,
    other: 0,
  };

  for (const url of urls) {
    stats[url.pageType]++;
  }

  return stats;
}

/**
 * Filter out index/listing pages to get content pages
 * This helps ensure we sample actual content pages
 */
export function filterContentPages(urls: CategorizedUrl[]): CategorizedUrl[] {
  return urls.filter((url) => {
    const path = new URL(url.url).pathname.toLowerCase();

    // Exclude common listing/index patterns
    const excludePatterns = [
      /\/index\.html?$/i,
      /\/$/, // Root paths likely to be listing pages
      /\/all-/i, // All-* listing pages
      /\/browse/i,
      /\/search/i,
      /\/results/i,
    ];

    // Keep if path has enough segments (likely a content page)
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 2) {
      return false;
    }

    // Exclude if matches any exclude pattern
    for (const pattern of excludePatterns) {
      if (pattern.test(path)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Check if a URL appears to be a content page vs listing page
 */
export function isContentPage(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const segments = path.split('/').filter(Boolean);

    // Content pages typically have 3+ path segments
    // e.g., /oceans/cruise-destinations/mediterranean/venice
    return segments.length >= 3;
  } catch {
    return false;
  }
}
