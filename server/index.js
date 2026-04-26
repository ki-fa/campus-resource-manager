import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { closeDatabaseConnection, getDatabaseStatus } from "./db.js";
import { registerUserRoutes } from "./users.js";

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || "0.0.0.0";
const clientPort = process.env.CLIENT_PORT || 5173;
const configuredClientUrl = process.env.CLIENT_URL || "";
const isHostedApiOnly = process.env.RENDER === "true" || process.env.NODE_ENV === "production";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");
const distIndexPath = path.join(distPath, "index.html");
const hasBuiltClient = fs.existsSync(distIndexPath);
const parsedDataDir = path.resolve(__dirname, "../scraper/output/parsed");
const combinedPath = path.join(parsedDataDir, "resources.json");
const localClientOrigins = [
  `http://localhost:${clientPort}`,
  `http://127.0.0.1:${clientPort}`
];
const allowedOrigins = new Set([
  ...localClientOrigins,
  ...parseOrigins(process.env.CLIENT_ORIGIN),
  ...parseOrigins(process.env.ALLOWED_ORIGINS)
]);

function parseOrigins(value = "") {
  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.has("*") || allowedOrigins.has(origin.replace(/\/+$/, ""));
}

function applyCors(request, response, next) {
  const origin = request.headers.origin;

  if (origin && isAllowedOrigin(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
    response.set("Access-Control-Allow-Credentials", "true");
  }

  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) {
      response.status(403).json({ message: "Origin is not allowed." });
      return;
    }

    response.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.set(
      "Access-Control-Allow-Headers",
      request.headers["access-control-request-headers"] || "Content-Type, Authorization"
    );
    response.status(204).end();
    return;
  }

  next();
}

function getDevelopmentClientUrl(request) {
  if (configuredClientUrl) {
    return configuredClientUrl;
  }

  const forwardedHost = request.headers["x-forwarded-host"];
  const hostHeader = forwardedHost || request.headers.host || "localhost";
  const hostname = hostHeader.split(",")[0].trim().replace(/:\d+$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = forwardedProto
    ? forwardedProto.split(",")[0].trim()
    : request.protocol;

  return `${protocol}://${hostname}:${clientPort}`;
}

app.use(applyCors);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    database: await getDatabaseStatus()
  });
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

registerUserRoutes(app);

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || 500;
  response.status(statusCode).json({
    message: statusCode === 500 ? "Unexpected server error." : error.message
  });
});

if (hasBuiltClient) {
  app.use(express.static(distPath));

  app.use((_request, response) => {
    response.sendFile(distIndexPath);
  });
} else if (isHostedApiOnly) {
  app.get("/", (_request, response) => {
    response.json({
      ok: true,
      service: "campus-resource-manager-api",
      health: "/api/health"
    });
  });
} else {
  app.get("/", (request, response) => {
    response.redirect(getDevelopmentClientUrl(request));
  });
}

const server = app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down server.`);
  server.close(async () => {
    await closeDatabaseConnection();
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
