import { storageGet, storageSet } from './storage.js';

/**
 * Spider Cloud API client for the browser extension.
 * Handles all communication with the Spider Cloud REST API.
 */

const SPIDER_API_BASE = 'https://api.spider.cloud';

/**
 * Retrieve the stored API key from extension storage.
 * @returns {Promise<string|null>}
 */
export async function getApiKey() {
  const result = await storageGet(['spider_api_key']);
  return result.spider_api_key || null;
}

/**
 * Store an API key.
 * @param {string} key
 */
export async function setApiKey(key) {
  await storageSet({ spider_api_key: key });
}

/**
 * Retrieve stored preferences.
 * @returns {Promise<object>}
 */
export async function getPreferences() {
  const defaults = {
    defaultMode: 'smart',
    defaultFormat: 'markdown',
    defaultLimit: 5,
    respectRobots: true,
    readability: false,
    returnPageTiming: false,
    usePremiumProxy: false,
    proxyCountry: '',
  };
  const result = await storageGet(['spider_prefs']);
  return { ...defaults, ...(result.spider_prefs || {}) };
}

/**
 * Store preferences.
 * @param {object} prefs
 */
export async function setPreferences(prefs) {
  const existing = await getPreferences();
  await storageSet({ spider_prefs: { ...existing, ...prefs } });
}

/**
 * Build common headers for Spider API requests.
 * @returns {Promise<object>}
 */
async function buildHeaders() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No API key configured. Open extension options to set your Spider Cloud API key.');
  }
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Handle API errors consistently.
 */
function handleResponse(response) {
  if (!response.ok) {
    return response.json().then(body => {
      const msg = body?.error || body?.message || `HTTP ${response.status}`;
      throw new Error(`Spider API error (${response.status}): ${msg}`);
    }).catch(err => {
      if (err.message.startsWith('Spider API error')) throw err;
      throw new Error(`Spider API error (${response.status}): ${response.statusText}`);
    });
  }
  return response.json();
}

/**
 * Proxy/geo fields merged into every request body when enabled in options:
 * premium_proxy rotates through Spider's residential/ISP pool; country_code
 * targets a country for georouting. See https://spider.cloud/docs/overview/.
 */
async function proxyBody() {
  const prefs = await getPreferences();
  const out = {};
  if (prefs.usePremiumProxy) out.premium_proxy = true;
  if (prefs.proxyCountry && /^[a-z]{2}$/i.test(prefs.proxyCountry)) {
    out.country_code = prefs.proxyCountry.toLowerCase();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scrape — single page
// ---------------------------------------------------------------------------

/**
 * Scrape a single URL.
 * @param {object} params
 * @param {string} params.url
 * @param {'smart'|'http'|'chrome'} [params.mode='smart']
 * @param {'markdown'|'html'|'raw'|'text'|'commonmark'|'bytes'} [params.format='markdown']
 * @param {number} [params.timeout=30]
 * @param {boolean} [params.readability=false]
 * @param {boolean} [params.return_page_timing=false]
 * @returns {Promise<object>}
 */
export async function scrapePage({
  url,
  mode = 'smart',
  format = 'markdown',
  timeout = 30,
  readability = false,
  return_page_timing = false,
} = {}) {
  const headers = await buildHeaders();
  const body = {
    url,
    limit: 1,
    request: mode,
    return_format: format,
    readability,
    return_page_timing,
    ...(await proxyBody()),
  };
  const response = await fetch(`${SPIDER_API_BASE}/scrape`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}

// ---------------------------------------------------------------------------
// Crawl — multi-page with streaming via SSE / chunked transfer
// ---------------------------------------------------------------------------

/**
 * Crawl a site starting from a URL. Returns results as an async iterable
 * so the UI can display pages as they arrive.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {'smart'|'http'|'chrome'} [params.mode='smart']
 * @param {'markdown'|'html'|'raw'|'text'|'commonmark'|'bytes'} [params.format='markdown']
 * @param {number} [params.limit=10]
 * @param {number} [params.depth=3]
 * @param {boolean} [params.respectRobots=true]
 * @param {boolean} [params.readability=false]
 * @param {boolean} [params.return_page_timing=false]
 * @yields {object} Individual page results as they arrive.
 */
export async function* crawlSite({
  url,
  mode = 'smart',
  format = 'markdown',
  limit = 10,
  depth = 3,
  respectRobots = true,
  readability = false,
  return_page_timing = false,
} = {}) {
  const headers = await buildHeaders();
  const body = {
    url,
    limit,
    depth,
    request: mode,
    return_format: format,
    readability,
    respect_robots: respectRobots,
    return_page_timing,
    ...(await proxyBody()),
  };

  const response = await fetch(`${SPIDER_API_BASE}/crawl`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    await handleResponse(response); // throws
  }

  // Spider returns a JSON array. Stream it via the ReadableStream.
  if (!response.body) {
    // Fallback: non-streaming response
    const json = await response.json();
    const pages = Array.isArray(json) ? json : [json];
    for (const page of pages) yield page;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const queue = [];
  const errors = [];

  // Incremental JSON-array splitter: tracks brace depth while ignoring braces
  // inside strings (including escapes), so page content containing "},{",
  // leading "[" or trailing "]" is never corrupted or mis-split.
  let pending = '';
  let braceDepth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let scan = 0;
  const feed = (chunk) => {
    pending += chunk;
    // Resume where the previous chunk left off — NEVER re-scan from 0, or the
    // string/escape state machine gets corrupted by characters it already saw.
    let i = scan;
    while (i < pending.length) {
      const ch = pending[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        i++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        i++;
        continue;
      }
      if (ch === '{') {
        if (braceDepth === 0) start = i;
        braceDepth++;
        i++;
        continue;
      }
      if (ch === '}') {
        braceDepth--;
        i++;
        if (braceDepth === 0 && start !== -1) {
          try {
            const page = JSON.parse(pending.slice(start, i));
            if (page && typeof page === 'object') queue.push(page);
          } catch (err) {
            errors.push(err.message);
          }
          pending = pending.slice(i);
          scan = 0;
          i = 0;
          start = -1;
          inString = false;
          escaped = false;
          braceDepth = 0;
        }
        continue;
      }
      i++;
    }
    scan = i;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
      while (queue.length) yield queue.shift();
    }
    // Flush whatever remains (non-array single object, or a trailing object
    // without a final ']'). Array wrapper brackets are ignored by the splitter.
    feed('');
    while (queue.length) yield queue.shift();
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search the web.
 * @param {object} params
 * @param {string} params.query
 * @param {number} [params.limit=10]
 * @param {'smart'|'http'|'chrome'} [params.mode='smart']
 * @param {'markdown'|'html'|'raw'|'text'} [params.format='markdown']
 * @param {number} [params.page=1]
 * @returns {Promise<object>}
 */
export async function searchWeb({
  query,
  limit = 10,
  mode = 'smart',
  format = 'markdown',
  page = 1,
} = {}) {
  const headers = await buildHeaders();
  const body = {
    search: query,
    limit,
    request: mode,
    return_format: format,
    fetch_page_content: true,
    page,
    ...(await proxyBody()),
  };
  const response = await fetch(`${SPIDER_API_BASE}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}