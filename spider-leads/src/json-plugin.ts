// No-code JSON plugin compiler — browser-safe (no node imports), shared by the
// CLI loader and the extension UI. Turns a JsonPluginManifest into a runtime Plugin.
//
// A JSON plugin can declare, with zero code:
//   tools      — agent tools from built-in actions (fetch_url / search_web / fetch_jobs)
//                or plain HTTP calls ({param} placeholders, optional response path)
//   hooks      — webhooks fired onLead / afterRun
//   exporters  — jsonl / json / csv output formats for `export --exporter <id>`
//   rules      — extra interest & category keyword rules (no code)
//   filters    — named URL filters usable as --filter @name

import type { Config } from "./config.ts";
import type {
  JsonExporterDef, JsonPluginManifest, JsonToolDef, JsonWebhookDef,
  Plugin, PluginExporter, PluginTool, PipelineHooks,
} from "./types.ts";
import { registerRuleSets } from "./ai.ts";
import { scrapePage, searchPages } from "./spider.ts";
import { log } from "./log.ts";

// ---------------------------------------------------------------------------
// Validation (used by the extension attach UI and the CLI installer)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  error?: string;
  manifest?: JsonPluginManifest;
}

function isAllowedExternalUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) {
    // localhost allowed for development/testing
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(u);
  }
  return true;
}

/** External URLs a plugin can send data to (webhooks + http tools) — for install-time disclosure. */
export function pluginDataUrls(manifest: JsonPluginManifest): string[] {
  const urls: string[] = [];
  if (manifest.hooks?.onLead?.url) urls.push(manifest.hooks.onLead.url);
  if (manifest.hooks?.afterRun?.url) urls.push(manifest.hooks.afterRun.url);
  for (const t of manifest.tools ?? []) {
    if (t.action?.type === "http" && typeof t.action.url === "string") urls.push(t.action.url);
  }
  return [...new Set(urls)];
}

export function validateJsonPlugin(text: string): ValidationResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Plugin must be a JSON string" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON: " + (text.length > 80 ? text.slice(0, 80) + "…" : text) };
  }
  const m = parsed as Partial<JsonPluginManifest>;
  if (typeof m !== "object" || m === null) return { ok: false, error: "Plugin must be a JSON object" };
  if (!m.id || typeof m.id !== "string") return { ok: false, error: "Missing 'id' (string)" };
  if (!/^[a-z0-9][a-z0-9-_.]{0,63}$/.test(m.id)) return { ok: false, error: "'id' must be lowercase alphanumeric with dashes (e.g. my-plugin)" };
  if (!m.name || typeof m.name !== "string") return { ok: false, error: "Missing 'name' (string)" };
  if (!m.version || typeof m.version !== "string") return { ok: false, error: "Missing 'version' (string)" };
  if (m.tools !== undefined && !Array.isArray(m.tools)) return { ok: false, error: "'tools' must be an array" };
  if (m.exporters !== undefined && !Array.isArray(m.exporters)) return { ok: false, error: "'exporters' must be an array" };
  const bad = pluginDataUrls(m as JsonPluginManifest).filter((u) => !isAllowedExternalUrl(u));
  if (bad.length > 0) {
    return { ok: false, error: "plugin sends data to non-HTTPS URL(s): " + bad.slice(0, 3).join(", ") + " (only https:// or localhost are allowed)" };
  }
  return { ok: true, manifest: m as JsonPluginManifest };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** Dot-path getter: get(obj, "data.items") → obj.data.items */
function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Tool actions
// ---------------------------------------------------------------------------

async function builtinFetchUrl(cfg: Config | undefined, args: any): Promise<string> {
  const url = String(args.url ?? "");
  if (!url) return JSON.stringify({ error: "url is required" });
  if (!cfg?.spiderApiKey) return JSON.stringify({ error: "Spider API key not configured — fetch_url needs it" });
  try {
    const page = await scrapePage(cfg, url, { mode: "smart" });
    return JSON.stringify({ url: page.url, status: page.status, content: page.markdown.slice(0, 4000) });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function builtinSearchWeb(cfg: Config | undefined, args: any): Promise<string> {
  const query = String(args.query ?? "");
  if (!query) return JSON.stringify({ error: "query is required" });
  if (!cfg?.spiderApiKey) return JSON.stringify({ error: "Spider API key not configured — search_web needs it" });
  try {
    const pages = await searchPages(cfg, query, { limit: Math.min(Number(args.limit) || 5, 20) });
    return JSON.stringify({
      count: pages.length,
      results: pages.map((p) => ({ url: p.url, status: p.status, preview: p.markdown.replace(/\s+/g, " ").trim().slice(0, 300) })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

async function builtinFetchJobs(args: any): Promise<string> {
  const company = String(args.company ?? "");
  const platform = String(args.platform ?? "");
  const limit = Math.min(Number(args.limit) || 10, 50);
  if (!company) return JSON.stringify({ error: "company is required" });
  const out: any[] = [];
  try {
    if (platform === "greenhouse") {
      const res = await fetch("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(company) + "/jobs");
      if (!res.ok) return JSON.stringify({ error: "greenhouse: HTTP " + res.status });
      const data: any = await res.json();
      for (const j of (Array.isArray(data.jobs) ? data.jobs : []).slice(0, limit)) {
        out.push({ title: j.title, location: j.location?.name ?? null, url: j.absolute_url, updated: j.updated_at });
      }
    } else if (platform === "lever") {
      const res = await fetch("https://api.lever.co/v0/postings/" + encodeURIComponent(company) + "?mode=json");
      if (!res.ok) return JSON.stringify({ error: "lever: HTTP " + res.status });
      const data = (await res.json()) as any[];
      for (const p of (Array.isArray(data) ? data : []).slice(0, limit)) {
        out.push({ title: p.text, location: p.categories?.location ?? null, url: p.hostedUrl, updated: p.createdAt });
      }
    } else if (platform === "ashby") {
      const res = await fetch("https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(company), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) return JSON.stringify({ error: "ashby: HTTP " + res.status });
      const data: any = await res.json();
      for (const j of (Array.isArray(data.jobs) ? data.jobs : []).slice(0, limit)) {
        out.push({ title: j.title, location: j.location ?? null, url: j.jobUrl, updated: j.publishedAt });
      }
    } else {
      return JSON.stringify({ error: "platform must be greenhouse | lever | ashby" });
    }
    return JSON.stringify({ count: out.length, jobs: out });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

function makeHttpTool(tool: JsonToolDef): PluginTool {
  const action = tool.action as Extract<JsonToolDef["action"], { type: "http" }>;
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async run(args: any) {
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(args ?? {})) vars[k] = String(v ?? "");
      const url = substitute(action.url, vars);
      const method = (action.method ?? "GET").toUpperCase();
      const headers: Record<string, string> = { ...(action.headers ?? {}) };
      if (action.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const body = action.body !== undefined ? JSON.stringify(substituteJson(action.body, vars)) : undefined;
      try {
        const resp = await fetch(url, { method, headers, body });
        const text = await resp.text();
        if (!resp.ok) return JSON.stringify({ error: "HTTP " + resp.status + ": " + text.slice(0, 200) });
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* keep text */ }
        const extracted = action.extract ? getPath(parsed, action.extract) : parsed;
        return typeof extracted === "string" ? extracted : JSON.stringify(extracted ?? null);
      } catch (err) {
        return JSON.stringify({ error: (err as Error).message });
      }
    },
  };
}

function substituteJson(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteJson(v, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteJson(v, vars);
    return out;
  }
  return value;
}

function makeTool(cfg: Config | undefined, tool: JsonToolDef): PluginTool {
  const action = tool.action;
  if (action.type === "http") return makeHttpTool(tool);
  const builtin = action.id;
  const params = { ...(action.params ?? {}) };
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async run(args: any) {
      const merged = { ...params, ...(args ?? {}) };
      if (builtin === "fetch_url") return builtinFetchUrl(cfg, merged);
      if (builtin === "search_web") return builtinSearchWeb(cfg, merged);
      if (builtin === "fetch_jobs") return builtinFetchJobs(merged);
      return JSON.stringify({ error: "unknown builtin action: " + builtin });
    },
  };
}

// ---------------------------------------------------------------------------
// Hooks + exporters
// ---------------------------------------------------------------------------

function makeWebhookHook(def: JsonWebhookDef): (ctx: any) => Promise<void> {
  return async (ctx: any) => {
    const lead = ctx.lead ?? {};
    const vars: Record<string, string> = {
      email: String(lead.email ?? ""),
      company: String(lead.company ?? ""),
      title: String(lead.title ?? ""),
      outcome: String(ctx.outcome ?? ""),
      source: String(lead.source ?? ""),
      domain: String(lead.domain ?? ""),
    };
    const body = def.bodyTemplate
      ? substitute(def.bodyTemplate, vars)
      : JSON.stringify({ event: "lead", outcome: ctx.outcome ?? "", lead });
    try {
      await fetch(def.url, {
        method: def.method ?? "POST",
        headers: { "Content-Type": "application/json", ...(def.headers ?? {}) },
        body,
      });
    } catch (err) {
      log.warn("plugin webhook to " + def.url + " failed: " + (err as Error).message);
    }
  };
}

function makeExporter(def: JsonExporterDef): PluginExporter {
  return {
    id: def.id,
    label: def.label ?? def.id,
    export(rows: any[]) {
      if (def.format === "jsonl") {
        return { content: rows.map((r) => JSON.stringify(r)).join("\n") + "\n", filename: "leads.jsonl", mime: "application/x-ndjson" };
      }
      if (def.format === "json") {
        return { content: JSON.stringify(rows, null, 2) + "\n", filename: "leads.json", mime: "application/json" };
      }
      const cols = def.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
      const esc = (v: unknown) => {
        const str = String(v ?? "");
        return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      const lines = [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))];
      return { content: lines.join("\n") + "\n", filename: "leads.csv", mime: "text/csv" };
    },
  };
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/** Compile a validated JSON plugin manifest into a runtime Plugin. */
export function compileJsonPlugin(manifest: JsonPluginManifest, cfg?: Config): Plugin {
  const hooks: PipelineHooks = {};
  if (manifest.hooks?.onLead) hooks.onLead = makeWebhookHook(manifest.hooks.onLead);
  if (manifest.hooks?.afterRun) hooks.afterRun = makeWebhookHook(manifest.hooks.afterRun);

  registerRuleSets(manifest.id, manifest.rules);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    dir: "json",
    entry: "plugin.json",
    tools: (manifest.tools ?? []).map((t) => makeTool(cfg, t)),
    hooks,
    exporters: (manifest.exporters ?? []).map(makeExporter),
    filters: manifest.filters,
  };
}