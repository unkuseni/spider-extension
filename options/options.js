/**
 * Spider Extension — Options Page Script
 */
import { getApiKey, setApiKey, getPreferences, setPreferences } from '../lib/spider-api.js';
import { getAiConfigs, setAiConfigs, testAiConnection } from '../lib/ai-client.js';
import { getLeadsSettings, setLeadsSettings } from '../lib/leads.js';
import {
  getInstalledPluginMeta, installPluginFromText, previewPluginText, removePlugin, setPluginEnabled,
} from '../lib/plugins.js';
import { buildPluginWithAI } from '../lib/plugin-builder.js';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadSpiderSettings();
  await loadAiSettings();
  await loadLeadsSettings();
  await refreshInstalledPlugins();
  await updateSetupProgress();
  bindEvents();
});

// ---------------------------------------------------------------------------
// Setup progress — the "am I ready?" strip at the top of the page.
// Mirrors the Leads panel's checklist: Spider key + AI key + Turso + Plunk.
// ---------------------------------------------------------------------------

async function updateSetupProgress() {
  try {
    const [apiKey, ai, leads] = await Promise.all([getApiKey(), getAiConfigs(), getLeadsSettings()]);
    // The lead pipeline prefers the OpenAI slot (works for DeepSeek/Groq), then
    // falls back to Ollama and Gemini — mirror buildLeadsConfig in lib/leads.js.
    const hasAi = !!(ai.openai?.key || ai.ollama?.endpoint || ai.gemini?.key);
    const items = [
      { label: '🕷️ Spider Cloud', ok: !!apiKey },
      { label: '🤖 AI key', ok: hasAi },
      { label: '🗄️ Turso DB', ok: !!leads.tursoUrl },
      { label: '✅ Plunk', ok: !!leads.plunkApiKey },
    ];
    const n = items.filter((i) => i.ok).length;
    const pills = document.getElementById('setupProgressPills');
    const title = document.getElementById('setupProgressTitle');
    if (!pills || !title) return;
    pills.innerHTML = items.map((i) =>
      '<span class="setup-pill ' + (i.ok ? 'ok' : 'missing') + '">' + (i.ok ? '✓' : '✗') + ' ' + i.label + '</span>'
    ).join('');
    const ready = n === items.length;
    title.textContent = ready ? '✅ Setup complete — you can hunt leads now' : 'Setup progress: ' + n + ' / ' + items.length;
    document.getElementById('setupProgress').classList.toggle('done', ready);
  } catch { /* never block the options page on this */ }
}

// ---------------------------------------------------------------------------
// Spider Cloud Settings
// ---------------------------------------------------------------------------

async function loadSpiderSettings() {
  const apiKey = await getApiKey();
  if (apiKey) document.getElementById('spiderApiKey').value = apiKey;

  const prefs = await getPreferences();
  if (prefs.defaultMode) document.getElementById('defaultMode').value = prefs.defaultMode;
  if (prefs.defaultFormat) document.getElementById('defaultFormat').value = prefs.defaultFormat;
  document.getElementById('usePremiumProxy').checked = prefs.usePremiumProxy === true;
  document.getElementById('proxyCountry').value = prefs.proxyCountry || '';
}

async function saveSpiderSettings() {
  const apiKey = document.getElementById('spiderApiKey').value.trim();
  const mode = document.getElementById('defaultMode').value;
  const format = document.getElementById('defaultFormat').value;
  const status = document.getElementById('spiderStatus');

  try {
    await setApiKey(apiKey);
    await setPreferences({
      defaultMode: mode,
      defaultFormat: format,
      usePremiumProxy: document.getElementById('usePremiumProxy').checked,
      proxyCountry: document.getElementById('proxyCountry').value.trim(),
    });
    status.textContent = '✓ Saved';
    status.className = 'status-msg success';
    updateSetupProgress();
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
    updateSetupProgress();
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
  document.getElementById('leadsGuessEmails').checked = settings.guessEmails === true;
  document.getElementById('leadsGuessPerPerson').value = settings.guessPerPerson || 3;
  document.getElementById('icpInterests').value = settings.icpInterests || '';
  document.getElementById('icpCategories').value = settings.icpCategories || '';
  document.getElementById('leadsAiStudio').checked = settings.aiStudio === true;
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
      guessEmails: document.getElementById('leadsGuessEmails').checked,
      guessPerPerson: parseInt(document.getElementById('leadsGuessPerPerson').value) || 3,
      icpInterests: document.getElementById('icpInterests').value.trim(),
      icpCategories: document.getElementById('icpCategories').value.trim(),
      aiStudio: document.getElementById('leadsAiStudio').checked,
    });
    status.textContent = '✓ Lead Finder settings saved';
    status.className = 'status-msg success';
    updateSetupProgress();
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    status.textContent = '✗ ' + err.message;
    status.className = 'status-msg error';
  }
}


// ---------------------------------------------------------------------------
// Plugins (no-code attach UI)
// ---------------------------------------------------------------------------

async function refreshInstalledPlugins() {
  const wrap = document.getElementById('installedPlugins');
  const list = await getInstalledPluginMeta();
  if (list.length === 0) {
    wrap.innerHTML = '<p class="small-muted">No plugins installed yet — attach one above.</p>';
    return;
  }
  wrap.innerHTML = list.map((p) => {
    const bits = [
      p.tools.length ? 'tools: ' + p.tools.join(', ') : '',
      p.hooks.length ? 'hooks: ' + p.hooks.join(', ') : '',
      p.exporters.length ? 'exporters: ' + p.exporters.join(', ') : '',
    ].filter(Boolean).join(' · ');
    return '<div class="installed-plugin">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<input type="checkbox" data-plugin-toggle="' + p.id + '"' + (p.enabled ? ' checked' : '') + ' title="Enable/disable" />' +
      '<b>' + escapeHtml(p.name) + '</b> <span class="small-muted">v' + escapeHtml(p.version) + '</span>' +
      '</div>' +
      '<div class="small-muted">' + escapeHtml(p.description) + (bits ? '<br>' + escapeHtml(bits) : '') + '</div>' +
      '<button class="btn btn-sm btn-outline plugin-remove" data-plugin-remove="' + p.id + '" style="margin-top:6px">🗑 Remove</button>' +
      '</div>';
  }).join('');

  wrap.querySelectorAll('[data-plugin-toggle]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      await setPluginEnabled(cb.dataset.pluginToggle, cb.checked);
    });
  });
  wrap.querySelectorAll('.plugin-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removePlugin(btn.dataset.pluginRemove);
      await refreshInstalledPlugins();
    });
  });
}

function pluginStatusMsg(msg, ok) {
  const el = document.getElementById('pluginStatus');
  el.textContent = msg;
  el.className = 'status-msg ' + (ok ? 'success' : 'error');
  setTimeout(() => { el.textContent = ''; }, 4000);
}

async function attachPluginFile() {
  const input = document.getElementById('pluginFileInput');
  const file = input.files && input.files[0];
  if (!file) return pluginStatusMsg('Choose a plugin .json file first', false);
  const text = await file.text();
  const preview = previewPluginText(text);
  if (!preview.ok) return pluginStatusMsg('✗ ' + preview.error, false);
  if (preview.dataUrls.length > 0) {
    const ok = window.confirm('This plugin can send data to:\n\n' + preview.dataUrls.join('\n') + '\n\nInstall it anyway?');
    if (!ok) return pluginStatusMsg('Install cancelled', false);
  }
  const res = await installPluginFromText(text);
  if (res.ok) {
    pluginStatusMsg('✓ Plugin "' + res.plugin.name + '" v' + res.plugin.version + ' attached', true);
    input.value = '';
    await refreshInstalledPlugins();
  } else {
    pluginStatusMsg('✗ ' + res.error, false);
  }
}

async function installPastedPlugin() {
  const text = document.getElementById('pluginPaste').value.trim();
  if (!text) return pluginStatusMsg('Paste a plugin JSON first', false);
  const preview = previewPluginText(text);
  if (!preview.ok) return pluginStatusMsg('✗ ' + preview.error, false);
  if (preview.dataUrls.length > 0) {
    const ok = window.confirm('This plugin can send data to:\n\n' + preview.dataUrls.join('\n') + '\n\nInstall it anyway?');
    if (!ok) return pluginStatusMsg('Install cancelled', false);
  }
  const res = await installPluginFromText(text);
  if (res.ok) {
    pluginStatusMsg('✓ Plugin "' + res.plugin.name + '" v' + res.plugin.version + ' installed', true);
    document.getElementById('pluginPaste').value = '';
    await refreshInstalledPlugins();
  } else {
    pluginStatusMsg('✗ ' + res.error, false);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


// ---------------------------------------------------------------------------
// AI plugin builder
// ---------------------------------------------------------------------------

let generatedPluginText = '';

async function generatePluginWithAI() {
  const prompt = document.getElementById('builderPrompt').value.trim();
  const provider = document.getElementById('builderProvider').value;
  const btn = document.getElementById('generatePluginBtn');
  if (!prompt) return pluginStatusMsg('Describe the plugin you want first', false);
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  try {
    const res = await buildPluginWithAI(provider, prompt);
    if (res.ok) {
      generatedPluginText = res.text;
      document.getElementById('builderPreview').value = JSON.stringify(res.manifest, null, 2);
      document.getElementById('installGeneratedBtn').disabled = false;
      pluginStatusMsg('✓ Plugin generated — review and install', true);
    } else {
      generatedPluginText = res.text || '';
      document.getElementById('builderPreview').value = res.text || '';
      document.getElementById('installGeneratedBtn').disabled = true;
      pluginStatusMsg('✗ ' + (res.error || 'generation failed'), false);
    }
  } catch (err) {
    pluginStatusMsg('✗ ' + err.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

async function installGeneratedPlugin() {
  const text = document.getElementById('builderPreview').value.trim();
  if (!text) return pluginStatusMsg('Nothing to install', false);
  const preview = previewPluginText(text);
  if (!preview.ok) return pluginStatusMsg('✗ ' + preview.error, false);
  if (preview.dataUrls.length > 0) {
    const ok = window.confirm('This plugin can send data to:\n\n' + preview.dataUrls.join('\n') + '\n\nInstall it anyway?');
    if (!ok) return pluginStatusMsg('Install cancelled', false);
  }
  const res = await installPluginFromText(text);
  if (res.ok) {
    pluginStatusMsg('✓ Plugin "' + res.plugin.name + '" v' + res.plugin.version + ' installed', true);
    document.getElementById('builderPreview').value = '';
    document.getElementById('installGeneratedBtn').disabled = true;
    await refreshInstalledPlugins();
  } else {
    pluginStatusMsg('✗ ' + res.error, false);
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
  document.querySelectorAll('.icp-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('icpInterests').value = btn.dataset.int || '';
      document.getElementById('icpCategories').value = btn.dataset.cat || '';
      const status = document.getElementById('leadsStatus');
      if (status) {
        status.textContent = '✓ Preset loaded — click "Save Lead Finder Settings" to apply';
        status.className = 'status-msg success';
      }
    });
  });
  document.getElementById('installPluginFileBtn').addEventListener('click', attachPluginFile);
  document.getElementById('installPluginPasteBtn').addEventListener('click', installPastedPlugin);
  document.getElementById('pluginFormatLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://github.com/spider-rs/spider/blob/main/README.md', '_blank');
  });
  document.getElementById('generatePluginBtn').addEventListener('click', generatePluginWithAI);
  document.getElementById('installGeneratedBtn').addEventListener('click', installGeneratedPlugin);
  document.getElementById('builderPreview').addEventListener('input', () => {
    document.getElementById('installGeneratedBtn').disabled = !document.getElementById('builderPreview').value.trim();
  });

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