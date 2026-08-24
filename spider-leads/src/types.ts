// Shared types for spider-leads (erasable-syntax TS — runs directly under Node 24 type stripping)

export type ExtractMode = "auto" | "local" | "spider";
export type RequestMode = "smart" | "http" | "browser";
export type LeadStatus = "new" | "verified" | "invalid" | "error";
export type EmailType = "corporate" | "business" | "student" | "personal" | "unknown";
/** How a lead's email was obtained. */
export type EmailSource = "page" | "guessed" | "github" | "agent" | "user" | "unknown";

/** Status of an inferred email candidate. */
export type CandidateStatus = "pending" | "valid" | "invalid" | "error";

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
  github?: string;
  /** Twitter/X handle URL (first hit on the page). */
  twitter?: string;
  /** Scheduling/booking link (Calendly, Cal.com…) — "open to a meeting" signal. */
  scheduler?: string;
}

/** A named human at a company — may not have a published email yet. */
export interface Person {
  name: string;
  title?: string;
  /** Publicly listed email (e.g. GitHub profile email). */
  email?: string;
  linkedin?: string;
  github?: string;
  /** Where the person was found: page | github | user */
  source: string;
  sourceUrl?: string;
  /** Extra evidence (page text, bio…), best-effort. */
  notes?: string;
}

/** An inferred (pattern-generated) email address for a person at a domain. */
export interface EmailCandidate {
  email: string;
  personName: string;
  domain: string;
  /** Pattern label, e.g. "first.last", "flast"… */
  pattern: string;
  /** 0-1 heuristic confidence (learned pattern > generic). */
  score: number;
  /** Why this candidate was generated. */
  reason: string;
}

export interface EmployeeEnrichResult {
  domain: string;
  people: number;
  candidatesGenerated: number;
  candidatesVerified: number;
  emailsFound: number;
  invalid: number;
  errors: string[];
  /** The emails this run found (guessed + published), with pattern + score. */
  emails: { email: string; personName: string; pattern: string; score: number }[];
  /**
   * Catch-all probe outcome for the domain: true = the domain accepts ANY
   * address (guessed emails there are unreliable, verification was skipped),
   * false = normal domain, null = unknown (probe failed).
   */
  catchAll?: boolean | null;
}

export interface Categorization {
  category: string;
  subcategory: string;
  tier: string;
  confidence: number;
  reason: string;
  method: "ai" | "rules";
  interests: Interest[];
  /** Company-to-company relationships observed on the site (partners, clients…). */
  relations?: CompanyRelation[];
}

/** A company-to-company relationship found on a page. */
export interface CompanyRelation {
  /** Partner | Client | Supplier | Competitor | Subsidiary | Parent | Investor | Other */
  type: string;
  /** The related company's name (or domain when known). */
  target: string;
  targetDomain?: string;
  /** Page text evidence that supports the relationship. */
  evidence?: string;
  confidence: number;
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
    | { type: "builtin"; id: "fetch_url" | "search_web" | "fetch_jobs" | "fetch_hn_jobs"; params?: Record<string, unknown> };
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
  /** How the email was obtained: published on a page vs pattern-inferred. */
  emailSource: EmailSource;
  /** Pattern label for inferred emails (e.g. "first.last"). */
  emailPattern?: string | null;
  /** Heuristic confidence (0-1) for inferred emails. */
  emailScore?: number | null;
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
  /** Role classification (from the title). */
  department?: string | null;
  seniority?: string | null;
  decisionMaker?: boolean | null;
  /** Composite lead score 0-100 + grade A-D. */
  leadScore?: number | null;
  leadTier?: string | null;
  icpMatch?: boolean | null;
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
  /** Named people discovered (before email guessing). */
  peopleFound: number;
  /** Candidate emails generated + verified. */
  guessesMade: number;
  guessedEmailsFound: number;
  guessedInvalid: number;
  errors: string[];
}