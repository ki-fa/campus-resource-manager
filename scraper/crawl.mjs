import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PlaywrightCrawler, RequestQueue } from "crawlee";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(__dirname, "config", "university-sites.example.json");
const outputRoot = path.join(__dirname, "output");
const rawOutputDir = path.join(outputRoot, "raw");

function parseArgs(argv) {
  const args = {
    configPath: defaultConfigPath,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value === "--config") {
      args.configPath = resolveConfigPath(argv[index + 1]);
      index += 1;
      continue;
    }

    if (!value.startsWith("--")) {
      args.configPath = resolveConfigPath(value);
    }
  }

  return args;
}

function resolveConfigPath(value) {
  if (!value) {
    return defaultConfigPath;
  }

  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeWhitespace(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizePattern(value) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/\/+$/, "");
}

function dedupeBy(items, getKey) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function dedupeStrings(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeUrl(rawUrl, config) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const stripQueryParams = config.stripQueryParams || [];
    for (const param of stripQueryParams) {
      url.searchParams.delete(param);
    }

    const orderedEntries = [...url.searchParams.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    );
    url.search = "";
    for (const [key, value] of orderedEntries) {
      url.searchParams.append(key, value);
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

function hasBlockedExtension(urlValue, blockedExtensions = []) {
  try {
    const pathname = new URL(urlValue).pathname.toLowerCase();
    return blockedExtensions.some((extension) => pathname.endsWith(extension.toLowerCase()));
  } catch {
    return false;
  }
}

function matchesPatternList(value, patterns = []) {
  if (!patterns.length) {
    return true;
  }

  const comparableValue = normalizePattern(value);
  return patterns.some((pattern) => comparableValue.includes(normalizePattern(pattern)));
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

function isAllowedUrl(urlValue, config) {
  const normalized = normalizeUrl(urlValue, config);
  if (!normalized) {
    return false;
  }

  const url = new URL(normalized);
  const allowedDomains = config.allowedDomains || [];
  const includePatterns = config.includeUrlPatterns || [];
  const excludePatterns = config.excludeUrlPatterns || [];
  const blockedExtensions = config.blockedExtensions || [];
  const domainAllowed = !allowedDomains.length || allowedDomains.includes(url.hostname);

  if (!domainAllowed) {
    return false;
  }

  if (hasBlockedExtension(normalized, blockedExtensions)) {
    return false;
  }

  if (excludePatterns.length && matchesPatternList(normalized, excludePatterns)) {
    return false;
  }

  if (includePatterns.length && !matchesPatternList(normalized, includePatterns)) {
    return false;
  }

  return true;
}

function keywordMatches(text, keywords = []) {
  if (!keywords.length) {
    return [];
  }

  const haystack = text.toLowerCase();
  return [...new Set(keywords.filter((keyword) => haystack.includes(keyword.toLowerCase())))];
}

function pageHash(pageRecord) {
  return crypto
    .createHash("sha1")
    .update(`${pageRecord.url}|${pageRecord.title}|${pageRecord.text}`)
    .digest("hex");
}

async function loadConfig(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);

  if (!Array.isArray(config.sites) || !config.sites.length) {
    throw new Error("Scraper config must include a non-empty 'sites' array.");
  }

  return normalizeConfigShape(config);
}

function buildSiteConfig(crawlDefaults, siteDefaults, site) {
  const merged = {
    ...crawlDefaults,
    ...site,
    contentSelectors: site.contentSelectors || crawlDefaults.contentSelectors || [],
    stripQueryParams: site.stripQueryParams || crawlDefaults.stripQueryParams || [],
    blockedExtensions: site.blockedExtensions || crawlDefaults.blockedExtensions || [],
    excludeUrlPatterns: dedupeStrings([
      ...(siteDefaults.excludeUrlPatterns || []),
      ...(site.excludeUrlPatterns || [])
    ]),
    relevantKeywords: dedupeStrings([
      ...(siteDefaults.relevantKeywords || []),
      ...(site.relevantKeywords || [])
    ])
  };

  if (!merged.id) {
    throw new Error("Each site config requires an 'id'.");
  }

  if (!Array.isArray(merged.startUrls) || !merged.startUrls.length) {
    throw new Error(`Site '${merged.id}' must include at least one start URL.`);
  }

  return merged;
}

async function ensureOutputDirs() {
  await fs.mkdir(rawOutputDir, { recursive: true });
}

async function crawlSite(siteConfig) {
  const pages = [];
  const seenPageUrls = new Set();
  const queue = await RequestQueue.open(`scrape-${siteConfig.id}-${Date.now()}`);

  for (const startUrl of siteConfig.startUrls) {
    const normalized = normalizeUrl(startUrl, siteConfig);
    if (!normalized) {
      continue;
    }

    await queue.addRequest({
      url: normalized,
      uniqueKey: normalized,
      userData: {
        depth: 0,
        isSeed: true
      }
    });
  }

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxRequestsPerCrawl: siteConfig.maxRequestsPerCrawl,
    navigationTimeoutSecs: siteConfig.navigationTimeoutSecs,
    requestHandlerTimeoutSecs: siteConfig.requestHandlerTimeoutSecs,
    respectRobotsTxtFile: siteConfig.respectRobotsTxtFile,
    async requestHandler(context) {
      const { request, page, enqueueLinks, log } = context;
      const currentDepth = request.userData.depth || 0;
      const loadedUrl = normalizeUrl(request.loadedUrl || request.url, siteConfig);
      const allowedCurrentPage = request.userData.isSeed || isAllowedUrl(loadedUrl, siteConfig);

      if (!loadedUrl || seenPageUrls.has(loadedUrl) || !allowedCurrentPage) {
        return;
      }

      seenPageUrls.add(loadedUrl);
      await page.waitForLoadState("domcontentloaded");

      const title = normalizeWhitespace(await page.title());
      const html = siteConfig.includeHtml ? await page.content() : "";
      const extracted = await page.evaluate(({ contentSelectors, maxLinksPerPage }) => {
        const selectors = contentSelectors || [];
        const root =
          selectors
            .map((selector) => document.querySelector(selector))
            .find(Boolean) || document.body;

        const text = (root?.innerText || document.body?.innerText || "").replace(/\s+/g, " ").trim();
        const metaDescription =
          document
            .querySelector("meta[name='description']")
            ?.getAttribute("content")
            ?.replace(/\s+/g, " ")
            .trim() || "";
        const headings = [...document.querySelectorAll("h1, h2, h3")]
          .map((node) => node.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 25);
        const links = [...(root || document.body).querySelectorAll("a[href]")]
          .map((anchor) => ({
            href: anchor.href,
            text: (anchor.textContent || "").replace(/\s+/g, " ").trim()
          }))
          .filter((link) => link.href)
          .slice(0, maxLinksPerPage || 100);

        return {
          metaDescription,
          headings,
          text,
          links
        };
      }, { contentSelectors: siteConfig.contentSelectors, maxLinksPerPage: siteConfig.maxLinksPerPage });

      const pageText = normalizeWhitespace(extracted.text);
      const pageKeywords = keywordMatches(
        [loadedUrl, title, extracted.metaDescription, pageText].join(" "),
        siteConfig.relevantKeywords
      );
      const normalizedLinks = dedupeBy(
        extracted.links
          .map((link) => ({
            url: normalizeUrl(link.href, siteConfig),
            text: normalizeWhitespace(link.text)
          }))
          .filter((link) => link.url && isAllowedUrl(link.url, siteConfig)),
        (link) => `${link.url}|${link.text}`
      );

      const record = {
        id: pageHash({
          url: loadedUrl,
          title,
          text: pageText
        }),
        url: loadedUrl,
        title,
        metaDescription: extracted.metaDescription,
        text: pageText,
        headings: dedupeBy(extracted.headings, (heading) => heading),
        matchedKeywords: pageKeywords,
        links: normalizedLinks,
        html,
        crawledAt: new Date().toISOString(),
        isRelevant: Boolean(pageKeywords.length || pageText.length >= siteConfig.minTextLength || normalizedLinks.length)
      };

      if (record.title || record.text || record.links.length) {
        pages.push(record);
      }

      if (currentDepth >= siteConfig.maxDepth) {
        return;
      }

      await enqueueLinks({
        strategy: "same-domain",
		limit: 100,
        transformRequestFunction: (options) => {
          const normalizedUrl = normalizeUrl(options.url, siteConfig);
          if (!normalizedUrl || !isAllowedUrl(normalizedUrl, siteConfig)) {
            return false;
          }

          return {
            ...options,
            url: normalizedUrl,
            uniqueKey: normalizedUrl,
            userData: {
              ...(options.userData || {}),
              depth: currentDepth + 1,
              isSeed: false
            }
          };
        }
      });

      log.debug(`Captured ${loadedUrl}`);
    }
  });

  await crawler.run();

  return {
    siteId: siteConfig.id,
    label: siteConfig.label || siteConfig.id,
    generatedAt: new Date().toISOString(),
    config: {
      startUrls: siteConfig.startUrls,
      allowedDomains: siteConfig.allowedDomains || [],
      includeUrlPatterns: siteConfig.includeUrlPatterns || [],
      excludeUrlPatterns: siteConfig.excludeUrlPatterns || [],
      relevantKeywords: siteConfig.relevantKeywords || []
    },
    stats: {
      pages: pages.length,
      uniqueLinks: dedupeBy(
        pages.flatMap((page) => page.links),
        (link) => link.url
      ).length
    },
    pages: dedupeBy(pages, (page) => page.url)
  };
}

async function writeSiteOutput(siteResult) {
  const filename = `${slugify(siteResult.siteId)}.json`;
  const outputPath = path.join(rawOutputDir, filename);
  await fs.writeFile(outputPath, JSON.stringify(siteResult, null, 2), "utf8");
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.configPath);
  const sites = config.sites.map((site) => buildSiteConfig(config.crawlDefaults, config.siteDefaults, site));

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          configPath: args.configPath,
          crawlDefaults: config.crawlDefaults,
          siteDefaults: config.siteDefaults,
          sites: sites.map((site) => ({
            id: site.id,
            startUrls: site.startUrls,
            allowedDomains: site.allowedDomains || [],
            includeUrlPatterns: site.includeUrlPatterns || [],
            excludeUrlPatterns: site.excludeUrlPatterns || [],
            relevantKeywords: site.relevantKeywords || []
          }))
        },
        null,
        2
      )
    );
    return;
  }

  await ensureOutputDirs();

  for (const site of sites) {
    console.log(`Crawling ${site.id}...`);
    const result = await crawlSite(site);
    const outputPath = await writeSiteOutput(result);
    console.log(`Saved ${result.pages.length} pages to ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
