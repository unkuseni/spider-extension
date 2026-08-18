// Shared types for spider-leads (erasable-syntax TS — runs directly under Node 24 type stripping)

export type ExtractMode = "auto" | "local" | "spider";
export type RequestMode = "smart" | "http" | "browser";
export type LeadStatus = "new" | "verified" | "invalid" | "error";
export type EmailType = "corporate" | "business" | "student" | "personal" | "unknown";

export interface Interest {
  topic: string;
  confidence: number;
}

export interface PageContent {
  url: string;
  markdown: string;
  status: number;
}

export interface ContactRecord {
  email?: string;
  person_name?: string;
  title?: string;
  phone?: string;
  linkedin?: string;
}

export interface Categorization {
  category: string;
  subcategory: string;
  tier: string;
  confidence: number;
  reason: string;
  method: "ai" | "rules";
  interests: Interest[];
}

export interface VerificationResult {
  valid: boolean;
  isDisposable: boolean;
  isAlias: boolean;
  isTypo: boolean;
  isPlusAddressed: boolean;
  isPersonalEmail: boolean;
  domainExists: boolean;
  hasWebsite: boolean;
  hasMxRecords: boolean;
  reasons: string[];
  checkedAt: string;
}


// ---------------------------------------------------------------------------
// Plugin system types (the loader in plugins.ts is CLI-only — no fs here so
// this file stays browser-safe for the extension bundle)
// ---------------------------------------------------------------------------

/** Runtime context handed to plugin tool runs (config + DB of the current session). */
export interface PluginToolContext {
  cfg?: unknown;
  db?: unknown;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: any, ctx?: PluginToolContext) => Promise<string> | string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** Entry file relative to the plugin dir (default "index.ts"). */
  entry?: string;
}

export interface PluginHookContext {
  source: string;
  target: string;
}

export interface PluginOnLeadContext {
  lead: Lead;
  outcome: "new" | "updated";
}

export interface PluginAfterRunContext {
  summary: RunSummary;
}

export interface PipelineHooks {
  beforeRun?(ctx: PluginHookContext): void | Promise<void>;
  onLead?(ctx: PluginOnLeadContext): void | Promise<void>;
  afterRun?(ctx: PluginAfterRunContext): void | Promise<void>;
}

export interface PluginExporter {
  id: string;
  label: string;
  export(rows: unknown[]): { content: string; filename: string; mime: string } | Promise<{ content: string; filename: string; mime: string }>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  dir: string;
  entry: string;
  tools: PluginTool[];
  hooks: PipelineHooks;
  exporters: PluginExporter[];
  /** Named URL filters usable as --filter @name (JSON plugins). */
  filters?: { name: string; pattern: string }[];
}

// ---------------------------------------------------------------------------
// No-code (JSON-only) plugin format — non-developers can define these by hand
// or generate them, and attach them through the extension UI or the CLI.
// ---------------------------------------------------------------------------

export interface JsonToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  action:
    | {
        type: "http";
        method?: string;
        /** May contain {param} placeholders substituted from tool arguments. */
        url: string;
        headers?: Record<string, string>;
        body?: unknown;
        /** Optional dot-path into the JSON response, e.g. "data.items". */
        extract?: string;
      }
    | { type: "builtin"; id: "fetch_url" | "search_web" | "fetch_jobs"; params?: Record<string, unknown> };
}

export interface JsonWebhookDef {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Template with {email}, {company}, {title}, {outcome}, {source} placeholders. */
  bodyTemplate?: string;
}

export interface JsonExporterDef {
  id: string;
  label: string;
  format: "jsonl" | "json" | "csv";
  columns?: string[];
}

export interface JsonRuleSet {
  categories?: { match: string; category: string }[];
  interests?: { match: string; topic: string; confidence?: number }[];
}

export interface JsonPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tools?: JsonToolDef[];
  hooks?: { onLead?: JsonWebhookDef; afterRun?: JsonWebhookDef };
  exporters?: JsonExporterDef[];
  rules?: JsonRuleSet;
  filters?: { name: string; pattern: string }[];
}

export interface Lead {
  email: string | null;
  emailType: EmailType | null;
  personName: string | null;
  title: string | null;
  phone: string | null;
  linkedin: string | null;
  company: string | null;
  domain: string | null;
  category: string | null;
  subcategory: string | null;
  tier: string | null;
  confidence: number | null;
  interests: Interest[];
  sourceUrl: string | null;
  source: string; // hunt | search
  raw: unknown;
}

export interface RunSummary {
  id: string;
  target: string;
  source: string;
  pagesCrawled: number;
  leadsFound: number;
  leadsNew: number;
  leadsUpdated: number;
  leadsVerified: number;
  leadsInvalid: number;
  errors: string[];
}