import { PlaywrightCrawler } from 'crawlee';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// ---------- Configuration ----------
const START_URL = 'https://www.csus.edu/';
const MAX_REQUESTS = 10000;
const MAX_CONCURRENCY = 2;
const DATA_DIR = './data';

// Keywords for relevance (URL + content)
const RESOURCE_KEYWORDS = [
  '/students/', '/current-students/', '/resources/', '/services/',
  '/academics/', '/campus-life/', '/student-life/',
  '/financial-aid/', '/health/', '/career/', '/counseling/',
  '/tutoring/', '/advising/', '/library/', '/support/',
  'financial aid', 'health center', 'counseling services', 'career center',
  'tutoring', 'academic advising', 'student services', 'campus resources',
  'support services', 'wellness', 'disability services', 'veterans services',
  'basic needs', 'food pantry', 'emergency grant'
];

// Patterns to ignore (admin, calendars, assets, etc.)
const IGNORE_PATTERNS = [
  /\/calendar\//i, /\/events\//i, /\/news\//i, /\/media\//i,
  /\/assets\//i, /\/images\//i, /\/pdf\//i, /\.pdf$/i,
  /\.jpg$/i, /\.png$/i, /\.gif$/i, /\.css$/i, /\.js$/i,
  /\/wp-admin/i, /\/login/i, /\/cgi-bin/i
];

function shouldIgnoreUrl(url) {
  return IGNORE_PATTERNS.some(pattern => pattern.test(url));
}

function isRelevantPage(url, pageText) {
  const urlLower = url.toLowerCase();
  const urlRelevant = RESOURCE_KEYWORDS.some(keyword =>
    urlLower.includes(keyword.toLowerCase())
  );
  const textChunk = pageText.slice(0, 5000).toLowerCase();
  const contentRelevant = RESOURCE_KEYWORDS.some(keyword =>
    textChunk.includes(keyword.toLowerCase())
  );
  return urlRelevant || contentRelevant;
}

async function extractPageData(page, request) {
  const title = await page.title();
  const url = request.url;

  let metaDescription = '';
  const metaDesc = await page.$('meta[name="description"]');
  if (metaDesc) {
    metaDescription = await metaDesc.getAttribute('content') || '';
  }

  const headings = await page.$$eval('h1, h2', els =>
    els.map(el => ({ tag: el.tagName.toLowerCase(), text: el.innerText.trim() }))
  );

  const paragraphs = await page.$$eval('p', els =>
    els.slice(0, 5).map(p => p.innerText.trim()).filter(t => t.length > 0)
  );

  const resourceLinks = await page.$$eval('a', (links, baseUrl) => {
    const resourcePatterns = ['resources', 'services', 'support', 'help', 'assistance'];
    return links
      .map(a => a.href)
      .filter(href => href && href.startsWith('http'))
      .filter(href => resourcePatterns.some(p => href.toLowerCase().includes(p)))
      .slice(0, 10);
  }, request.url);

  return {
    url,
    title,
//    metaDescription,
    headings,
//    paragraphs,
    resourceLinks,
    crawledAt: new Date().toISOString()
  };
}

async function saveJson(data) {
  await mkdir(DATA_DIR, { recursive: true });
  const safeFilename = data.url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') + '.json';
  const filePath = join(DATA_DIR, safeFilename);
  await writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`Saved: ${filePath}`);
}

// ---------- Main Crawler ----------
const crawler = new PlaywrightCrawler({
  maxRequestsPerCrawl: MAX_REQUESTS,
  maxConcurrency: MAX_CONCURRENCY,
  maxRequestsPerMinute: 20,
  requestHandler: async ({ page, request, enqueueLinks }) => {
    const url = request.url;
    console.log(`Processing: ${url}`);

    try {
      // Get page text for relevance check
      const pageText = await page.evaluate(() => document.body.innerText);

      // Determine if this page is a student resource
      const relevant = isRelevantPage(url, pageText);

      if (relevant) {
        const data = await extractPageData(page, request);
        await saveJson(data);
      } else {
        console.log(`Skipping (not relevant): ${url}`);
      }

      // Enqueue internal links, skipping ignored ones
      await enqueueLinks({
        strategy: 'same-domain',
		limit: 10000,
		exclude: [
			/\.(pdf|jpg|jpeg|png|gif|svg|webp|ico|zip|mp4|mp3|doc|docx|xls|xlsx)$/i,
		],
        transformRequestFunction: (req) => {
          if (shouldIgnoreUrl(req.url)) {
            return null; // skip this link
          }
          return req;
        }
      });
    } catch (error) {
      console.error(`Error processing ${url}:`, error.message);
    }
  },
});

// ---------- Start ----------
(async () => {
  console.log(`Starting crawl from ${START_URL}`);
  await crawler.run([START_URL]);
  console.log('Crawl finished.');
})();