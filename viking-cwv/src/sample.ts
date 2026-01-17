import type { CategorizedUrl, PageType } from './types.js';
import {
  groupByPageType,
  groupByPropertyAndPageType,
  filterContentPages,
} from './categorize.js';

/**
 * Fisher-Yates shuffle algorithm for random array shuffling
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Take N random samples from an array
 */
export function sampleRandom<T>(array: T[], n: number): T[] {
  if (array.length <= n) {
    return [...array];
  }
  return shuffle(array).slice(0, n);
}

/**
 * Sample URLs by page type
 * Returns a map of page type to sampled URLs
 */
export function sampleByPageType(
  urls: CategorizedUrl[],
  samplesPerType: number,
  preferContentPages: boolean = true
): Record<PageType, string[]> {
  const grouped = groupByPageType(urls);
  const samples: Record<PageType, string[]> = {
    itinerary: [],
    ship: [],
    destination: [],
    landing: [],
    other: [],
  };

  for (const [pageType, pageUrls] of Object.entries(grouped)) {
    let urlPool = pageUrls;

    // Try to filter to content pages if requested
    if (preferContentPages) {
      const contentPages = filterContentPages(pageUrls);
      if (contentPages.length >= samplesPerType) {
        urlPool = contentPages;
      }
    }

    const sampled = sampleRandom(urlPool, samplesPerType);
    samples[pageType as PageType] = sampled.map((u) => u.url);
  }

  return samples;
}

/**
 * Sample URLs by property and page type
 * Useful for vikingcruises.com which has Ocean and Expedition sub-properties
 */
export function sampleByPropertyAndPageType(
  urls: CategorizedUrl[],
  samplesPerType: number,
  preferContentPages: boolean = true
): Record<string, Record<PageType, string[]>> {
  const grouped = groupByPropertyAndPageType(urls);
  const samples: Record<string, Record<PageType, string[]>> = {};

  for (const [property, pageTypes] of Object.entries(grouped)) {
    samples[property] = {
      itinerary: [],
      ship: [],
      destination: [],
      landing: [],
      other: [],
    };

    for (const [pageType, pageUrls] of Object.entries(pageTypes)) {
      let urlPool = pageUrls;

      // Try to filter to content pages if requested
      if (preferContentPages) {
        const contentPages = filterContentPages(pageUrls);
        if (contentPages.length >= samplesPerType) {
          urlPool = contentPages;
        }
      }

      const sampled = sampleRandom(urlPool, samplesPerType);
      samples[property][pageType as PageType] = sampled.map((u) => u.url);
    }
  }

  return samples;
}

/**
 * Get total sample count from samples by page type
 */
export function getTotalSampleCount(
  samples: Record<PageType, string[]>
): number {
  return Object.values(samples).reduce((sum, urls) => sum + urls.length, 0);
}

/**
 * Get all URLs from samples (flattened)
 */
export function flattenSamples(samples: Record<PageType, string[]>): string[] {
  return Object.values(samples).flat();
}

/**
 * Get all URLs from nested samples (property -> pageType -> urls)
 */
export function flattenNestedSamples(
  samples: Record<string, Record<PageType, string[]>>
): string[] {
  const urls: string[] = [];

  for (const propertyData of Object.values(samples)) {
    for (const pageUrls of Object.values(propertyData)) {
      urls.push(...pageUrls);
    }
  }

  return urls;
}

/**
 * Statistics about sampled URLs
 */
export interface SampleStats {
  total: number;
  byPageType: Record<PageType, number>;
  byProperty?: Record<string, Record<PageType, number>>;
}

/**
 * Get statistics about samples
 */
export function getSampleStats(
  samples: Record<PageType, string[]>
): SampleStats {
  const byPageType: Record<PageType, number> = {
    itinerary: 0,
    ship: 0,
    destination: 0,
    landing: 0,
    other: 0,
  };

  let total = 0;

  for (const [pageType, urls] of Object.entries(samples)) {
    byPageType[pageType as PageType] = urls.length;
    total += urls.length;
  }

  return { total, byPageType };
}

/**
 * Get statistics about nested samples
 */
export function getNestedSampleStats(
  samples: Record<string, Record<PageType, string[]>>
): SampleStats {
  const byPageType: Record<PageType, number> = {
    itinerary: 0,
    ship: 0,
    destination: 0,
    landing: 0,
    other: 0,
  };

  const byProperty: Record<string, Record<PageType, number>> = {};

  let total = 0;

  for (const [property, pageTypes] of Object.entries(samples)) {
    byProperty[property] = {
      itinerary: 0,
      ship: 0,
      destination: 0,
      landing: 0,
      other: 0,
    };

    for (const [pageType, urls] of Object.entries(pageTypes)) {
      byPageType[pageType as PageType] += urls.length;
      byProperty[property][pageType as PageType] = urls.length;
      total += urls.length;
    }
  }

  return { total, byPageType, byProperty };
}
