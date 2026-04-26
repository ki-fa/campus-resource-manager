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

## Hosted deployment: Vercel + Render + MongoDB Atlas

This repo is now ready for split hosting:

- Vercel serves the Vite frontend from `dist/`.
- Render runs the Express API from `server/index.js`.
- MongoDB Atlas stores user profile data for the backend.

The existing resource wiki data still comes from `scraper/output/parsed/`. MongoDB is wired for user information through the API scaffold under `/api/users/*`.

### Environment variables

Frontend on Vercel:

- `VITE_API_BASE_URL`: your Render service URL, for example `https://campus-resource-manager-api.onrender.com`

Backend on Render:

- `NODE_ENV`: `production`
- `MONGODB_URI`: Atlas connection string from MongoDB Atlas
- `MONGODB_DB_NAME`: `database name`
- `ALLOWED_ORIGINS`: comma-separated frontend origins, for example `https://your-project.vercel.app`
- `CLIENT_URL`: optional frontend URL used by local-style redirects when a built client is unavailable

Use `.env.example` as the local reference. Do not commit a real `.env` file.

### 1. MongoDB Atlas

1. Create an Atlas project and cluster.
2. Create a database user with read/write access to `campus_resource_manager`.
3. Copy the Node.js SRV connection string and replace the username/password placeholders.
4. In Network Access, allow the Render service outbound IP ranges once the Render service exists. For early testing only, you can temporarily allow `0.0.0.0/0` if the database password is strong, then tighten it to Render's outbound ranges.

### 2. Render backend

You can use the included `render.yaml` as a Blueprint, or create a Web Service manually.

Manual settings:

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Environment variables: use the backend variables listed above

After the first successful deploy, open:

- `https://your-render-service.onrender.com/health`
- `https://your-render-service.onrender.com/api/health`
- `https://your-render-service.onrender.com/api/resources/index`

The basic `/health` response should be `OK`. The detailed `/api/health` response should show `ok: true`; after Atlas is configured, it should also show `database.connected: true`.

### 3. Vercel frontend

1. Import this Git repo into Vercel.
2. Use the Vite framework preset. The included `vercel.json` sets `npm run build`, `dist`, and client-side rewrites for `/resources` routes.
3. Add `VITE_API_BASE_URL` with your Render URL.
4. Deploy.
5. Add the deployed Vercel domain to Render's `ALLOWED_ORIGINS`, then redeploy or restart the Render service.

Verify the deployed Vercel app can load resource data and direct links like `/resources/some-resource-id`.

### User profile API scaffold

The backend includes a small Mongo-backed profile endpoint for future user information:

- `GET /api/users/status`
- `POST /api/users/profiles`

Example profile body:

```json
{
  "email": "student@example.com",
  "displayName": "Student Name",
  "major": "Computer Science",
  "graduationTerm": "Spring 2027",
  "interests": ["advising", "internships"]
}
```

This endpoint intentionally rejects passwords. Add a real authentication flow before storing sensitive user data.

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
