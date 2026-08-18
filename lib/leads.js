/**
 * Lead Finder integration — glue between the extension UI and the shared
 * spider-leads pipeline (vendored as vendor/leads-core.js).
 *
 * Responsibilities:
 *  - read/write Lead Finder settings (Turso, Plunk) via chrome.storage.sync
 *  - build the Config object the shared pipeline expects from stored keys
 *  - lazily open a single Turso client for the whole panel session
 */

import { ensureDb } from '../vendor/leads-core.js';

const LEADS_SETTINGS_KEY = 'spider_leads_settings';

const LEADS_SETTINGS_DEFAULTS = {
  tursoUrl: '',        // e.g. libsql://leads-yourname.turso.io
  tursoAuthToken: '',
  plunkApiKey: '',     // sk_*
  verifyOnHunt: true,
  extractMode: 'auto', // auto | local | spider
  crawlLimit: 10,
};

/** Read Lead Finder settings from Chrome sync storage. */
export async function getLeadsSettings() {
  const result = await chrome.storage.sync.get([LEADS_SETTINGS_KEY]);
  return { ...LEADS_SETTINGS_DEFAULTS, ...(result[LEADS_SETTINGS_KEY] || {}) };
}

/** Merge updates into Lead Finder settings. */
export async function setLeadsSettings(updates) {
  const existing = await getLeadsSettings();
  await chrome.storage.sync.set({ [LEADS_SETTINGS_KEY]: { ...existing, ...updates } });
}

/**
 * The @libsql/client web build speaks Hrana over HTTP(S) or WebSocket.
 * Turso's libsql:// URLs work, but https:// avoids needing wss host
 * permissions, so we normalize libsql:// → https://.
 */
export function tursoWebUrl(url) {
  if (!url) return '';
  return url
    .replace(/^libsql:\/\//, 'https://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
}

/**
 * Build the Config object expected by the shared pipeline from stored keys:
 *  - Spider Cloud key (existing setting)
 *  - Turso + Plunk (Lead Finder settings)
 *  - AI: reuses the BYOK "OpenAI" provider config, so DeepSeek/Groq/Ollama
 *    work by pointing the OpenAI endpoint at their OpenAI-compatible API.
 */
export async function buildLeadsConfig() {
  const [spider, prefs, ai, leads] = await Promise.all([
    chrome.storage.sync.get(['spider_api_key']),
    chrome.storage.sync.get(['spider_prefs']),
    chrome.storage.sync.get(['spider_ai_keys']),
    getLeadsSettings(),
  ]);

  const openai = (ai.spider_ai_keys || {}).openai || {};
  const openaiEndpoint = openai.endpoint || 'https://api.openai.com/v1/chat/completions';
  const openaiBaseUrl = openaiEndpoint.replace(/\/chat\/completions$/, '');

  return {
    spiderApiKey: spider.spider_api_key || '',
    spiderApiBase: 'https://api.spider.cloud',
    spiderExtract: leads.extractMode || 'auto',
    crawlLimit: leads.crawlLimit || (prefs.spider_prefs || {}).defaultLimit || 10,
    crawlDepth: 2,

    tursoUrl: tursoWebUrl(leads.tursoUrl),
    tursoAuthToken: leads.tursoAuthToken || '',

    plunkApiKey: leads.plunkApiKey || '',
    plunkApiBase: 'https://next-api.useplunk.com',
    verifyOnHunt: leads.verifyOnHunt !== false,

    openaiApiKey: openai.key || '',
    openaiBaseUrl,
    openaiModel: openai.model || 'gpt-4o-mini',

    verbose: false,
  };
}

/** Human-readable list of missing config needed for the Lead Finder. */
export function missingLeadsConfig(cfg) {
  const missing = [];
  if (!cfg.spiderApiKey) missing.push('Spider Cloud API key');
  if (!cfg.tursoUrl) missing.push('Turso URL');
  if (!cfg.plunkApiKey) missing.push('Plunk API key');
  if (!cfg.openaiApiKey) missing.push('AI key (OpenAI/DeepSeek/Groq…)');
  return missing;
}

let _db = null;

/** Lazily open the Turso client (one per panel session). */
export async function getLeadsDb() {
  if (!_db) {
    const cfg = await buildLeadsConfig();
    _db = await ensureDb(cfg);
  }
  return _db;
}
