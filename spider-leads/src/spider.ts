// Spider Cloud REST client (https://spider.cloud/docs/overview)
// All endpoints: Bearer auth, JSON in / JSON out. We call them directly with fetch.

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

/**
 * Proxy/geo fields added to every request when configured:
 * premium_proxy rotates through Spider's residential/ISP pool; country_code
 * targets a country for georouting (see https://spider.cloud/docs/overview/).
 */
function proxyFields(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cfg.spiderProxy) out.premium_proxy = true;
  if (cfg.spiderCountry && /^[a-z]{2}$/i.test(cfg.spiderCountry)) out.country_code = cfg.spiderCountry.toLowerCase();
  return out;
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
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || msg;
      } catch { /* keep text */ }
      throw new SpiderError(resp.status, `${path} failed (${resp.status}): ${msg}`);
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

/** Collect internal links from a site: POST /links */
export async function getSiteLinks(
  cfg: Config,
  url: string,
  opts: { limit?: number; mode?: RequestMode } = {}
): Promise<string[]> {
  const data = await apiPost<any>(cfg, "/links", {
    url,
    limit: opts.limit ?? cfg.crawlLimit * 5,
    request: opts.mode ?? "smart",
  });
  const list = Array.isArray(data) ? data : data.links ?? data.urls ?? [];
  return list
    .map((l: any) => (typeof l === "string" ? l : l.url ?? l.href ?? l.link ?? ""))
    .filter((u: string) => /^https?:\/\//.test(u));
}

/** Crawl multiple pages: POST /crawl */
export async function crawlPages(
  cfg: Config,
  url: string,
  opts: { limit?: number; depth?: number; mode?: RequestMode; format?: string } = {}
): Promise<PageContent[]> {
  const data = await apiPost<any>(cfg, "/crawl", {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    depth: opts.depth ?? cfg.crawlDepth,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  });
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(pageFrom).filter((p): p is PageContent => p !== null);
}

/** Scrape a single page: POST /scrape */
export async function scrapePage(
  cfg: Config,
  url: string,
  opts: { mode?: RequestMode; format?: string } = {}
): Promise<PageContent> {
  const data = await apiPost<any>(cfg, "/scrape", {
    url,
    limit: 1,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown",
  });
  const page = pageFrom(Array.isArray(data) ? data[0] : data);
  if (!page) throw new SpiderError(0, `/scrape returned no content for ${url}`);
  return page;
}

/** Search the web and scrape results in one call: POST /search */
export async function searchPages(
  cfg: Config,
  query: string,
  opts: { limit?: number; mode?: RequestMode } = {}
): Promise<PageContent[]> {
  const data = await apiPost<any>(cfg, "/search", {
    search: query,
    limit: opts.limit ?? 10,
    request: opts.mode ?? "smart",
    return_format: "markdown",
    fetch_page_content: true,
  });
  const arr = Array.isArray(data)
    ? data
    : Array.isArray(data.content)
      ? data.content
      : Array.isArray(data.results)
        ? data.results
        : [];
  return (arr as any[]).map((r: any) => pageFrom(r)).filter((p): p is PageContent => p !== null && p.markdown.length > 0);
}

/**
 * Spider AI contact extraction: POST /v1/pipeline/extract-contacts
 * NOTE: this is the legacy v1 pipeline (deprecated upstream in favor of the
 * Fetch API / css_extraction_map, but still documented and functional).
 * Returns raw contact records; caller validates/filters them.
 */
export async function extractContactsSpider(
  cfg: Config,
  url: string,
  opts: { limit?: number; prompt?: string; model?: string } = {}
): Promise<ContactRecord[]> {
  const data = await apiPost<any>(cfg, "/v1/pipeline/extract-contacts", {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    model: opts.model ?? "gpt-4o",
    prompt:
      opts.prompt ??
      "Extract all team member contact information: name, email, phone, title, LinkedIn profile.",
  });
  const arr = Array.isArray(data) ? data : [];
  return arr.filter((r: any) => r && typeof r === "object");
}

// ---------------------------------------------------------------------------
// Fetch API (per-website scraper configs) — https://spider.cloud/api/fetch
// POST /fetch/{domain}/{path}. First call per domain/path bootstraps an
// AI-discovered config (selectors, schema, render mode), then hits cache.
// ---------------------------------------------------------------------------

export interface FetchResult {
  url: string;
  /** Extracted data in the chosen format (markdown/text) or structured JSON. */
  content: unknown;
  status: number;
  metadata?: { title?: string; description?: string; keywords?: string; og_image?: string } | null;
  /** Structured data from AI-discovered selectors. */
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

/**
 * Structured extraction through the curated/AI per-website scraper configs.
 * Works for sites with public configs (zillow.com, indeed.com, yelp.com, …)
 * and bootstraps new ones on the first call.
 */
export async function fetchStructured(
  cfg: Config,
  input: string,
  opts: { returnFormat?: string; limit?: number; readability?: boolean } = {}
): Promise<FetchResult> {
  const { domain, path } = fetchPathFromUrl(input);
  const body: Record<string, unknown> = { ...proxyFields(cfg) };
  if (opts.returnFormat) body.return_format = opts.returnFormat;
  if (opts.limit && opts.limit > 1) body.limit = opts.limit;
  if (opts.readability) body.readability = true;
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
