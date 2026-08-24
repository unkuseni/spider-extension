// Environment configuration with sane defaults.

import type { ExtractMode, RequestMode } from "./types.ts";

export interface Config {
  spiderApiKey: string;
  spiderApiBase: string;
  spiderExtract: ExtractMode;
  crawlLimit: number;
  crawlDepth: number;
  /** Send requests through Spider's premium proxy pool (residential rotation). */
  spiderProxy: boolean;
  /** Target a country for proxy georouting (ISO 3166-1 alpha-2, e.g. "us"). */
  spiderCountry: string;
  /** Use Spider AI Studio endpoints (/ai/* — needs an AI Studio subscription). */
  aiStudio: boolean;

  tursoUrl: string;
  tursoAuthToken: string;

  plunkApiKey: string;
  plunkApiBase: string;
  verifyOnHunt: boolean;

  /** Infer employee emails from discovered names + verify (default off). */
  guessEmails: boolean;
  /** Max candidate addresses to try per person. */
  guessPerPerson: number;
  /** Optional GitHub token to raise the public-API rate limit for org discovery. */
  githubToken: string;
  /** GitHub API base (override for tests/proxies). */
  githubApiBase: string;

  /** ICP interest topics (comma-separated) — used in lead scoring. */
  icpInterests: string[];
  /** ICP categories (comma-separated) — used in lead scoring. */
  icpCategories: string[];

  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;

  verbose: boolean;
}

function env(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function str(name: string, def = ""): string {
  const v = env()[name];
  return v === undefined || v === "" ? def : v;
}

function num(name: string, def: number): number {
  const v = Number.parseInt(env()[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export function loadConfig(): Config {
  const tursoUrl = str("TURSO_URL", "");
  return {
    spiderApiKey: str("SPIDER_API_KEY"),
    spiderApiBase: str("SPIDER_API_BASE", "https://api.spider.cloud"),
    spiderExtract: (str("SPIDER_EXTRACT", "auto") as ExtractMode) || "auto",
    crawlLimit: num("SPIDER_CRAWL_LIMIT", 30),
    crawlDepth: num("SPIDER_CRAWL_DEPTH", 2),
    spiderProxy: str("SPIDER_PROXY", "false") === "true",
    spiderCountry: str("SPIDER_COUNTRY", ""),
    aiStudio: str("SPIDER_AI_STUDIO", "false") === "true",

    tursoUrl: tursoUrl || "file:leads.db",
    tursoAuthToken: str("TURSO_AUTH_TOKEN"),

    plunkApiKey: str("PLUNK_API_KEY"),
    plunkApiBase: str("PLUNK_API_BASE", "https://next-api.useplunk.com"),
    verifyOnHunt: str("VERIFY_ON_HUNT", "true") !== "false",

    guessEmails: str("GUESS_EMAILS", "false") === "true",
    guessPerPerson: num("GUESS_PER_PERSON", 3),
    githubToken: str("GITHUB_TOKEN"),
    githubApiBase: str("GITHUB_API_BASE", "https://api.github.com"),

    icpInterests: str("ICP_INTERESTS", "").split(",").map((s) => s.trim()).filter(Boolean),
    icpCategories: str("ICP_CATEGORIES", "").split(",").map((s) => s.trim()).filter(Boolean),

    openaiApiKey: str("OPENAI_API_KEY"),
    openaiBaseUrl: str("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    openaiModel: str("OPENAI_MODEL", "gpt-4o-mini"),

    verbose: false,
  };
}

export function requireSpiderKey(cfg: Config): void {
  if (!cfg.spiderApiKey) {
    throw new Error(
      "SPIDER_API_KEY is not set. Get one at https://spider.cloud/api-keys and add it to your .env file."
    );
  }
}

export function requestMode(v: string): RequestMode {
  return v === "http" || v === "browser" || v === "smart" ? v : "smart";
}

export function extractMode(v: string | undefined): ExtractMode {
  return v === "local" || v === "spider" ? v : "auto";
}