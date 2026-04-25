# Campus Resource Manager

A lightweight student resource wiki that makes campus support easier to find using scraper-driven data.

## Stack

- React + Vite for the frontend
- Express for a small backend API
- Plain CSS for the first-pass visual design

## Website app (frontend + API)

The website is now a simple, content-first wiki experience:

- `/` home view with quick category actions and resource counts
- `/resources` list view with search + filters (department, category, link type)
- `/resources/:id` detail view with cleaned content blocks, useful links, and source URL

The frontend consumes parsed scraper output through Express API endpoints:

- `GET /api/resources/index` -> summary + per-site metadata
- `GET /api/resources/combined` -> combined parsed data (`resources.json`)
- `GET /api/resources/site/:siteId` -> site-specific parsed payload

Data handling in the website:

- Resolves relative links against each page URL
- Removes common navigation/footer boilerplate from extracted headings/content
- Builds derived fields (`sourceHost`, `readingEstimate`, `linkCount`, search text)
- Supports lazy loading by site for larger datasets

## Project structure

- `src/` contains the React wiki app
- `src/lib/resourceData.js` contains normalization/filtering/search helpers
- `server/` contains the Express API for parsed scraper data
- `vite.config.js` proxies `/api` requests to the Express server during development

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`
3. Run `npm run dev`

The React app will run on `http://localhost:5173` and the Express API will run on `http://localhost:3001`.
In development, visiting port `3001` redirects to the frontend on port `5173`.

If you are running this on a server, open `http://your-server-ip:5173` or `http://your-server-ip:3001`.

## Run on a server

For a remote server, the simplest path is:

1. Run `npm install`
2. Run `npm run build`
3. Run `npm start`

After that, open `http://your-server-ip:3001`.

The Express server now serves the built frontend automatically whenever `dist/index.html` exists, so you do not need to set `NODE_ENV=production` just to view the app.

## Scraper pipeline

The repo now also includes a config-driven scraper pipeline under `scraper/`.

- `npm run scrape:add-sites -- --file scraper/config/urls.txt`
- `npm run scrape:validate -- scraper/config/university-sites.example.json`
- `npm run scrape:install-browser`
- `npm run scrape:crawl -- scraper/config/university-sites.example.json`
- `python scraper/normalize.py --config scraper/config/university-sites.example.json`

The crawler uses `Crawlee + Playwright` to crawl only the university pages you allow in config, and the parser uses `BeautifulSoup` to turn the raw crawl output into deduplicated JSON files for the web app.

## Website notes

- The UI is intentionally minimal and wiki-like, with clearer defaults for students.
- Parsed files under `scraper/output/parsed/` are the source of truth for the website.
- Per-site parsed files are used for lazy loading when data grows.