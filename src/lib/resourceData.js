const BOILERPLATE_PATTERNS = [
  /^primary navigation$/i,
  /^explore$/i,
  /^campus contact information$/i,
  /^campus-wide social media navigation$/i,
  /^compliance links$/i,
  /^colleges & majors$/i,
  /^meet us icon$/i
];

const QUICK_CATEGORY_ORDER = [
  "advising",
  "forms",
  "scholarship",
  "internship",
  "career",
  "event"
];

const TRAILING_TITLE_SUFFIXES = [
  /\s*\|\s*Sacramento State\s*$/i
];

function normalizeWhitespace(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanTitle(value) {
  let title = normalizeWhitespace(value);
  for (const pattern of TRAILING_TITLE_SUFFIXES) {
    title = title.replace(pattern, "");
  }
  return title.trim();
}

function looksLikeBoilerplate(value) {
  if (!value) {
    return true;
  }

  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(value));
}

function uniqueBy(items, keyBuilder) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function resolveUrl(urlValue, pageUrl) {
  try {
    return new URL(urlValue, pageUrl).toString();
  } catch {
    return null;
  }
}

function getLinkType(urlValue) {
  if (!urlValue) {
    return "unknown";
  }
  if (urlValue.startsWith("mailto:")) {
    return "email";
  }
  if (/\.pdf([?#]|$)/i.test(urlValue)) {
    return "pdf";
  }
  return "web";
}

function sanitizeHeadings(headings) {
  return uniqueBy(
    (headings || [])
      .map((heading) => normalizeWhitespace(heading))
      .filter((heading) => heading.length > 2 && !looksLikeBoilerplate(heading)),
    (heading) => heading.toLowerCase()
  ).slice(0, 14);
}

function sanitizeContentBlocks(blocks) {
  return uniqueBy(
    (blocks || [])
      .map((block) => normalizeWhitespace(block))
      .filter((block) => block.length >= 35 && !looksLikeBoilerplate(block)),
    (block) => block.toLowerCase()
  ).slice(0, 22);
}

function normalizeLinks(links, pageUrl) {
  const normalizedLinks = (links || [])
    .map((link) => {
      const text = normalizeWhitespace(link.text);
      const resolvedUrl = resolveUrl(link.url, pageUrl);
      if (!resolvedUrl) {
        return null;
      }
      return {
        text: text || "Open link",
        originalUrl: link.url,
        url: resolvedUrl,
        type: getLinkType(resolvedUrl)
      };
    })
    .filter(Boolean);

  return uniqueBy(normalizedLinks, (link) => `${link.url}|${link.text}`);
}

export function normalizePage(page) {
  const headings = sanitizeHeadings(page.headings);
  const contentBlocks = sanitizeContentBlocks(page.contentBlocks);
  const links = normalizeLinks(page.links, page.url);
  const plainText = normalizeWhitespace(
    [page.title, page.description, ...headings, ...contentBlocks].join(" ")
  );
  const words = plainText.split(" ").filter(Boolean).length;
  const readingEstimate = Math.max(1, Math.round(words / 220));
  const sourceHost = (() => {
    try {
      return new URL(page.url).hostname;
    } catch {
      return "";
    }
  })();

  return {
    ...page,
    title: cleanTitle(page.title) || "Untitled resource",
    description: normalizeWhitespace(page.description) || "No summary available.",
    headings,
    contentBlocks,
    links,
    sourceHost,
    readingEstimate,
    linkCount: links.length,
    searchText: plainText.toLowerCase()
  };
}

export function normalizePages(pages) {
  return (pages || []).map(normalizePage);
}

export function filterPages(pages, { query, category, siteId }) {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const terms = normalizedQuery.split(" ").filter(Boolean);

  return pages
    .filter((page) => !siteId || page.siteId === siteId)
    .filter((page) => !category || page.categories?.includes(category))
    .map((page) => {
      let score = 0;
      if (terms.length) {
        for (const term of terms) {
          if (page.title.toLowerCase().includes(term)) score += 6;
          if (page.description.toLowerCase().includes(term)) score += 4;
          if (page.searchText.includes(term)) score += 1;
        }
      }
      return { page, score };
    })
    .filter((entry) => terms.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
    .map((entry) => entry.page);
}

export function collectCategories(pages) {
  const counts = new Map();
  for (const page of pages) {
    for (const category of page.categories || []) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

export function pickQuickCategories(categories) {
  const byName = new Map(categories.map((category) => [category.name, category]));
  const preferred = QUICK_CATEGORY_ORDER.map((name) => byName.get(name)).filter(Boolean);
  if (preferred.length >= 4) {
    return preferred.slice(0, 5);
  }
  return categories.slice(0, 5);
}

