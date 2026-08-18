/**
 * Plugin storage + attach helpers for the extension.
 *
 * No-code users install JSON plugins ("attach a plugin file" in Options).
 * They are stored in chrome.storage.local (data, not code — MV3 CSP stays
 * happy) and compiled with the same browser-safe compiler the CLI uses.
 */

import { compileJsonPlugin, pluginDataUrls, validateJsonPlugin } from '../vendor/leads-core.js';

const PLUGINS_KEY = 'spider_plugins';

/** { plugins: [{ id, name, version, description, enabled, manifest }] } */
async function readStore() {
  const result = await chrome.storage.local.get([PLUGINS_KEY]);
  return result[PLUGINS_KEY] || { plugins: [] };
}

async function writeStore(store) {
  await chrome.storage.local.set({ [PLUGINS_KEY]: store });
}

/** Metadata for the Options UI list. */
export async function getInstalledPluginMeta() {
  const store = await readStore();
  return store.plugins.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description || '',
    enabled: p.enabled !== false,
    tools: (p.manifest?.tools || []).map((t) => t.name),
    hooks: Object.keys(p.manifest?.hooks || {}),
    exporters: (p.manifest?.exporters || []).map((e) => e.id),
  }));
}

/**
 * Validate a plugin WITHOUT installing it — returns what it would do
 * (dataUrls it can send to, name/version). Use this to show a confirmation
 * BEFORE installPluginFromText.
 */
export function previewPluginText(text) {
  const check = validateJsonPlugin(text);
  if (!check.ok) return { ok: false, error: check.error };
  const manifest = check.manifest;
  return {
    ok: true,
    manifest,
    dataUrls: pluginDataUrls(manifest),
    name: manifest.name,
    version: manifest.version,
  };
}

/**
 * Install a plugin from raw JSON text (file contents or pasted text).
 * Validates, rejects duplicates, and returns the installed metadata.
 */
export async function installPluginFromText(text) {
  const check = validateJsonPlugin(text);
  if (!check.ok) return { ok: false, error: check.error };
  const manifest = check.manifest;
  const store = await readStore();
  const existing = store.plugins.find((p) => p.id === manifest.id);
  if (existing && existing.enabled !== false) {
    return { ok: false, error: "Plugin '" + manifest.id + "' is already installed. Remove it first to reinstall." };
  }
  const entry = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description || '',
    enabled: true,
    manifest,
  };
  if (existing) {
    store.plugins = store.plugins.map((p) => (p.id === manifest.id ? entry : p));
  } else {
    store.plugins.push(entry);
  }
  await writeStore(store);
  return { ok: true, plugin: { id: entry.id, name: entry.name, version: entry.version }, dataUrls: pluginDataUrls(manifest) };
}

export async function removePlugin(id) {
  const store = await readStore();
  store.plugins = store.plugins.filter((p) => p.id !== id);
  await writeStore(store);
}

export async function setPluginEnabled(id, enabled) {
  const store = await readStore();
  store.plugins = store.plugins.map((p) => (p.id === id ? { ...p, enabled: enabled !== false } : p));
  await writeStore(store);
}

/**
 * Compile the enabled plugins for the current run.
 * @returns {Promise<import('../vendor/leads-core.js').Plugin[]>} — structurally, array of compiled plugins
 */
export async function loadActivePlugins(cfg) {
  const store = await readStore();
  const active = store.plugins.filter((p) => p.enabled !== false);
  return active.map((p) => compileJsonPlugin(p.manifest, cfg));
}