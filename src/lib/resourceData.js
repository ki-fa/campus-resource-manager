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

const HEADING_DISPLAY_LIMIT = 14;
const CONTENT_BLOCK_DISPLAY_LIMIT = 22;

function cleanTitle(value) {
  let title = (value || "").trim();
  for (const pattern of TRAILING_TITLE_SUFFIXES) {
    title = title.replace(pattern, "");
  }
  return title.trim();
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

function normalizeLinks(links) {
  return (links || []).map((link) => ({
    text: link.text || "Open link",
    url: link.url,
    type: getLinkType(link.url)
  }));
}

export function normalizePage(page) {
  const headings = (page.headings || []).slice(0, HEADING_DISPLAY_LIMIT);
  const contentBlocks = (page.contentBlocks || []).slice(0, CONTENT_BLOCK_DISPLAY_LIMIT);
  const links = normalizeLinks(page.links);
  const plainText = [page.title, page.description, ...headings, ...contentBlocks]
    .join(" ")
    .toLowerCase();
  const words = plainText.split(/\s+/).filter(Boolean).length;
  const readingEstimate = Math.max(1, Math.round(words / 220));
  let sourceHost = "";
  try {
    sourceHost = new URL(page.url).hostname;
  } catch {
    sourceHost = "";
  }

  return {
    ...page,
    title: cleanTitle(page.title) || "Untitled resource",
    description: page.description || "",
    headings,
    contentBlocks,
    links,
    sourceHost,
    readingEstimate,
    linkCount: links.length,
    searchText: plainText
  };
}

export function normalizePages(pages) {
  return (pages || []).map(normalizePage);
}

export function filterPages(pages, { query, category, siteId }) {
  const terms = (query || "").toLowerCase().split(/\s+/).filter(Boolean);

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

