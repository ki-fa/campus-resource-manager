import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { homepageData } from "./data/homepageData.js";

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || "0.0.0.0";
const clientPort = process.env.CLIENT_PORT || 5173;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");
const distIndexPath = path.join(distPath, "index.html");
const hasBuiltClient = fs.existsSync(distIndexPath);

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

app.get("/api/homepage-data", (_request, response) => {
  response.json(homepageData);
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
