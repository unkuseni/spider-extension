// Plugin loader (CLI-only — uses node:fs; do NOT import from the browser bundle).
//
// Discovery: SPIDER_PLUGINS_DIR env var, else <cwd>/plugins. Each subdirectory
// containing a plugin.json is a plugin:
//
//   plugins/
//     my-plugin/
//       plugin.json      { "id", "name", "version", "description?", "entry?" }
//       index.ts         default export: { tools?, hooks?, exporters? }
//
// Plugins are ordinary Node modules (TS runs natively on Node ≥ 24). They are
// fully trusted code — only install plugins you wrote or audited.

import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Config } from "./config.ts";
import type { JsonPluginManifest, Plugin, PluginManifest } from "./types.ts";
import { compileJsonPlugin, pluginDataUrls, validateJsonPlugin } from "./json-plugin.ts";
import { log } from "./log.ts";

export interface LoadResult {
  plugins: Plugin[];
  errors: string[];
}

/** Resolve the plugins directory (env override, else <cwd>/plugins). */
export function discoverPluginsDir(envDir?: string): string {
  const v = (envDir ?? "").trim() || (typeof process !== "undefined" && process.env ? process.env.SPIDER_PLUGINS_DIR ?? "" : "").trim();
  return v || join(process.cwd(), "plugins");
}

function validateManifest(m: Partial<PluginManifest>): m is PluginManifest {
  return typeof m.id === "string" && m.id.length > 0 &&
    typeof m.name === "string" && m.name.length > 0 &&
    typeof m.version === "string" && m.version.length > 0;
}

/**
 * Load every plugin from a directory. One broken plugin never prevents the
 * others from loading — failures are collected and reported.
 */
export async function loadPlugins(dir: string, cfg?: Config): Promise<LoadResult> {
  let subdirs: string[] = [];
  try {
    subdirs = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return { plugins: [], errors: [] }; // no plugins dir → not an error
  }

  const plugins: Plugin[] = [];
  const errors: string[] = [];

  // 1) Single-file JSON plugins: plugins/<name>.json (no-code, no folder needed)
  let files: string[] = [];
  try {
    files = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "plugin.json")
      .map((e) => e.name);
  } catch { /* dir missing handled below */ }

  for (const fname of files.sort()) {
    try {
      const raw = await readFile(join(dir, fname), "utf8");
      const plugin = jsonPluginFromText(raw, fname);
      plugins.push(plugin);
      log.info("Loaded plugin " + plugin.id + " v" + plugin.version + " (" + fname + ")");
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(fname + ": " + msg);
      log.warn("Plugin failed to load: " + fname + " — " + msg);
    }
  }

  // 2) Folder plugins: plugins/<name>/plugin.json (+ optional code entry)
  for (const name of subdirs.sort()) {
    const pdir = join(dir, name);
    try {
      const manifestRaw = await readFile(join(pdir, "plugin.json"), "utf8");
      const manifest: Partial<PluginManifest> & Partial<JsonPluginManifest> = JSON.parse(manifestRaw);
      if (!validateManifest(manifest)) {
        throw new Error("plugin.json must contain id, name, version (strings)");
      }
      // No-code JSON plugin: no entry file AND data-driven fields present.
      const hasJsonFields =
        "tools" in manifest || "hooks" in manifest ||
        "exporters" in manifest || "rules" in manifest || "filters" in manifest;
      if (!manifest.entry && hasJsonFields) {
        const plugin = compileJsonPlugin(manifest as JsonPluginManifest, cfg);
        plugins.push({ ...plugin, dir: pdir });
        log.info("Loaded plugin " + plugin.id + " v" + plugin.version + " (JSON, " + name + ")");
        continue;
      }
      const entry = manifest.entry ?? "index.ts";
      // Cache-bust so dev edits to plugins are picked up between runs.
      const mod = await import(pathToFileURL(join(pdir, entry)).href + "?t=" + Date.now());
      const def = mod?.default ?? mod?.plugin;
      if (!def || typeof def !== "object") {
        throw new Error(entry + " must export a plugin object (default export or named export 'plugin')");
      }
      plugins.push({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? "",
        dir: pdir,
        entry,
        tools: Array.isArray(def.tools) ? def.tools : [],
        hooks: def.hooks ?? {},
        exporters: Array.isArray(def.exporters) ? def.exporters : [],
        filters: Array.isArray(def.filters) ? def.filters : undefined,
      });
      log.info("Loaded plugin " + manifest.id + " v" + manifest.version + " (" + name + ")");
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(name + ": " + msg);
      log.warn("Plugin failed to load: " + name + " — " + msg);
    }
  }
  return { plugins, errors };
}

/** Compile a JSON plugin from raw text (used by loadPlugins and plugins install). */
export function jsonPluginFromText(raw: string, sourceName: string, cfg?: Config): Plugin {
  const check = validateJsonPlugin(raw);
  if (!check.ok || !check.manifest) throw new Error(sourceName + ": " + (check.error ?? "invalid plugin"));
  return compileJsonPlugin(check.manifest, cfg);
}

/**
 * Install a plugin file (JSON) into the plugins directory as <id>.json.
 * Returns the installed plugin id.
 */
export async function installJsonPluginFile(filePath: string, pluginsDir: string, cfg?: Config): Promise<string> {
  const raw = await readFile(filePath, "utf8");
  const plugin = jsonPluginFromText(raw, filePath, cfg);
  const dest = join(pluginsDir, plugin.id + ".json");
  try {
    await readFile(dest, "utf8");
    throw new Error("a plugin with id '" + plugin.id + "' is already installed (" + dest + ") — remove it first to reinstall");
  } catch (err) {
    if ((err as Error).message.includes("already installed")) throw err;
    // ENOENT = not installed yet — proceed
  }
  await writeFile(dest, JSON.stringify(JSON.parse(raw), null, 2) + "\n");
  const urls = pluginDataUrls(JSON.parse(raw) as JsonPluginManifest);
  if (urls.length > 0) {
    log.warn("This plugin sends data to: " + urls.join(", "));
  }
  return plugin.id;
}
/** Resolve a named filter ("@name") from loaded plugins to its regex pattern. */
export function resolveNamedFilter(plugins: Plugin[], filter: string): string | undefined {
  if (!filter.startsWith("@")) return undefined;
  const name = filter.slice(1);
  for (const p of plugins) {
    const f = (p.filters ?? []).find((x) => x.name === name);
    if (f) return f.pattern;
  }
  return undefined;
}