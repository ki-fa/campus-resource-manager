# Scraper Pipeline

This scraper is split into two parts:

1. `Crawlee + Playwright` crawls only the university pages you allow in config.
2. `BeautifulSoup` parses the saved page HTML into deduplicated JSON that is easier to feed into the web app.

## Files

- `config/university-sites.example.json` contains the crawl configuration
- `crawl.mjs` runs the crawler and writes raw JSON to `output/raw/`
- `normalize.py` parses the raw JSON and writes deduplicated JSON to `output/parsed/`
- `requirements.txt` contains the Python dependency for the parser

## How the config works

Each site entry can define:

- `id`: unique identifier for the site section
- `label`: human-readable name
- `startUrls`: pages where crawling begins
- `allowedDomains`: hostnames that are allowed
- `includeUrlPatterns`: only crawl URLs containing one of these values
- `excludeUrlPatterns`: skip URLs containing one of these values
- `relevantKeywords`: keywords used to tag relevant content
- `contentSelectors`: preferred selectors for main page content

This lets you point the scraper at a specific department, advising section, scholarship hub, or similar area without crawling the whole university.

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

## Notes

- The crawler normalizes URLs and strips common tracking query parameters to reduce duplicates.
- The parser deduplicates pages by URL and links by URL.
- The raw crawler output can include full HTML so the BeautifulSoup stage has enough material to extract structured content.
- Be mindful of site terms, robots rules, and rate limits when scraping university pages.
