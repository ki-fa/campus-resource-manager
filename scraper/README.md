# Scraper Pipeline

This scraper is split into two parts:

1. `Crawlee + Playwright` crawls only the university pages you allow in config.
2. `BeautifulSoup` parses the saved page HTML into deduplicated JSON that is easier to feed into the web app.

## Files

- `config/university-sites.example.json` contains the crawl configuration
- `add-sites.mjs` converts a list of URLs into site entries in the config
- `crawl.mjs` runs the crawler and writes raw JSON to `output/raw/`
- `normalize.py` parses the raw JSON and writes deduplicated JSON to `output/parsed/`
- `requirements.txt` contains the Python dependency for the parser

## Friendlier config shape

The config now separates shared settings from per-site settings:

- `crawlDefaults`: crawl behavior like depth, selectors, and query param stripping
- `siteDefaults`: shared `excludeUrlPatterns` and shared `relevantKeywords`
- `sites`: only the site-specific pieces such as `id`, `label`, `startUrls`, `allowedDomains`, and `includeUrlPatterns`

This keeps repetitive lists out of each site entry while still letting a site add its own `excludeUrlPatterns` or `relevantKeywords` when needed.

## Adding sites from a URL list

### Inline URLs

```bash
npm run scrape:add-sites -- https://www.csus.edu/college/arts-letters/art/ https://www.csus.edu/college/engineering-computer-science/computer-science/
```

### File of URLs

Create a text file with one URL per line, then run:

```bash
npm run scrape:add-sites -- --file scraper/config/urls.txt
```

### Dry run

```bash
npm run scrape:add-sites -- --dry-run https://www.csus.edu/college/arts-letters/art/
```

The helper script deduplicates by start URL, generates an `id`, `label`, `allowedDomains`, and `includeUrlPatterns`, and appends the new entries to the config.

## Running it

### 1. Validate your config

```bash
npm run scrape:validate -- scraper/config/university-sites.example.json
```

### 2. Install the Playwright browser once

```bash
npm run scrape:install-browser
```

### 3. Crawl pages

```bash
npm run scrape:crawl -- scraper/config/university-sites.example.json
```

Raw output is written as one JSON file per configured site to `scraper/output/raw/`.

### 4. Install Python parser dependency

```bash
python -m pip install -r scraper/requirements.txt
```

If your system uses `python3`, use:

```bash
python3 -m pip install -r scraper/requirements.txt
```

### 5. Parse and deduplicate with BeautifulSoup

```bash
python scraper/normalize.py --config scraper/config/university-sites.example.json
```

Or:

```bash
python3 scraper/normalize.py --config scraper/config/university-sites.example.json
```

Parsed output is written to `scraper/output/parsed/`.

## Output shape

The combined parsed output file is `scraper/output/parsed/resources.json`.

It contains:

- `summary`: crawl totals and category counts
- `pages`: deduplicated pages with title, description, headings, content blocks, and links
- `links`: deduplicated link records across all pages

Each configured site also gets its own parsed JSON file in `scraper/output/parsed/`.

## How frontend consumes parsed output

The website app reads parsed data through Express API routes (from the repo root server):

- `GET /api/resources/index`: returns `summary` plus per-site metadata used for counters and filter options.
- `GET /api/resources/combined`: returns the full combined parsed payload (same shape as `resources.json`).
- `GET /api/resources/site/:siteId`: returns one site payload for lazy loading as data grows.

Frontend behavior is intentionally simple:

- Treats parsed JSON as the source of truth (no HTML parsing in the browser).
- Resolves relative link values against each page URL.
- Applies light cleanup to reduce obvious nav/footer boilerplate text.
- Derives helper fields for UX (`sourceHost`, `readingEstimate`, `linkCount`, search text).

This keeps the UI lightweight while preserving the scraper/parser pipeline as the single data-prep layer.

## Notes

- Shared siteDefaults keep repetitive patterns in one place.
- The crawler skips common document and image file extensions by default so PDF downloads are not treated like HTML pages.
- You can still add site-specific `relevantKeywords` or `excludeUrlPatterns` when a section needs extra rules.
- The crawler normalizes URLs and strips common tracking query parameters to reduce duplicates.
- The parser deduplicates pages by URL and links by URL.
- The raw crawler output can include full HTML so the BeautifulSoup stage has enough material to extract structured content.
- Be mindful of site terms, robots rules, and rate limits when scraping university pages.


