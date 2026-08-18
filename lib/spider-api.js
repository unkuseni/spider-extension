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
  const result = await chrome.storage.sync.get(['spider_api_key']);
  return result.spider_api_key || null;
}

/**
 * Store an API key.
 * @param {string} key
 */
export async function setApiKey(key) {
  await chrome.storage.sync.set({ spider_api_key: key });
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
  };
  const result = await chrome.storage.sync.get(['spider_prefs']);
  return { ...defaults, ...(result.spider_prefs || {}) };
}

/**
 * Store preferences.
 * @param {object} prefs
 */
export async function setPreferences(prefs) {
  const existing = await getPreferences();
  await chrome.storage.sync.set({ spider_prefs: { ...existing, ...prefs } });
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
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Try to parse complete JSON objects from the buffer.
      // Spider's streaming crawl returns an array, so we look for
      // complete objects delimited by `},{` or `}]`.
      let boundary;
      while ((boundary = buffer.indexOf('},{')) !== -1 || buffer.startsWith('[{')) {
        if (buffer.startsWith('[') && buffer[1] !== '{') {
          // Strip leading '[' if present
          buffer = buffer.slice(1);
        }

        let endIdx = buffer.indexOf('},{');
        if (endIdx === -1) endIdx = buffer.indexOf('}]');
        if (endIdx === -1) break;

        const jsonStr = buffer.slice(0, endIdx + 1);
        buffer = buffer.slice(endIdx + 2); // skip `},`

        try {
          const page = JSON.parse(jsonStr);
          if (page && typeof page === 'object') yield page;
        } catch {
          // partial — re-accumulate
          buffer = jsonStr + buffer;
          break;
        }
      }
    }

    // Handle final chunk
    buffer = buffer.replace(/^\[|\]$/g, '').trim();
    if (buffer) {
      try {
        const page = JSON.parse(buffer);
        if (page && typeof page === 'object') yield page;
      } catch {
        // ignore unparseable remainder
      }
    }
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
  };
  const response = await fetch(`${SPIDER_API_BASE}/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return handleResponse(response);
}
