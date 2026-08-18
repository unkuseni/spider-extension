/**
 * Spider Extension — Options Page Script
 */
import { getApiKey, setApiKey, getPreferences, setPreferences } from '../lib/spider-api.js';
import { getAiConfigs, setAiConfigs, testAiConnection } from '../lib/ai-client.js';
import { getLeadsSettings, setLeadsSettings } from '../lib/leads.js';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadSpiderSettings();
  await loadAiSettings();
  await loadLeadsSettings();
  bindEvents();
});

// ---------------------------------------------------------------------------
// Spider Cloud Settings
// ---------------------------------------------------------------------------

async function loadSpiderSettings() {
  const apiKey = await getApiKey();
  if (apiKey) document.getElementById('spiderApiKey').value = apiKey;

  const prefs = await getPreferences();
  if (prefs.defaultMode) document.getElementById('defaultMode').value = prefs.defaultMode;
  if (prefs.defaultFormat) document.getElementById('defaultFormat').value = prefs.defaultFormat;
}

async function saveSpiderSettings() {
  const apiKey = document.getElementById('spiderApiKey').value.trim();
  const mode = document.getElementById('defaultMode').value;
  const format = document.getElementById('defaultFormat').value;
  const status = document.getElementById('spiderStatus');

  try {
    await setApiKey(apiKey);
    await setPreferences({ defaultMode: mode, defaultFormat: format });
    status.textContent = '✓ Saved';
    status.className = 'status-msg success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.className = 'status-msg error';
  }
}

// ---------------------------------------------------------------------------
// AI BYOK Settings
// ---------------------------------------------------------------------------

async function loadAiSettings() {
  const configs = await getAiConfigs();

  for (const [provider, cfg] of Object.entries(configs)) {
    const keyEl = document.getElementById(`${provider}Key`);
    const modelEl = document.getElementById(`${provider}Model`);
    const endpointEl = document.getElementById(`${provider}Endpoint`);

    if (keyEl && cfg.key) keyEl.value = cfg.key;
    if (modelEl && cfg.model) modelEl.value = cfg.model;
    if (endpointEl && cfg.endpoint) endpointEl.value = cfg.endpoint;
  }
}

async function saveAiSettings() {
  const status = document.getElementById('aiStatus');
  try {
    const updates = {};

    // OpenAI (endpoint is OpenAI-compatible — DeepSeek/Groq/Ollama work here too)
    updates.openai = {
      key: document.getElementById('openaiKey').value.trim(),
      model: document.getElementById('openaiModel').value,
      endpoint: document.getElementById('openaiEndpoint').value.trim() || 'https://api.openai.com/v1/chat/completions',
    };

    // Anthropic
    updates.anthropic = {
      key: document.getElementById('anthropicKey').value.trim(),
      model: document.getElementById('anthropicModel').value,
    };

    // Gemini
    updates.gemini = {
      key: document.getElementById('geminiKey').value.trim(),
      model: document.getElementById('geminiModel').value,
    };

    // Ollama
    updates.ollama = {
      key: document.getElementById('ollamaKey')?.value?.trim() || 'ollama',
      endpoint: document.getElementById('ollamaEndpoint').value.trim(),
      model: document.getElementById('ollamaModel').value.trim(),
    };

    await setAiConfigs(updates);
    status.textContent = '✓ AI settings saved';
    status.className = 'status-msg success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = `✗ ${err.message}`;
    status.className = 'status-msg error';
  }
}

// ---------------------------------------------------------------------------
// Lead Finder Settings (Turso + Plunk)
// ---------------------------------------------------------------------------

async function loadLeadsSettings() {
  const settings = await getLeadsSettings();
  document.getElementById('tursoUrl').value = settings.tursoUrl || '';
  document.getElementById('tursoAuthToken').value = settings.tursoAuthToken || '';
  document.getElementById('plunkApiKey').value = settings.plunkApiKey || '';
  document.getElementById('leadsExtractMode').value = settings.extractMode || 'auto';
  document.getElementById('leadsCrawlLimit').value = settings.crawlLimit || 10;
  document.getElementById('leadsVerifyOnHunt').checked = settings.verifyOnHunt !== false;
}

async function saveLeadsSettings() {
  const status = document.getElementById('leadsStatus');
  try {
    await setLeadsSettings({
      tursoUrl: document.getElementById('tursoUrl').value.trim(),
      tursoAuthToken: document.getElementById('tursoAuthToken').value.trim(),
      plunkApiKey: document.getElementById('plunkApiKey').value.trim(),
      extractMode: document.getElementById('leadsExtractMode').value,
      crawlLimit: parseInt(document.getElementById('leadsCrawlLimit').value) || 10,
      verifyOnHunt: document.getElementById('leadsVerifyOnHunt').checked,
    });
    status.textContent = '✓ Lead Finder settings saved';
    status.className = 'status-msg success';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = '✗ ' + err.message;
    status.className = 'status-msg error';
  }
}

// ---------------------------------------------------------------------------
// Test AI connection
// ---------------------------------------------------------------------------

async function onTestConnection(provider) {
  const statusEl = document.getElementById(`${provider}Status`);
  if (!statusEl) return;

  // Save current config first
  await saveAiSettingsImmediate(provider);

  statusEl.textContent = 'Testing…';
  statusEl.className = 'provider-status testing';

  const result = await testAiConnection(provider);
  if (result.ok) {
    statusEl.textContent = `✓ Connected (${result.model})`;
    statusEl.className = 'provider-status ok';
  } else {
    statusEl.textContent = `✗ ${result.error}`;
    statusEl.className = 'provider-status error';
  }
}

/** Silently persist the current provider's fields before testing */
async function saveAiSettingsImmediate(provider) {
  const updates = {};
  const keyEl = document.getElementById(`${provider}Key`);
  const modelEl = document.getElementById(`${provider}Model`);
  const endpointEl = document.getElementById(`${provider}Endpoint`);

  updates[provider] = {
    key: keyEl?.value?.trim() || (provider === 'ollama' ? 'ollama' : ''),
    model: modelEl?.value || '',
  };
  if (endpointEl) updates[provider].endpoint = endpointEl.value.trim();

  await setAiConfigs(updates);
}

// ---------------------------------------------------------------------------
// Toggle password visibility
// ---------------------------------------------------------------------------

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function bindEvents() {
  document.getElementById('saveSpiderBtn').addEventListener('click', saveSpiderSettings);
  document.getElementById('saveAiBtn').addEventListener('click', saveAiSettings);
  document.getElementById('saveLeadsBtn').addEventListener('click', saveLeadsSettings);

  // Toggle password buttons
  document.getElementById('toggleSpiderKey').addEventListener('click', () => {
    togglePasswordVisibility('spiderApiKey');
  });

  document.querySelectorAll('.toggle-key').forEach(btn => {
    btn.addEventListener('click', () => {
      togglePasswordVisibility(btn.dataset.target);
    });
  });

  // Test AI buttons
  document.querySelectorAll('.test-ai-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      onTestConnection(btn.dataset.provider);
    });
  });
}