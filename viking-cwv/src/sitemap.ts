import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import type { SitemapUrl, OriginConfig } from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/**
 * Fetch and parse a sitemap XML file
 */
export async function fetchSitemap(sitemapUrl: string): Promise<SitemapUrl[]> {
  try {
    const response = await axios.get(sitemapUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'VikingCWVBot/1.0',
        Accept: 'application/xml, text/xml, */*',
      },
    });

    return parseSitemap(response.data);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch sitemap from ${sitemapUrl}: ${error.message}`
      );
    }
    throw error;
  }
}

/**
 * Parse sitemap XML content into structured URL list
 */
export function parseSitemap(xmlContent: string): SitemapUrl[] {
  const parsed = parser.parse(xmlContent);
  const urls: SitemapUrl[] = [];

  // Handle <urlset> format (standard sitemap)
  if (parsed.urlset?.url) {
    const urlList = Array.isArray(parsed.urlset.url)
      ? parsed.urlset.url
      : [parsed.urlset.url];

    for (const url of urlList) {
      if (url.loc) {
        urls.push({
          loc: url.loc,
          lastmod: url.lastmod,
          changefreq: url.changefreq,
          priority: url.priority?.toString(),
        });
      }
    }
  }

  // Handle <sitemapindex> format (sitemap index pointing to other sitemaps)
  if (parsed.sitemapindex?.sitemap) {
    const sitemapList = Array.isArray(parsed.sitemapindex.sitemap)
      ? parsed.sitemapindex.sitemap
      : [parsed.sitemapindex.sitemap];

    for (const sitemap of sitemapList) {
      if (sitemap.loc) {
        // Return sitemap locations as URLs (caller should fetch these)
        urls.push({
          loc: sitemap.loc,
          lastmod: sitemap.lastmod,
        });
      }
    }
  }

  return urls;
}

/**
 * Filter URLs by path prefix
 */
export function filterByPathPrefix(
  urls: SitemapUrl[],
  pathPrefix: string
): SitemapUrl[] {
  return urls.filter((url) => {
    try {
      const urlPath = new URL(url.loc).pathname;
      return urlPath.includes(pathPrefix);
    } catch {
      return false;
    }
  });
}

/**
 * Fetch sitemap URLs for an origin configuration
 * Handles path filtering if specified
 */
export async function fetchSitemapForOrigin(
  config: OriginConfig,
  verbose: boolean = false
): Promise<SitemapUrl[]> {
  if (!config.sitemapUrl) {
    return [];
  }

  const urls = await fetchSitemap(config.sitemapUrl);

  if (verbose) {
    console.log(`  Fetched ${urls.length} URLs from ${config.sitemapUrl}`);
  }

  // Apply path filter if specified
  if (config.pathFilter) {
    const filtered = filterByPathPrefix(urls, config.pathFilter);
    if (verbose) {
      console.log(
        `  Filtered to ${filtered.length} URLs matching ${config.pathFilter}`
      );
    }
    return filtered;
  }

  return urls;
}

/**
 * Check if a sitemap is a sitemap index (contains links to other sitemaps)
 */
export function isSitemapIndex(xmlContent: string): boolean {
  const parsed = parser.parse(xmlContent);
  return !!parsed.sitemapindex;
}

/**
 * Recursively fetch all URLs from a sitemap (handles sitemap indices)
 */
export async function fetchAllSitemapUrls(
  sitemapUrl: string,
  verbose: boolean = false,
  maxDepth: number = 2
): Promise<SitemapUrl[]> {
  if (maxDepth <= 0) {
    return [];
  }

  try {
    const response = await axios.get(sitemapUrl, {
      timeout: 30000,
      headers: {
        'User-Agent': 'VikingCWVBot/1.0',
        Accept: 'application/xml, text/xml, */*',
      },
    });

    if (isSitemapIndex(response.data)) {
      // This is a sitemap index, fetch each child sitemap
      const childSitemaps = parseSitemap(response.data);

      if (verbose) {
        console.log(
          `  Found sitemap index with ${childSitemaps.length} child sitemaps`
        );
      }

      const allUrls: SitemapUrl[] = [];
      for (const child of childSitemaps) {
        const childUrls = await fetchAllSitemapUrls(
          child.loc,
          verbose,
          maxDepth - 1
        );
        allUrls.push(...childUrls);
      }

      return allUrls;
    } else {
      // This is a regular sitemap
      return parseSitemap(response.data);
    }
  } catch (error) {
    if (verbose) {
      console.warn(`  Warning: Failed to fetch sitemap ${sitemapUrl}`);
    }
    return [];
  }
}
