import { storageGet, storageSet } from './storage.js';

/**
 * BYOK AI Client — Bring Your Own Key
 *
 * Supports OpenAI, Anthropic (Claude), Google Gemini, and local Ollama.
 * Used for AI-powered content extraction, summarization, and transformation
 * on scraped/crawled pages.
 */

// ---------------------------------------------------------------------------
// Storage helpers for AI keys
// ---------------------------------------------------------------------------

const AI_KEYS_KEY = 'spider_ai_keys';

const PROVIDER_DEFAULTS = {
  openai:    { name: 'OpenAI',     endpoint: 'https://api.openai.com/v1/chat/completions',    model: 'gpt-4o-mini',   key: '' },
  anthropic: { name: 'Anthropic',  endpoint: 'https://api.anthropic.com/v1/messages',        model: 'claude-sonnet-4-20250514', key: '' },
  gemini:    { name: 'Gemini',     endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/', model: 'gemini-2.5-flash', key: '' },
  ollama:    { name: 'Ollama',     endpoint: 'http://localhost:11434/v1/chat/completions',    model: 'llama3',         key: '' },
};

/**
 * Retrieve all stored AI provider configs.
 * @returns {Promise<object>}
 */
export async function getAiConfigs() {
  const result = await storageGet([AI_KEYS_KEY]);
  return { ...PROVIDER_DEFAULTS, ...(result[AI_KEYS_KEY] || {}) };
}

/**
 * Store AI provider configs (partial merge).
 * @param {object} updates  e.g. { openai: { key: 'sk-...', model: 'gpt-4o' } }
 */
export async function setAiConfigs(updates) {
  const current = await getAiConfigs();
  const merged = { ...current };
  for (const [provider, cfg] of Object.entries(updates)) {
    merged[provider] = { ...merged[provider], ...cfg };
  }
  await storageSet({ [AI_KEYS_KEY]: merged });
}

/**
 * Test connectivity for a single AI provider.
 * @param {string} provider  'openai' | 'anthropic' | 'gemini' | 'ollama'
 * @returns {Promise<{ok: boolean, model: string, error?: string}>}
 */
export async function testAiConnection(provider) {
  const configs = await getAiConfigs();
  const cfg = configs[provider];
  if (!cfg || !cfg.key) {
    return { ok: false, model: cfg?.model || '', error: 'No API key configured' };
  }

  try {
    switch (provider) {
      case 'openai':
        return await testOpenAI(cfg);
      case 'anthropic':
        return await testAnthropic(cfg);
      case 'gemini':
        return await testGemini(cfg);
      case 'ollama':
        return await testOllama(cfg);
      default:
        return { ok: false, model: '', error: `Unknown provider: ${provider}` };
    }
  } catch (err) {
    return { ok: false, model: cfg.model, error: err.message };
  }
}

async function testOpenAI(cfg) {
  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 5,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.error?.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return { ok: true, model: data.model || cfg.model };
}

async function testAnthropic(cfg) {
  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 5,
      temperature: 0,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
    }),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.error?.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return { ok: true, model: data.model || cfg.model };
}

async function testGemini(cfg) {
  const url = `${cfg.endpoint}${cfg.model}:generateContent?key=${cfg.key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Say "ok" and nothing else.' }] }],
      generationConfig: { maxOutputTokens: 5, temperature: 0 },
    }),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.error?.message || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return { ok: true, model: cfg.model };
}

async function testOllama(cfg) {
  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 5,
      temperature: 0,
      stream: false,
    }),
  });
  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return { ok: true, model: data.model || cfg.model };
}

// ---------------------------------------------------------------------------
// Primary AI call
// ---------------------------------------------------------------------------

/**
 * Send content to an AI provider for extraction/transformation.
 *
 * @param {object} params
 * @param {string} params.provider    'openai' | 'anthropic' | 'gemini' | 'ollama'
 * @param {string} params.systemPrompt  System-level instructions
 * @param {string} params.userPrompt    Content + extraction instructions
 * @param {object} [params.options]      Extra options
 * @param {number} [params.options.temperature=0.1]
 * @param {number} [params.options.maxTokens=4096]
 * @returns {Promise<string>} The model's text response
 */
export async function aiExtract({ provider, systemPrompt, userPrompt, options = {} }) {
  const configs = await getAiConfigs();
  const cfg = configs[provider];
  if (!cfg || !cfg.key) {
    throw new Error(`${cfg?.name || provider}: no API key configured. Go to extension Options.`);
  }

  const temp = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 4096;

  switch (provider) {
    case 'openai':
      return callOpenAI(cfg, systemPrompt, userPrompt, temp, maxTokens);
    case 'anthropic':
      return callAnthropic(cfg, systemPrompt, userPrompt, temp, maxTokens);
    case 'gemini':
      return callGemini(cfg, systemPrompt, userPrompt, temp, maxTokens);
    case 'ollama':
      return callOllama(cfg, systemPrompt, userPrompt, temp, maxTokens);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// Convenience: pre-built extraction prompts
// ---------------------------------------------------------------------------

const EXTRACTION_PRESETS = {
  summarize: {
    label: 'Summarize',
    system: 'You are a precise content summarizer. Return only the summary, no preamble.',
    user: (content) => `Summarize the following web page content in 3-5 bullet points. Be concise.\n\n---\n${content}\n---`,
  },
  extractEmails: {
    label: 'Extract Emails',
    system: 'You extract contact information from web content. Return ONLY valid JSON.',
    user: (content) => `Extract all email addresses, phone numbers, and contact names from this page. Return as JSON:\n{"emails":[],"phones":[],"contacts":[]}\n\n---\n${content}\n---`,
  },
  extractEntities: {
    label: 'Extract Entities',
    system: 'You extract named entities from web content. Return ONLY valid JSON.',
    user: (content) => `Extract companies, people, products, locations, and dates mentioned. Return as JSON:\n{"companies":[],"people":[],"products":[],"locations":[],"dates":[]}\n\n---\n${content}\n---`,
  },
  cleanMarkdown: {
    label: 'Clean Markdown',
    system: 'You clean and format web content into well-structured Markdown. Remove navigation, ads, footers. Return only the cleaned Markdown.',
    user: (content) => `Clean up this web page content. Remove boilerplate (nav, ads, footers, sidebars). Keep headings, paragraphs, lists, links, and tables. Return clean Markdown.\n\n---\n${content}\n---`,
  },
  custom: {
    label: 'Custom Prompt',
    system: 'You are a helpful AI assistant that processes web content.',
    user: (content, customPrompt) => customPrompt || `Process this content:\n\n---\n${content}\n---`,
  },
};

/**
 * Run an AI extraction using one of the built-in presets.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.preset      One of: summarize, extractEmails, extractEntities, cleanMarkdown, custom
 * @param {string} params.content     The page content to process
 * @param {string} [params.customPrompt] Required when preset='custom'
 * @param {object} [params.options]
 * @returns {Promise<string>}
 */
export async function aiExtractPreset({ provider, preset, content, customPrompt, options }) {
  const tmpl = EXTRACTION_PRESETS[preset];
  if (!tmpl) throw new Error(`Unknown preset: ${preset}`);

  const userPrompt = preset === 'custom'
    ? tmpl.user(content, customPrompt)
    : tmpl.user(content);

  return aiExtract({
    provider,
    systemPrompt: tmpl.system,
    userPrompt,
    options,
  });
}

// ---------------------------------------------------------------------------
// Provider-specific API callers
// ---------------------------------------------------------------------------

async function callOpenAI(cfg, systemPrompt, userPrompt, temperature, maxTokens) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, temperature, max_tokens: maxTokens }),
  });

  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(`OpenAI: ${b.error?.message || `HTTP ${resp.status}`}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(cfg, systemPrompt, userPrompt, temperature, maxTokens) {
  const messages = [];
  if (systemPrompt) {
    // Anthropic uses a top-level `system` field, not a message role
  }
  messages.push({ role: 'user', content: userPrompt });

  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    temperature,
    messages,
  };
  if (systemPrompt) body.system = systemPrompt;

  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(`Anthropic: ${b.error?.message || `HTTP ${resp.status}`}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callGemini(cfg, systemPrompt, userPrompt, temperature, maxTokens) {
  const parts = [];
  if (systemPrompt) parts.push({ text: `[System: ${systemPrompt}]\n\n${userPrompt}` });
  else parts.push({ text: userPrompt });

  const url = `${cfg.endpoint}${cfg.model}:generateContent?key=${cfg.key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });

  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(`Gemini: ${b.error?.message || `HTTP ${resp.status}`}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOllama(cfg, systemPrompt, userPrompt, temperature, maxTokens) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, stream: false,
      options: { temperature, num_predict: maxTokens } }),
  });

  if (!resp.ok) {
    const b = await resp.json().catch(() => ({}));
    throw new Error(`Ollama: ${b.error || `HTTP ${resp.status}`}`);
  }
  const data = await resp.json();
  return data.message?.content || data.response || '';
}

// ---------------------------------------------------------------------------
// Export presets for UI use
// ---------------------------------------------------------------------------

export { EXTRACTION_PRESETS };