// Spider Cloud REST client — full API coverage.
// https://spider.cloud/docs/overview/ · https://spider.cloud/docs/api/
// All endpoints: Bearer auth, JSON in / JSON out. We call them directly with fetch.
// Browser-safe (no node imports).

import type { Config } from "./config.ts";
import type { ContactRecord, PageContent, RequestMode } from "./types.ts";
import { log } from "./log.ts";

export class SpiderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Common request options — every documented Spider Cloud parameter
// (https://spider.cloud/docs/api/ → "Common Parameters"). Threaded through
// every endpoint via applyOptions().
// ---------------------------------------------------------------------------

export interface SpiderRequestOptions {
  // Rendering
  mode?: RequestMode;
  returnFormat?: string;
  readability?: boolean;
  metadata?: boolean;
  encoding?: string;
  // Crawl control
  limit?: number;
  depth?: number;
  blacklist?: string[];
  budget?: Record<string, number>;
  concurrencyLimit?: number;
  crawlTimeout?: number;
  // Page interaction
  cookies?: string[];
  waitForSelector?: string;
  waitFor?: number;
  // Content filtering
  blockAds?: boolean;
  blockAnalytics?: boolean;
  blockStylesheets?: boolean;
  chunkText?: boolean;
  chunkSize?: number;
  // CSS selector extraction (alternative to AI)
  cssExtractionMap?: Record<string, string>;
  // Screenshot
  screenshot?: boolean;
  fullPage?: boolean;
  cdpParams?: Record<string, unknown>;
  // Custom headers to send to the target
  headers?: Record<string, string>;
  // Respect robots.txt
  respectRobots?: boolean;
  // Override proxy/geo per-request
  premiumProxy?: boolean;
  countryCode?: string;
}

/** Merge all common Spider request parameters into a request body object. */
export function applyOptions(body: Record<string, unknown>, opts: SpiderRequestOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  if (opts.mode) out.request = opts.mode;
  if (opts.returnFormat) out.return_format = opts.returnFormat;
  if (opts.readability) out.readability = true;
  if (opts.metadata !== undefined) out.metadata = opts.metadata;
  if (opts.encoding) out.encoding = opts.encoding;
  if (opts.limit !== undefined) out.limit = opts.limit;
  if (opts.depth !== undefined) out.depth = opts.depth;
  if (opts.blacklist) out.blacklist = opts.blacklist;
  if (opts.budget) out.budget = opts.budget;
  if (opts.concurrencyLimit !== undefined) out.concurrency_limit = opts.concurrencyLimit;
  if (opts.crawlTimeout !== undefined) out.crawl_timeout = opts.crawlTimeout;
  if (opts.cookies) out.cookies = opts.cookies;
  if (opts.waitForSelector) out.wait_for_selector = opts.waitForSelector;
  if (opts.waitFor !== undefined) out.wait_for = opts.waitFor;
  if (opts.blockAds !== undefined) out.block_ads = opts.blockAds;
  if (opts.blockAnalytics !== undefined) out.block_analytics = opts.blockAnalytics;
  if (opts.blockStylesheets !== undefined) out.block_stylesheets = opts.blockStylesheets;
  if (opts.chunkText) { out.chunk_text = true; if (opts.chunkSize) out.chunk_size = opts.chunkSize; }
  if (opts.cssExtractionMap) out.css_extraction_map = opts.cssExtractionMap;
  if (opts.screenshot !== undefined) out.screenshot = opts.screenshot;
  if (opts.fullPage !== undefined) out.full_page = opts.fullPage;
  if (opts.cdpParams) out.cdp_params = opts.cdpParams;
  if (opts.headers) out.headers = opts.headers;
  if (opts.respectRobots !== undefined) out.respect_robots = opts.respectRobots;
  if (opts.premiumProxy !== undefined) out.premium_proxy = opts.premiumProxy;
  if (opts.countryCode) out.country_code = opts.countryCode;
  return out;
}

/**
 * Proxy/geo fields from the global config (applied when the request itself
 * doesn't override them).
 */
function proxyFields(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cfg.spiderProxy) out.premium_proxy = true;
  if (cfg.spiderCountry && /^[a-z]{2}$/i.test(cfg.spiderCountry)) out.country_code = cfg.spiderCountry.toLowerCase();
  return out;
}

/** Build the full request body: global proxy/geo + endpoint fields + per-request options. */
function buildBody(cfg: Config, base: Record<string, unknown>, opts: SpiderRequestOptions = {}): Record<string, unknown> {
  return applyOptions({ ...proxyFields(cfg), ...base }, opts);
}

async function apiPost<T>(
  cfg: Config,
  path: string,
  body: Record<string, unknown>,
  attempts = 3
): Promise<T> {
  const merged = { ...proxyFields(cfg), ...body };
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(cfg.spiderApiBase + path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.spiderApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(merged),
      });
    } catch (err) {
      lastErr = err;
      log.debug(`spider ${path} network error (attempt ${attempt}): ${String(err)}`);
      await sleep(800 * attempt);
      continue;
    }
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = new SpiderError(resp.status, `HTTP ${resp.status}`);
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? Number(retryAfter) * 1000 : 800 * attempt;
      log.debug(`spider ${path} ${resp.status} — retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let msg = text.slice(0, 300);
      let creditHint = "";
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || msg;
        if (resp.status === 402 || String(j.code ?? "").includes("credit")) {
          creditHint = " — add credits at https://spider.cloud/credits/new (failed pages cost $0, but requests need balance; the scraper catalog & /data/scraper-directory are free)";
        }
      } catch { /* keep text */ }
      throw new SpiderError(resp.status, `${path} failed (${resp.status}): ${msg}${creditHint}`);
    }
    return (await resp.json()) as T;
  }
  throw new SpiderError(0, `${path} failed after ${attempts} attempts: ${String(lastErr)}`);
}

function pageFrom(raw: any): PageContent | null {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url ?? "");
  const content = String(raw.content ?? raw.markdown ?? raw.text ?? raw.html ?? "");
  const status = Number(raw.status ?? raw.status_code ?? 0);
  if (!url) return null;
  return { url, markdown: content, status };
}

// ---------------------------------------------------------------------------
// Core endpoints
// ---------------------------------------------------------------------------

/** Collect internal links from a site: POST /links */
export async function getSiteLinks(
  cfg: Config,
  url: string,
  opts: { limit?: number; mode?: RequestMode; params?: SpiderRequestOptions } = {}
): Promise<string[]> {
  const data = await apiPost<any>(cfg, "/links", buildBody(cfg, {
    url,
    limit: opts.limit ?? cfg.crawlLimit * 5,
    request: opts.mode ?? "smart",
  }, opts.params));
  const list = Array.isArray(data) ? data : data.links ?? data.urls ?? [];
  return list
    .map((l: any) => (typeof l === "string" ? l : l.url ?? l.href ?? l.link ?? ""))
    .filter((u: string) => /^https?:\/\//.test(u));
}

/** Crawl multiple pages: POST /crawl */
export async function crawlPages(
  cfg: Config,
  url: string,
  opts: { limit?: number; depth?: number; mode?: RequestMode; format?: string; params?: SpiderRequestOptions } = {}
): Promise<PageContent[]> {
  const data = await apiPost<any>(cfg, "/crawl", buildBody(cfg, {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    depth: opts.depth ?? cfg.crawlDepth,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  }, opts.params));
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(pageFrom).filter((p): p is PageContent => p !== null);
}

/** Scrape a single page: POST /scrape */
export async function scrapePage(
  cfg: Config,
  url: string,
  opts: { mode?: RequestMode; format?: string; params?: SpiderRequestOptions } = {}
): Promise<PageContent> {
  const data = await apiPost<any>(cfg, "/scrape", buildBody(cfg, {
    url, limit: 1,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  }, opts.params));
  const page = pageFrom(Array.isArray(data) ? data[0] : data);
  if (!page) throw new SpiderError(0, `/scrape returned no content for ${url}`);
  return page;
}

/** Search the web and scrape results in one call: POST /search */
export async function searchPages(
  cfg: Config,
  query: string,
  opts: { limit?: number; mode?: RequestMode; params?: SpiderRequestOptions } = {}
): Promise<PageContent[]> {
  const data = await apiPost<any>(cfg, "/search", buildBody(cfg, {
    search: query,
    limit: opts.limit ?? 10,
    request: opts.mode ?? "smart",
    return_format: "markdown",
    fetch_page_content: true,
  }, opts.params));
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data.content) ? data.content
      : Array.isArray(data.results) ? data.results
        : [];
  return (arr as any[]).map((r: any) => pageFrom(r)).filter((p): p is PageContent => p !== null && p.markdown.length > 0);
}

// ---------------------------------------------------------------------------
// Screenshot — POST /screenshot (base64-encoded PNG/JPEG/WebP)
// ---------------------------------------------------------------------------

export interface ScreenshotResult {
  url: string;
  /** Base64-encoded image data. */
  image: string;
  format: string;
  status: number;
}

export async function screenshotPage(
  cfg: Config,
  url: string,
  opts: { format?: "png" | "jpeg" | "webp"; fullPage?: boolean; cdpParams?: Record<string, unknown>; params?: SpiderRequestOptions } = {}
): Promise<ScreenshotResult> {
  const cdp: Record<string, unknown> = { format: opts.format ?? "png", ...(opts.cdpParams ?? {}) };
  if (opts.fullPage !== undefined) cdp.full_page = opts.fullPage;
  const data = await apiPost<any>(cfg, "/screenshot", buildBody(cfg, {
    url, cdp_params: cdp,
  }, { ...opts.params, screenshot: true }));
  const row = Array.isArray(data) ? data[0] : data;
  return {
    url: String(row?.url ?? url),
    image: String(row?.content ?? row?.screenshot ?? ""),
    format: String(row?.format ?? opts.format ?? "png"),
    status: Number(row?.status ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Transform — POST /transform (HTML → markdown/text/etc.)
// ---------------------------------------------------------------------------

export async function transformHtml(
  cfg: Config,
  html: string,
  opts: { returnFormat?: string; params?: SpiderRequestOptions } = {}
): Promise<string> {
  const data = await apiPost<any>(cfg, "/transform", buildBody(cfg, {
    content: html,
    return_format: opts.returnFormat ?? "markdown",
  }, opts.params));
  return String(Array.isArray(data) ? (data[0]?.content ?? "") : (data?.content ?? ""));
}

// ---------------------------------------------------------------------------
// Unblocker — POST /unblocker (fetch a page behind bot protection)
// ---------------------------------------------------------------------------

export async function unblockPage(
  cfg: Config,
  url: string,
  opts: { format?: string; params?: SpiderRequestOptions } = {}
): Promise<PageContent> {
  const data = await apiPost<any>(cfg, "/unblocker", buildBody(cfg, {
    url,
    return_format: opts.format ?? "markdown",
  }, opts.params));
  const page = pageFrom(Array.isArray(data) ? data[0] : data);
  if (!page) throw new SpiderError(0, `/unblocker returned no content for ${url}`);
  return page;
}

// ---------------------------------------------------------------------------
// Unlimited plan — POST /unlimited/{scrape,crawl,links}
// Same request/response as the standard endpoints, just a different path.
// ---------------------------------------------------------------------------

export async function scrapeUnlimited(
  cfg: Config,
  url: string,
  opts: { mode?: RequestMode; format?: string; params?: SpiderRequestOptions } = {}
): Promise<PageContent> {
  const data = await apiPost<any>(cfg, "/unlimited/scrape", buildBody(cfg, {
    url, limit: 1,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  }, opts.params));
  const page = pageFrom(Array.isArray(data) ? data[0] : data);
  if (!page) throw new SpiderError(0, `/unlimited/scrape returned no content for ${url}`);
  return page;
}

export async function crawlUnlimited(
  cfg: Config,
  url: string,
  opts: { limit?: number; depth?: number; mode?: RequestMode; format?: string; params?: SpiderRequestOptions } = {}
): Promise<PageContent[]> {
  const data = await apiPost<any>(cfg, "/unlimited/crawl", buildBody(cfg, {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    depth: opts.depth ?? cfg.crawlDepth,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  }, opts.params));
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(pageFrom).filter((p): p is PageContent => p !== null);
}

export async function linksUnlimited(
  cfg: Config,
  url: string,
  opts: { limit?: number; mode?: RequestMode; params?: SpiderRequestOptions } = {}
): Promise<string[]> {
  const data = await apiPost<any>(cfg, "/unlimited/links", buildBody(cfg, {
    url,
    limit: opts.limit ?? cfg.crawlLimit * 5,
    request: opts.mode ?? "smart",
  }, opts.params));
  const list = Array.isArray(data) ? data : data.links ?? data.urls ?? [];
  return list
    .map((l: any) => (typeof l === "string" ? l : l.url ?? l.href ?? l.link ?? ""))
    .filter((u: string) => /^https?:\/\//.test(u));
}

// ---------------------------------------------------------------------------
// Legacy AI contact extraction: POST /v1/pipeline/extract-contacts
// ---------------------------------------------------------------------------

export async function extractContactsSpider(
  cfg: Config,
  url: string,
  opts: { limit?: number; prompt?: string; model?: string; params?: SpiderRequestOptions } = {}
): Promise<ContactRecord[]> {
  const data = await apiPost<any>(cfg, "/v1/pipeline/extract-contacts", buildBody(cfg, {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    model: opts.model ?? "gpt-4o",
    prompt:
      opts.prompt ??
      "Extract all team member contact information: name, email, phone, title, LinkedIn profile.",
  }, opts.params));
  const arr = Array.isArray(data) ? data : [];
  return arr.filter((r: any) => r && typeof r === "object");
}

// ---------------------------------------------------------------------------
// Fetch API (per-website scraper configs) — https://spider.cloud/api/fetch
// ---------------------------------------------------------------------------

export interface FetchResult {
  url: string;
  content: unknown;
  status: number;
  metadata?: { title?: string; description?: string; keywords?: string; og_image?: string } | null;
  css_extracted?: unknown;
  links?: string[];
}

export function fetchPathFromUrl(input: string): { domain: string; path: string } {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
  } catch {
    throw new SpiderError(0, `invalid URL: ${input}`);
  }
  const domain = u.hostname.replace(/^www\./, "");
  const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
  return { domain, path };
}

export async function fetchStructured(
  cfg: Config,
  input: string,
  opts: { returnFormat?: string; limit?: number; readability?: boolean; params?: SpiderRequestOptions } = {}
): Promise<FetchResult> {
  const { domain, path } = fetchPathFromUrl(input);
  const body = buildBody(cfg, {}, { ...opts, returnFormat: opts.returnFormat, readability: opts.readability, limit: opts.limit });
  const data = await apiPost<any>(cfg, `/fetch/${encodeURIComponent(domain)}${encodeURI(path)}`, body);
  if (!data || typeof data !== "object") throw new SpiderError(0, `/fetch returned no data for ${domain}${path}`);
  return {
    url: String(data.url ?? input),
    content: data.content ?? null,
    status: Number(data.status ?? 0),
    metadata: data.metadata ?? null,
    css_extracted: data.css_extracted ?? null,
    links: Array.isArray(data.links) ? data.links.map(String) : [],
  };
}

// ---------------------------------------------------------------------------
// AI Studio (prompt → JSON) — https://spider.cloud/docs/ai-studio
// POST /ai/{scrape,crawl,search,browser,links,unblocker}
// ---------------------------------------------------------------------------

export type AiStudioRoute = "scrape" | "crawl" | "search" | "browser" | "links" | "unblocker";

export interface AiStudioPage {
  url: string;
  status: number;
  error?: string | null;
  content?: unknown;
  extractedData?: unknown;
  links?: string[];
  metadata?: Record<string, unknown> | null;
}

export async function aiStudioExtract(
  cfg: Config,
  route: AiStudioRoute,
  urlOrSearch: string,
  prompt: string,
  opts: { limit?: number; metadata?: boolean; schema?: Record<string, unknown>; returnFormat?: string; cleaningIntent?: "extraction" | "action" | "general"; params?: SpiderRequestOptions } = {}
): Promise<AiStudioPage[]> {
  const body = buildBody(cfg, {
    prompt,
    limit: opts.limit ?? 10,
  }, opts.params);
  if (route === "search") body.search = urlOrSearch;
  else body.url = urlOrSearch;
  if (opts.metadata !== undefined) body.metadata = opts.metadata;
  if (opts.returnFormat) body.return_format = opts.returnFormat;
  if (opts.schema) body.extraction_schema = opts.schema;
  if (opts.cleaningIntent) body.cleaning_intent = opts.cleaningIntent;

  const data = await apiPost<any>(cfg, "/ai/" + route, body);
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.pages) ? data.pages
        : data?.data ? data.data : [];
  return arr.map((r: any) => ({
    url: String(r?.url ?? ""),
    status: Number(r?.status ?? 0),
    error: r?.error ?? null,
    content: r?.content ?? null,
    extractedData: r?.metadata?.extracted_data ?? r?.extracted_data ?? null,
    links: Array.isArray(r?.links) ? r.links.map(String) : [],
    metadata: r?.metadata ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Scraper Directory (curated config catalog) — GET /data/scraper-directory
// ---------------------------------------------------------------------------

export interface ScraperConfig {
  id: string;
  domain: string;
  path_pattern: string | null;
  display_name: string | null;
  description: string | null;
  category: string | null;
  tags: string | null;
  confidence_score: number;
  validation_count: number;
  fields_count: number;
  page_title: string | null;
}

export async function listScraperDirectory(
  opts: { domain?: string; category?: string; limit?: number; base?: string } = {}
): Promise<ScraperConfig[]> {
  const qs = new URLSearchParams();
  if (opts.domain) qs.set("domain", opts.domain);
  if (opts.category) qs.set("category", opts.category);
  qs.set("limit", String(opts.limit ?? 50));
  const resp = await fetch((opts.base ?? "https://api.spider.cloud") + "/data/scraper-directory?" + qs.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new SpiderError(resp.status, "scraper-directory failed (" + resp.status + ")");
  }
  const j: any = await resp.json();
  return Array.isArray(j?.data) ? j.data : [];
}
