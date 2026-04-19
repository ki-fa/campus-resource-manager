import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(__dirname, "config", "university-sites.example.json");
const commonPathWords = new Set([
  "college",
  "colleges",
  "school",
  "schools",
  "department",
  "departments",
  "program",
  "programs",
  "academics",
  "academic",
  "majors",
  "major"
]);

function parseArgs(argv) {
  const args = {
    configPath: defaultConfigPath,
    filePath: null,
    dryRun: false,
    urls: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--config") {
      args.configPath = resolvePath(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--file") {
      args.filePath = resolvePath(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value) {
      args.urls.push(value);
    }
  }

  return args;
}

function resolvePath(value) {
  if (!value) {
    return defaultConfigPath;
  }

  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function normalizeWhitespace(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function humanizeSlug(value) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupeStrings(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeWhitespace(value)))];
}

function normalizeStartUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function normalizeConfigShape(rawConfig) {
  const legacyDefaults = rawConfig.defaults || {};
  const crawlDefaults = {
    ...legacyDefaults,
    ...(rawConfig.crawlDefaults || {})
  };
  delete crawlDefaults.excludeUrlPatterns;
  delete crawlDefaults.relevantKeywords;

  const siteDefaults = {
    excludeUrlPatterns: dedupeStrings([
      ...(legacyDefaults.excludeUrlPatterns || []),
      ...((rawConfig.siteDefaults && rawConfig.siteDefaults.excludeUrlPatterns) || [])
    ]),
    relevantKeywords: dedupeStrings([
      ...(legacyDefaults.relevantKeywords || []),
      ...((rawConfig.siteDefaults && rawConfig.siteDefaults.relevantKeywords) || [])
    ])
  };

  return {
    crawlDefaults,
    siteDefaults,
    sites: rawConfig.sites || []
  };
}

function serializeConfigShape(config) {
  return {
    crawlDefaults: config.crawlDefaults,
    siteDefaults: config.siteDefaults,
    sites: config.sites
  };
}

function getDomainToken(hostname) {
  const parts = hostname.split(".").filter((part) => part && part !== "www");
  return parts[0] || hostname;
}

function domainLabel(hostname) {
  const token = getDomainToken(hostname);
  return token.length <= 6 ? token.toUpperCase() : humanizeSlug(token);
}

function deriveSectionToken(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const meaningful = segments.filter((segment) => !commonPathWords.has(segment.toLowerCase()));
  return meaningful.at(-1) || segments.at(-1) || getDomainToken(url.hostname);
}

function deriveIncludePattern(url) {
  const pathname = url.pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function nextUniqueId(baseId, usedIds) {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let index = 2;
  while (usedIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  const uniqueId = `${baseId}-${index}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

function buildSiteEntry(rawUrl, usedIds) {
  const normalizedStartUrl = normalizeStartUrl(rawUrl);
  const url = new URL(normalizedStartUrl);
  const sectionToken = deriveSectionToken(url);
  const siteId = nextUniqueId(slugify(`${getDomainToken(url.hostname)}-${sectionToken}`), usedIds);
  const sectionLabel = humanizeSlug(sectionToken);
  const schoolLabel = domainLabel(url.hostname);
  const label = sectionLabel.toLowerCase().startsWith(schoolLabel.toLowerCase())
    ? sectionLabel
    : `${schoolLabel} ${sectionLabel}`;

  return {
    id: siteId,
    label,
    startUrls: [normalizedStartUrl],
    allowedDomains: [url.hostname],
    includeUrlPatterns: [deriveIncludePattern(url)]
  };
}

async function loadUrlsFromFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawConfig = JSON.parse(await fs.readFile(args.configPath, "utf8"));
  const config = normalizeConfigShape(rawConfig);
  const urlsFromFile = args.filePath ? await loadUrlsFromFile(args.filePath) : [];
  const requestedUrls = dedupeStrings([...args.urls, ...urlsFromFile]);

  if (!requestedUrls.length) {
    throw new Error("Provide one or more URLs or use --file with a newline-separated list.");
  }

  const usedIds = new Set(config.sites.map((site) => site.id));
  const existingStartUrls = new Set(
    config.sites.flatMap((site) => (site.startUrls || []).map((url) => normalizeStartUrl(url)))
  );

  const added = [];
  const skipped = [];

  for (const rawUrl of requestedUrls) {
    const normalizedStartUrl = normalizeStartUrl(rawUrl);
    if (existingStartUrls.has(normalizedStartUrl)) {
      skipped.push({ url: normalizedStartUrl, reason: "already exists" });
      continue;
    }

    const entry = buildSiteEntry(normalizedStartUrl, usedIds);
    added.push(entry);
    existingStartUrls.add(normalizedStartUrl);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ added, skipped }, null, 2));
    return;
  }

  config.sites = [...config.sites, ...added].sort((left, right) => left.label.localeCompare(right.label));
  await fs.writeFile(args.configPath, JSON.stringify(serializeConfigShape(config), null, 2), "utf8");

  console.log(`Added ${added.length} site entries to ${args.configPath}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} URLs that were already present.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
