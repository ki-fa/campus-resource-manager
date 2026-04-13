# Campus Resource Manager

A lightweight student resource hub homepage built to make campus support easier to find.

## Stack

- React + Vite for the frontend
- Express for a small backend API
- Plain CSS for the first-pass visual design

## What is included

- A polished homepage using a green, white, and muted tan palette
- Major-specific resource browsing with a simple major selector
- General campus resource cards for common student needs
- A starter Express endpoint at `/api/homepage-data`

## Project structure

- `src/` contains the React app
- `server/` contains the Express server and homepage data
- `vite.config.js` proxies `/api` requests to the Express server during development

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`
3. Run `npm run dev`

The React app will run on `http://localhost:5173` and the Express API will run on `http://localhost:3001`.
In development, visiting port `3001` now redirects to the frontend on port `5173`.

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

- `npm run scrape:validate -- scraper/config/university-sites.example.json`
- `npm run scrape:install-browser`
- `npm run scrape:crawl -- scraper/config/university-sites.example.json`
- `python scraper/normalize.py --config scraper/config/university-sites.example.json`

The crawler uses `Crawlee + Playwright` to crawl only the university pages you allow in config, and the parser uses `BeautifulSoup` to turn the raw crawl output into deduplicated JSON files for the web app.

## Next good steps

- Replace placeholder `#` links with real university pages
- Add search across resources, forms, and offices
- Connect real department, club, scholarship, and advising data
- Add saved resources or student login later if needed
