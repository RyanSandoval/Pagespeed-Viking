import axios from 'axios';
import type { RobotsRule } from './types.js';

/**
 * Fetch and parse robots.txt from an origin
 */
export async function fetchRobotsTxt(origin: string): Promise<RobotsRule[]> {
  const robotsUrl = new URL('/robots.txt', origin).toString();

  try {
    const response = await axios.get(robotsUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'VikingCWVBot/1.0',
      },
    });

    return parseRobotsTxt(response.data);
  } catch (error) {
    // Return empty rules if robots.txt is not found or fails
    return [];
  }
}

/**
 * Parse robots.txt content into structured rules
 */
export function parseRobotsTxt(content: string): RobotsRule[] {
  const lines = content.split('\n');
  const rules: RobotsRule[] = [];
  let currentRule: RobotsRule | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = trimmed.substring(0, colonIndex).toLowerCase().trim();
    const value = trimmed.substring(colonIndex + 1).trim();

    switch (directive) {
      case 'user-agent':
        // Start a new rule block
        currentRule = {
          userAgent: value,
          disallow: [],
          allow: [],
          sitemaps: [],
        };
        rules.push(currentRule);
        break;

      case 'disallow':
        if (currentRule && value) {
          currentRule.disallow.push(value);
        }
        break;

      case 'allow':
        if (currentRule && value) {
          currentRule.allow.push(value);
        }
        break;

      case 'sitemap':
        // Sitemaps can appear outside user-agent blocks
        if (value) {
          if (currentRule) {
            currentRule.sitemaps.push(value);
          } else {
            // Global sitemap declaration
            rules.push({
              userAgent: '*',
              disallow: [],
              allow: [],
              sitemaps: [value],
            });
          }
        }
        break;
    }
  }

  return rules;
}

/**
 * Get all sitemap URLs from robots.txt rules
 */
export function getSitemapUrls(rules: RobotsRule[]): string[] {
  const sitemaps = new Set<string>();

  for (const rule of rules) {
    for (const sitemap of rule.sitemaps) {
      sitemaps.add(sitemap);
    }
  }

  return Array.from(sitemaps);
}

/**
 * Check if a path is disallowed by robots.txt for a given user agent
 */
export function isPathDisallowed(
  rules: RobotsRule[],
  path: string,
  userAgent: string = '*'
): boolean {
  // Find applicable rules (specific user agent or wildcard)
  const applicableRules = rules.filter(
    (r) =>
      r.userAgent === userAgent ||
      r.userAgent === '*' ||
      r.userAgent.toLowerCase() === userAgent.toLowerCase()
  );

  if (applicableRules.length === 0) {
    return false; // No rules means allowed
  }

  // Check each rule
  for (const rule of applicableRules) {
    // Check allow rules first (they take precedence)
    for (const allow of rule.allow) {
      if (pathMatches(path, allow)) {
        return false;
      }
    }

    // Check disallow rules
    for (const disallow of rule.disallow) {
      if (pathMatches(path, disallow)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a path matches a robots.txt pattern
 */
function pathMatches(path: string, pattern: string): boolean {
  if (!pattern) return false;

  // Handle wildcard patterns
  if (pattern.includes('*')) {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\$/g, '$') + '.*'
    );
    return regex.test(path);
  }

  // Simple prefix match
  return path.startsWith(pattern);
}
