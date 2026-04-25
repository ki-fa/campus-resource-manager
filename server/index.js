import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || "0.0.0.0";
const clientPort = process.env.CLIENT_PORT || 5173;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");
const distIndexPath = path.join(distPath, "index.html");
const hasBuiltClient = fs.existsSync(distIndexPath);
const parsedDataDir = path.resolve(__dirname, "../scraper/output/parsed");
const combinedPath = path.join(parsedDataDir, "resources.json");

function getDevelopmentClientUrl(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  const hostHeader = forwardedHost || request.headers.host || "localhost";
  const hostname = hostHeader.split(",")[0].trim().replace(/:\d+$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : request.protocol;

  return `${protocol}://${hostname}:${clientPort}`;
}

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getSiteFiles() {
  if (!fs.existsSync(parsedDataDir)) {
    return [];
  }

  return fs
    .readdirSync(parsedDataDir)
    .filter((file) => file.endsWith(".json") && file !== "resources.json")
    .map((filename) => {
      const payload = readJson(path.join(parsedDataDir, filename));
      return {
        file: filename,
        siteId: payload.siteId,
        label: payload.label,
        pageCount: payload.pageCount,
        linkCount: payload.linkCount
      };
    });
}

function cacheJson(response, payload) {
  response.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
  response.json(payload);
}

app.get("/api/resources/index", (_request, response) => {
  if (!fs.existsSync(combinedPath)) {
    response.status(404).json({ message: "Combined resources file not found." });
    return;
  }

  const combined = readJson(combinedPath);
  const sites = getSiteFiles();

  cacheJson(response, {
    summary: combined.summary || {},
    sites
  });
});

app.get("/api/resources/combined", (_request, response) => {
  if (!fs.existsSync(combinedPath)) {
    response.status(404).json({ message: "Combined resources file not found." });
    return;
  }

  cacheJson(response, readJson(combinedPath));
});

app.get("/api/resources/site/:siteId", (request, response) => {
  const siteId = request.params.siteId;
  const siteFile = path.join(parsedDataDir, `${slugify(siteId)}.json`);

  if (!fs.existsSync(siteFile)) {
    response.status(404).json({ message: `Site data not found for '${siteId}'.` });
    return;
  }

  cacheJson(response, readJson(siteFile));
});

if (hasBuiltClient) {
  app.use(express.static(distPath));

  app.use((_request, response) => {
    response.sendFile(distIndexPath);
  });
} else {
  app.get("/", (request, response) => {
    response.redirect(getDevelopmentClientUrl(request));
  });
}

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
