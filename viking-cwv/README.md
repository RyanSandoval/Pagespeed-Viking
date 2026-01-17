# Viking Core Web Vitals Tool

A Node.js CLI tool that generates Core Web Vitals scorecards for Viking web properties by crawling sitemaps and running PageSpeed Insights analysis.

## Features

- **CrUX Field Data** - Fetches origin-level Chrome User Experience Report data for real-world performance metrics
- **PSI Lab Data** - Runs PageSpeed Insights analysis on sampled URLs for detailed performance audits
- **Sitemap Crawling** - Automatically discovers and parses sitemaps with path filtering support
- **URL Categorization** - Classifies pages by type (itinerary, ship, destination, landing)
- **Random Sampling** - Configurable sample size per page type for representative analysis
- **Multi-format Reports** - Generates both JSON and Markdown reports

## Supported Properties

| Property   | Domain                        | Notes                           |
|------------|-------------------------------|---------------------------------|
| River      | vikingrivercruises.com        | Separate origin                 |
| Ocean      | vikingcruises.com/oceans      | Shares origin with Expedition   |
| Expedition | vikingcruises.com/expeditions | Shares origin with Ocean        |
| Portal     | viking.com                    | CrUX only (sitemap unavailable) |

## Prerequisites

- Node.js 18+
- Google Cloud API key with the following APIs enabled:
  - [PageSpeed Insights API](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com)
  - [Chrome UX Report API](https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com)

Both APIs are free. PSI has a 25,000 queries/day limit.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd viking-cwv

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Set up your API key
cp .env.example .env
# Edit .env and add your PSI_API_KEY
```

## Usage

```bash
# Full analysis with defaults (5 samples per page type)
node dist/index.js

# Custom number of samples per page type
node dist/index.js --samples 10

# Only fetch CrUX field data (skip PSI lab analysis)
node dist/index.js --crux-only

# Analyze a specific property only
node dist/index.js --property river
node dist/index.js --property ocean
node dist/index.js --property expedition

# Choose output format
node dist/index.js --format json
node dist/index.js --format markdown
node dist/index.js --format both

# Verbose mode (show detailed progress)
node dist/index.js --verbose

# Use a custom config file
node dist/index.js --config ./my-config.json
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --samples <number>` | Number of URLs to sample per page type | 5 |
| `--crux-only` | Only fetch CrUX data, skip PSI sampling | false |
| `-p, --property <name>` | Only analyze a specific property | all |
| `-f, --format <format>` | Output format: json, markdown, or both | both |
| `-v, --verbose` | Show verbose output with progress details | false |
| `-c, --config <path>` | Path to custom config file | auto-detected |

## Configuration

The tool uses `viking-cwv.config.json` for configuration:

```json
{
  "origins": [
    {
      "name": "River",
      "origin": "https://vikingrivercruises.com",
      "sitemapUrl": "https://www.vikingrivercruises.com/sitemap.xml"
    },
    {
      "name": "Ocean",
      "origin": "https://vikingcruises.com",
      "sitemapUrl": "https://www.vikingcruises.com/sitemap.xml",
      "pathFilter": "/oceans/"
    },
    {
      "name": "Expedition",
      "origin": "https://vikingcruises.com",
      "sitemapUrl": "https://www.vikingcruises.com/sitemap.xml",
      "pathFilter": "/expeditions/"
    },
    {
      "name": "Portal",
      "origin": "https://viking.com",
      "cruxOnly": true
    }
  ],
  "samplesPerType": 5,
  "delayBetweenRequests": 1000,
  "strategy": "mobile",
  "outputDir": "./output"
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `origins` | Array of origin configurations | Viking properties |
| `samplesPerType` | URLs to sample per page type | 5 |
| `delayBetweenRequests` | Milliseconds between PSI requests | 1000 |
| `strategy` | PSI strategy: "mobile" or "desktop" | mobile |
| `outputDir` | Directory for output reports | ./output |

### Origin Configuration

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Display name for the property | Yes |
| `origin` | Origin URL for CrUX queries | Yes |
| `sitemapUrl` | URL to the sitemap XML | No |
| `pathFilter` | Path prefix to filter URLs | No |
| `cruxOnly` | Skip sitemap/PSI, only fetch CrUX | No |

## Output

Reports are saved to the `output/` directory with timestamps:

- `cwv-report-YYYY-MM-DD.json` - Full JSON report with all data
- `cwv-report-YYYY-MM-DD.md` - Markdown summary for sharing

### Sample Markdown Output

```markdown
# Viking Core Web Vitals Report
Generated: January 17, 2026

## Summary
**Status: FAIL** (0/3 origins passing)

| Origin | LCP | INP | CLS | Status |
|--------|-----|-----|-----|--------|
| vikingrivercruises.com | 2.5s | 117ms | 0.22 | FAIL |
| vikingcruises.com | 3.1s | 138ms | 0.14 | FAIL |
| viking.com | 3.8s | 137ms | 0.16 | FAIL |

## Page Type Breakdown (Lab Data)

### River (vikingrivercruises.com)

| Page Type | Samples | Avg Score | Avg LCP | Avg CLS |
|-----------|---------|-----------|---------|---------|
| itinerary | 5 | 62 | 3.2s | 0.18 |
| ship | 5 | 71 | 2.8s | 0.12 |
| destination | 5 | 58 | 3.5s | 0.24 |
```

## Core Web Vitals Thresholds

The tool uses Google's official thresholds:

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP (Largest Contentful Paint) | ≤2500ms | 2500-4000ms | >4000ms |
| INP (Interaction to Next Paint) | ≤200ms | 200-500ms | >500ms |
| CLS (Cumulative Layout Shift) | ≤0.1 | 0.1-0.25 | >0.25 |

**Overall pass requires ALL THREE metrics in the "good" range.**

## Page Type Patterns

URLs are categorized by matching path patterns:

| Page Type | Patterns |
|-----------|----------|
| Itinerary | `/cruise-destinations/`, `/cruises/`, `/itinerary/` |
| Ship | `/ships/` |
| Destination | `/destinations/` |
| Landing | `/index.html`, top-level pages |
| Other | Everything else |

## API Key Security

**Recommended restrictions** for your Google Cloud API key:

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your API key
3. Under "API restrictions" → Restrict key
4. Select only:
   - PageSpeed Insights API
   - Chrome UX Report API
5. Optionally add IP restrictions if running from a fixed location

This ensures the key can only access these two free APIs even if leaked.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run directly with ts-node (if installed)
npx ts-node src/index.ts

# Watch mode for development
npm run build -- --watch
```

## Project Structure

```
viking-cwv/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── config.ts          # Config loading & validation
│   ├── robots.ts          # robots.txt parsing
│   ├── sitemap.ts         # Sitemap fetching & parsing
│   ├── categorize.ts      # URL categorization logic
│   ├── sample.ts          # Random sampling
│   ├── crux.ts            # CrUX API client
│   ├── psi.ts             # PageSpeed Insights API client
│   ├── report.ts          # Report generation (JSON + Markdown)
│   └── types.ts           # TypeScript interfaces
├── viking-cwv.config.json # Default configuration
├── package.json
├── tsconfig.json
├── .env.example           # API key template
└── .gitignore
```

## Troubleshooting

### "PSI_API_KEY environment variable is required"

Create a `.env` file with your API key:

```bash
cp .env.example .env
# Edit .env and add: PSI_API_KEY=your_key_here
```

### "Failed to fetch sitemap"

- Check that the sitemap URL is accessible
- Some sitemaps may require specific User-Agent headers
- Use `--verbose` to see detailed error messages

### Rate limiting errors

- Increase `delayBetweenRequests` in the config
- Reduce `--samples` count
- Use `--crux-only` for quick field data checks

### No CrUX data available

Low-traffic origins may not have CrUX data. This is normal for sites with fewer visitors. The tool will show "N/A" for missing metrics.

## License

ISC
