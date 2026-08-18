import { storageGet, storageSet } from './storage.js';

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
  const result = await storageGet([LEADS_SETTINGS_KEY]);
  return { ...LEADS_SETTINGS_DEFAULTS, ...(result[LEADS_SETTINGS_KEY] || {}) };
}

/** Merge updates into Lead Finder settings. */
export async function setLeadsSettings(updates) {
  const existing = await getLeadsSettings();
  await storageSet({ [LEADS_SETTINGS_KEY]: { ...existing, ...updates } });
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
    storageGet(['spider_api_key']),
    storageGet(['spider_prefs']),
    storageGet(['spider_ai_keys']),
    getLeadsSettings(),
  ]);

  // The shared pipeline speaks OpenAI-compatible chat completions. Prefer the
  // "OpenAI" provider slot (works for OpenAI/DeepSeek/Groq), then fall back to
  // Ollama and Gemini, which both expose OpenAI-compatible endpoints.
  const aiKeys = ai.spider_ai_keys || {};
  const openai = aiKeys.openai || {};
  let aiKey = openai.key || '';
  let aiBase = (openai.endpoint || 'https://api.openai.com/v1/chat/completions').replace(/\/chat\/completions$/, '');
  let aiModel = openai.model || 'gpt-4o-mini';
  if (!aiKey) {
    if (aiKeys.ollama && aiKeys.ollama.endpoint) {
      aiBase = aiKeys.ollama.endpoint.replace(/\/chat\/completions$/, '');
      aiModel = aiKeys.ollama.model || 'llama3';
      aiKey = 'ollama';
    } else if (aiKeys.gemini && aiKeys.gemini.key) {
      aiKey = aiKeys.gemini.key;
      aiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
      aiModel = aiKeys.gemini.model || 'gemini-2.5-flash';
    }
  }

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

    openaiApiKey: aiKey,
    openaiBaseUrl: aiBase,
    openaiModel: aiModel,

    verbose: false,
  };
}

/** Human-readable list of missing config needed for the Lead Finder. */
export function missingLeadsConfig(cfg) {
  const missing = [];
  if (!cfg.spiderApiKey) missing.push('Spider Cloud API key');
  if (!cfg.tursoUrl) missing.push('Turso URL');
  if (!cfg.plunkApiKey) missing.push('Plunk API key');
  if (!cfg.openaiApiKey) missing.push('AI key (configure OpenAI/DeepSeek, Ollama, or Gemini in Settings)');
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