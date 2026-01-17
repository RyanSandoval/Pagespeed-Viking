import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import type { Config, CLIOptions } from './types.js';

// Load environment variables from .env file
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default configuration
export const defaultConfig: Config = {
  origins: [
    {
      name: 'River',
      origin: 'https://vikingrivercruises.com',
      sitemapUrl: 'https://www.vikingrivercruises.com/sitemap.xml',
    },
    {
      name: 'Ocean',
      origin: 'https://vikingcruises.com',
      sitemapUrl: 'https://www.vikingcruises.com/sitemap.xml',
      pathFilter: '/oceans/',
    },
    {
      name: 'Expedition',
      origin: 'https://vikingcruises.com',
      sitemapUrl: 'https://www.vikingcruises.com/sitemap.xml',
      pathFilter: '/expeditions/',
    },
    {
      name: 'Portal',
      origin: 'https://viking.com',
      cruxOnly: true,
    },
  ],
  samplesPerType: 5,
  delayBetweenRequests: 1000,
  strategy: 'mobile',
  outputDir: './output',
};

/**
 * Load configuration from file and merge with defaults
 */
export function loadConfig(configPath?: string): Config {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const configLocations = [
    configPath,
    resolve(process.cwd(), 'viking-cwv.config.json'),
    resolve(__dirname, '..', 'viking-cwv.config.json'),
  ].filter(Boolean) as string[];

  for (const location of configLocations) {
    if (existsSync(location)) {
      try {
        const content = readFileSync(location, 'utf-8');
        fileConfig = JSON.parse(content);
        break;
      } catch (error) {
        console.warn(`Warning: Failed to parse config file at ${location}`);
      }
    }
  }

  // Merge with defaults
  const config: Config = {
    ...defaultConfig,
    ...fileConfig,
    origins: fileConfig.origins || defaultConfig.origins,
  };

  // Load API key from environment
  config.apiKey = process.env.PSI_API_KEY;

  return config;
}

/**
 * Apply CLI options to config
 */
export function applyCliOptions(config: Config, options: CLIOptions): Config {
  const result = { ...config };

  if (options.samples !== undefined) {
    result.samplesPerType = options.samples;
  }

  if (options.property) {
    const propertyName = options.property.toLowerCase();
    result.origins = config.origins.filter(
      (o) => o.name.toLowerCase() === propertyName
    );

    if (result.origins.length === 0) {
      throw new Error(
        `Unknown property: ${options.property}. ` +
          `Available: ${config.origins.map((o) => o.name).join(', ')}`
      );
    }
  }

  return result;
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config, cruxOnly: boolean): void {
  if (!cruxOnly && !config.apiKey) {
    throw new Error(
      'PSI_API_KEY environment variable is required.\n' +
        'Set it in your .env file or export it in your shell.\n' +
        'Get your API key at: https://console.cloud.google.com/apis/credentials'
    );
  }

  if (config.origins.length === 0) {
    throw new Error('No origins configured');
  }

  if (config.samplesPerType < 1) {
    throw new Error('samplesPerType must be at least 1');
  }
}
