// Turso DB layer (@libsql/client). Works with Turso (libsql://) or local files (file:).
// Schema: leads (deduped by email) + runs (per hunt/search execution).

import { createClient, type Client } from "@libsql/client";
import type { Config } from "./config.ts";
import type {
  CandidateStatus, CompanyRelation, EmailCandidate, Lead, LeadStatus, Person, VerificationResult,
} from "./types.ts";
import { log } from "./log.ts";

export function openDb(cfg: Config): Client {
  const isLocal = cfg.tursoUrl.startsWith("file:");
  if (isLocal) {
    log.warn(`Using LOCAL database file ${cfg.tursoUrl.slice(5)}` +
      " — set TURSO_URL (libsql://…) and TURSO_AUTH_TOKEN in .env to use Turso.");
  }
  return createClient({
    url: cfg.tursoUrl,
    authToken: cfg.tursoAuthToken || undefined,
  });
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    email TEXT,
    person_name TEXT,
    title TEXT,
    phone TEXT,
    linkedin TEXT,
    company TEXT,
    domain TEXT,
    category TEXT,
    subcategory TEXT,
    tier TEXT,
    confidence REAL,
    email_type TEXT,
    email_source TEXT,
    email_pattern TEXT,
    email_score REAL,
    department TEXT,
    seniority TEXT,
    decision_maker INTEGER,
    lead_score REAL,
    lead_tier TEXT,
    icp_match INTEGER,
    interests TEXT,
    source_url TEXT,
    source TEXT NOT NULL DEFAULT 'hunt',
    status TEXT NOT NULL DEFAULT 'new',
    email_valid INTEGER,
    is_disposable INTEGER,
    is_personal_email INTEGER,
    has_mx_records INTEGER,
    is_typo INTEGER,
    plunk_reasons TEXT,
    verified_at TEXT,
    raw_data TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads(email) WHERE email IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category)`,
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    linkedin TEXT,
    github TEXT,
    domain TEXT NOT NULL,
    company TEXT,
    source TEXT NOT NULL DEFAULT 'page',
    source_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT,
    UNIQUE(domain, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_people_domain ON people(domain)`,
  `CREATE TABLE IF NOT EXISTS email_candidates (
    email TEXT PRIMARY KEY,
    person_name TEXT,
    domain TEXT NOT NULL,
    pattern TEXT,
    score REAL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    source_url TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_domain ON email_candidates(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_status ON email_candidates(status)`,
  `CREATE TABLE IF NOT EXISTS company_relations (
    id TEXT PRIMARY KEY,
    from_domain TEXT NOT NULL,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    target_domain TEXT,
    evidence TEXT,
    confidence REAL,
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(from_domain, target, type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_relations_from ON company_relations(from_domain)`,
  `CREATE INDEX IF NOT EXISTS idx_relations_to ON company_relations(target_domain)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    pages_crawled INTEGER DEFAULT 0,
    leads_found INTEGER DEFAULT 0,
    leads_verified INTEGER DEFAULT 0,
    leads_invalid INTEGER DEFAULT 0,
    errors TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS domain_meta (
    domain TEXT PRIMARY KEY,
    is_catchall INTEGER,
    catchall_checked_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  )`,
];

export async function initSchema(db: Client): Promise<void> {
  for (const sql of SCHEMA) await db.execute(sql);
  // Migrate pre-existing databases (new columns added after v0.2)
  await ensureColumn(db, "leads", "email_type", "TEXT");
  await ensureColumn(db, "leads", "interests", "TEXT");
  await ensureColumn(db, "leads", "email_source", "TEXT");
  await ensureColumn(db, "leads", "email_pattern", "TEXT");
  await ensureColumn(db, "leads", "email_score", "REAL");
  await ensureColumn(db, "leads", "department", "TEXT");
  await ensureColumn(db, "leads", "seniority", "TEXT");
  await ensureColumn(db, "leads", "decision_maker", "INTEGER");
  await ensureColumn(db, "leads", "lead_score", "REAL");
  await ensureColumn(db, "leads", "lead_tier", "TEXT");
  await ensureColumn(db, "leads", "icp_match", "INTEGER");
}

async function ensureColumn(db: Client, table: string, column: string, decl: string): Promise<void> {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  } catch {
    // column already exists — fine
  }
}

function boolInt(b: boolean): number {
  return b ? 1 : 0;
}

/**
 * Upsert a lead. Returns "new" if inserted, "updated" if it already existed.
 * Emails are normalized (lowercase) so dedup works reliably.
 */
export async function upsertLead(db: Client, lead: Lead): Promise<"new" | "updated"> {
  const email = lead.email?.toLowerCase() ?? null;
  const exists = email
    ? await db.execute({ sql: "SELECT 1 FROM leads WHERE email = ?", args: [email] })
    : { rows: [] };
  const outcome: "new" | "updated" = exists.rows.length > 0 ? "updated" : "new";

  const id = crypto.randomUUID();
  const raw = JSON.stringify(lead.raw ?? null);
  const interests = JSON.stringify(lead.interests ?? []);
  const emailSource = lead.emailSource ?? "unknown";
  await db.execute({
    sql: `INSERT INTO leads (id, email, person_name, title, phone, linkedin, company, domain,
            category, subcategory, tier, confidence, email_type, email_source, email_pattern, email_score,
            department, seniority, decision_maker, lead_score, lead_tier, icp_match,
            interests, source_url, source, status, raw_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
     ON CONFLICT DO UPDATE SET
       person_name = COALESCE(excluded.person_name, leads.person_name),
       title       = COALESCE(excluded.title, leads.title),
       phone       = COALESCE(excluded.phone, leads.phone),
       linkedin    = COALESCE(excluded.linkedin, leads.linkedin),
       company     = COALESCE(excluded.company, leads.company),
       domain      = COALESCE(excluded.domain, leads.domain),
       category    = COALESCE(excluded.category, leads.category),
       subcategory = COALESCE(excluded.subcategory, leads.subcategory),
       tier        = COALESCE(excluded.tier, leads.tier),
       confidence  = COALESCE(excluded.confidence, leads.confidence),
       email_type  = COALESCE(excluded.email_type, leads.email_type),
       email_source = CASE
                        -- Keep the more authoritative source: page > github > agent > guessed
                        WHEN excluded.email_source = 'page' THEN 'page'
                        WHEN leads.email_source = 'page' THEN 'page'
                        WHEN excluded.email_source = 'github' THEN 'github'
                        WHEN leads.email_source = 'github' THEN 'github'
                        WHEN excluded.email_source = 'agent' THEN 'agent'
                        WHEN leads.email_source = 'agent' THEN 'agent'
                        ELSE COALESCE(excluded.email_source, leads.email_source)
                      END,
       email_pattern = COALESCE(excluded.email_pattern, leads.email_pattern),
       email_score   = COALESCE(excluded.email_score, leads.email_score),
       department    = COALESCE(excluded.department, leads.department),
       seniority     = COALESCE(excluded.seniority, leads.seniority),
       decision_maker = COALESCE(excluded.decision_maker, leads.decision_maker),
       lead_score    = COALESCE(excluded.lead_score, leads.lead_score),
       lead_tier     = COALESCE(excluded.lead_tier, leads.lead_tier),
       icp_match     = COALESCE(excluded.icp_match, leads.icp_match),
       interests   = COALESCE(excluded.interests, leads.interests),
       source_url  = COALESCE(excluded.source_url, leads.source_url),
       raw_data    = COALESCE(excluded.raw_data, leads.raw_data),
       updated_at  = excluded.updated_at`,
    args: [
      id, email, lead.personName, lead.title, lead.phone, lead.linkedin, lead.company,
      lead.domain, lead.category, lead.subcategory, lead.tier, lead.confidence,
      lead.emailType, emailSource, lead.emailPattern ?? null, lead.emailScore ?? null,
      lead.department ?? null, lead.seniority ?? null, lead.decisionMaker == null ? null : (lead.decisionMaker ? 1 : 0),
      lead.leadScore ?? null, lead.leadTier ?? null, lead.icpMatch == null ? null : (lead.icpMatch ? 1 : 0),
      interests, lead.sourceUrl, lead.source, raw, new Date().toISOString(),
    ],
  });
  return outcome;
}

/** Recompute/persist a lead's score + role classification in place. */
export async function updateLeadScore(
  db: Client,
  email: string,
  fields: { department: string; seniority: string; decisionMaker: boolean; leadScore: number; leadTier: string; icpMatch: boolean | null }
): Promise<void> {
  await db.execute({
    sql: `UPDATE leads SET department = ?, seniority = ?, decision_maker = ?, lead_score = ?,
          lead_tier = ?, icp_match = ?, updated_at = ? WHERE email = ?`,
    args: [
      fields.department, fields.seniority, fields.decisionMaker ? 1 : 0,
      fields.leadScore, fields.leadTier, fields.icpMatch == null ? null : (fields.icpMatch ? 1 : 0),
      new Date().toISOString(), email.toLowerCase(),
    ],
  });
}

/** Record the outcome of a Plunk verification. */
export async function recordVerification(
  db: Client,
  email: string,
  res: VerificationResult,
  error?: Error
): Promise<void> {
  const status: LeadStatus = error ? "error" : res.valid ? "verified" : "invalid";
  await db.execute({
    sql: `UPDATE leads SET status = ?, email_valid = ?, is_disposable = ?, is_personal_email = ?,
          has_mx_records = ?, is_typo = ?, plunk_reasons = ?, verified_at = ?, updated_at = ?
     WHERE email = ?`,
    args: [
      status,
      error ? null : boolInt(res.valid),
      error ? null : boolInt(res.isDisposable),
      error ? null : boolInt(res.isPersonalEmail),
      error ? null : boolInt(res.hasMxRecords),
      error ? null : boolInt(res.isTypo),
      error ? JSON.stringify({ error: error.message }) : JSON.stringify(res.reasons),
      new Date().toISOString(),
      new Date().toISOString(),
      email.toLowerCase(),
    ],
  });
}

export interface LeadRow {
  id: string;
  email: string | null;
  person_name: string | null;
  title: string | null;
  phone: string | null;
  linkedin: string | null;
  company: string | null;
  domain: string | null;
  category: string | null;
  subcategory: string | null;
  tier: string | null;
  confidence: number | null;
  email_type: string | null;
  email_source: string | null;
  email_pattern: string | null;
  email_score: number | null;
  department: string | null;
  seniority: string | null;
  decision_maker: number | null;
  lead_score: number | null;
  lead_tier: string | null;
  icp_match: number | null;
  interests: string | null;
  source_url: string | null;
  source: string;
  status: string;
  email_valid: number | null;
  /** Plunk deliverability signals — feed the rescore path. */
  is_disposable: number | null;
  has_mx_records: number | null;
  is_personal_email: number | null;
  verified_at: string | null;
  created_at: string;
}

export async function listLeads(
  db: Client,
  opts: {
    category?: string; status?: string; emailType?: string; emailSource?: string; interest?: string;
    department?: string; tier?: string; minScore?: number; decisionMaker?: boolean; limit?: number; offset?: number;
  } = {}
): Promise<LeadRow[]> {  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.category) {
    where.push("category = ?");
    args.push(opts.category);
  }
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts.emailType) {
    where.push("email_type = ?");
    args.push(opts.emailType);
  }
  if (opts.emailSource) {
    where.push("email_source = ?");
    args.push(opts.emailSource);
  }
  if (opts.department) {
    where.push("department = ?");
    args.push(opts.department);
  }
  if (opts.tier) {
    where.push("lead_tier = ?");
    args.push(opts.tier);
  }
  if (opts.minScore) {
    where.push("lead_score >= ?");
    args.push(opts.minScore);
  }
  if (opts.decisionMaker === true) {
    where.push("decision_maker = 1");
  }
  if (opts.interest) {
    where.push("interests LIKE ?");
    args.push("%" + opts.interest + "%");
  }
  const sql = `SELECT id, email, person_name, title, phone, linkedin, company, domain, category, subcategory, tier,
            confidence, email_type, email_source, email_pattern, email_score,
            department, seniority, decision_maker, lead_score, lead_tier, icp_match,
            interests, source_url, source, status, email_valid, is_disposable, has_mx_records,
            is_personal_email, verified_at, created_at
     FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY lead_score DESC, created_at DESC LIMIT ? OFFSET ?`;
  args.push(opts.limit ?? 50, opts.offset ?? 0);
  const res = await db.execute({ sql, args });
  return res.rows as unknown as LeadRow[];
}

export async function unverifiedEmails(db: Client, opts: { limit?: number; status?: string } = {}): Promise<string[]> {
  const status = opts.status ?? "new";
  const res = await db.execute({
    sql: `SELECT email FROM leads WHERE email IS NOT NULL AND status = ? AND email_valid IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    args: [status, opts.limit ?? 1000],
  });
  return (res.rows as unknown as { email: string }[]).map((r) => r.email);
}

/** One lead row by email (used to re-score a lead right after verification). */
export async function leadRowByEmail(db: Client, email: string): Promise<LeadRow | null> {
  const res = await db.execute({
    sql: `SELECT id, email, person_name, title, phone, linkedin, company, domain, category, subcategory, tier,
            confidence, email_type, email_source, email_pattern, email_score,
            department, seniority, decision_maker, lead_score, lead_tier, icp_match,
            interests, source_url, source, status, email_valid, is_disposable, has_mx_records,
            is_personal_email, verified_at, created_at
     FROM leads WHERE email = ? LIMIT 1`,
    args: [email.toLowerCase()],
  });
  return (res.rows as unknown as LeadRow[])[0] ?? null;
}

// ---------------------------------------------------------------------------
// People (named individuals, possibly without emails) — employee discovery
// ---------------------------------------------------------------------------

export interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  github: string | null;
  domain: string;
  company: string | null;
  source: string;
  source_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Upsert a named person (deduped by domain + case-insensitive name). Returns "new" or "updated". */
export async function upsertPerson(db: Client, domain: string, person: Person, company?: string): Promise<"new" | "updated"> {
  const name = (person.name ?? "").trim();
  if (!name) return "updated";
  // Dedup is case-insensitive, so look up first and update in place (the unique
  // index on (domain, name) is case-sensitive and must not be relied on alone).
  const exists = await db.execute({
    sql: "SELECT id FROM people WHERE domain = ? AND lower(name) = lower(?) LIMIT 1",
    args: [domain, name],
  });
  const email = person.email?.toLowerCase().trim() ?? null;
  const title = person.title?.trim() ?? null;
  const linkedin = person.linkedin?.trim() ?? null;
  const github = person.github?.trim() ?? null;
  const sourceUrl = person.sourceUrl ?? null;
  const notes = person.notes ?? null;
  const now = new Date().toISOString();
  if (exists.rows.length > 0) {
    await db.execute({
      sql: `UPDATE people SET
        title      = COALESCE(?, title),
        email      = COALESCE(?, email),
        linkedin   = COALESCE(?, linkedin),
        github     = COALESCE(?, github),
        company    = COALESCE(?, company),
        source     = CASE WHEN ? = 'github' AND source = 'page' THEN source ELSE ? END,
        source_url = COALESCE(?, source_url),
        notes      = COALESCE(?, notes),
        updated_at = ?
       WHERE id = ?`,
      args: [
        title, email, linkedin, github, company ?? null,
        person.source ?? "page", person.source ?? "page",
        sourceUrl, notes, now, String(exists.rows[0].id),
      ],
    });
    return "updated";
  }
  await db.execute({
    sql: `INSERT INTO people (id, name, title, email, linkedin, github, domain, company, source, source_url, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(), name, title, email, linkedin, github,
      domain, company ?? null, person.source ?? "page", sourceUrl, notes, now,
    ],
  });
  return "new";
}

/** All stored people for a domain, optionally only those without an email. */
export async function peopleForDomain(db: Client, domain: string, opts: { noEmail?: boolean } = {}): Promise<PersonRow[]> {
  const res = await db.execute({
    sql: `SELECT * FROM people WHERE domain = ? ${opts.noEmail ? "AND (email IS NULL OR email = '')" : ""}
     ORDER BY created_at DESC LIMIT 1000`,
    args: [domain],
  });
  return res.rows as unknown as PersonRow[];
}

/** Known emails + names at a domain (used to learn the address convention). */
export async function knownEmailsForDomain(db: Client, domain: string): Promise<{ email: string; name: string }[]> {
  const res = await db.execute({
    sql: `SELECT email, person_name FROM leads
     WHERE domain = ? AND email IS NOT NULL AND person_name IS NOT NULL
       AND person_name != '' AND email_valid = 1 LIMIT 500`,
    args: [domain],
  });
  return (res.rows as unknown as { email: string; person_name: string }[])
    .map((r) => ({ email: r.email, name: r.person_name }));
}

/** Bulk-add personas from an enrichment run (new people only; used for stats). */
export async function listPeople(
  db: Client,
  opts: { domain?: string; noEmail?: boolean; limit?: number; offset?: number } = {}
): Promise<PersonRow[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.domain) { where.push("domain = ?"); args.push(opts.domain); }
  if (opts.noEmail) { where.push("(email IS NULL OR email = '')"); }
  const sql = `SELECT * FROM people ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  args.push(opts.limit ?? 100, opts.offset ?? 0);
  const res = await db.execute({ sql, args });
  return res.rows as unknown as PersonRow[];
}

// ---------------------------------------------------------------------------
// Email candidates (pattern-inferred addresses, with their verification status)
// ---------------------------------------------------------------------------

export interface CandidateRow {
  email: string;
  person_name: string | null;
  domain: string;
  pattern: string | null;
  score: number | null;
  reason: string | null;
  status: CandidateStatus;
  source_url: string | null;
  detail: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Persist an inferred candidate (upsert by email). */
export async function upsertCandidate(db: Client, c: EmailCandidate): Promise<void> {
  await db.execute({
    sql: `INSERT INTO email_candidates (email, person_name, domain, pattern, score, reason, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       person_name = COALESCE(excluded.person_name, email_candidates.person_name),
       domain      = COALESCE(excluded.domain, email_candidates.domain),
       pattern     = COALESCE(excluded.pattern, email_candidates.pattern),
       score       = COALESCE(excluded.score, email_candidates.score),
       reason      = COALESCE(excluded.reason, email_candidates.reason),
       source_url  = COALESCE(excluded.source_url, email_candidates.source_url),
       updated_at  = excluded.updated_at`,
    args: [
      c.email.toLowerCase(), c.personName, c.domain, c.pattern, c.score, c.reason,
      null, new Date().toISOString(), new Date().toISOString(),
    ],
  });
}

/** Mark a candidate verified-invalid / error after a verification attempt. */
export async function markCandidate(
  db: Client,
  email: string,
  status: CandidateStatus,
  detail?: string
): Promise<void> {
  await db.execute({
    sql: `UPDATE email_candidates SET status = ?, detail = ?, updated_at = ? WHERE email = ?`,
    args: [status, detail ?? null, new Date().toISOString(), email.toLowerCase()],
  });
}

/** Candidates for a domain, optionally limited to a status (pending by default). */
export async function candidatesForDomain(
  db: Client,
  domain: string,
  opts: { status?: CandidateStatus | "all"; limit?: number } = {}
): Promise<CandidateRow[]> {
  const status = opts.status ?? "all";
  const res = await db.execute({
    sql: `SELECT * FROM email_candidates WHERE domain = ? ${status !== "all" ? "AND status = ?" : ""}
     ORDER BY score DESC LIMIT ?`,
    args: status !== "all" ? [domain, status, opts.limit ?? 500] : [domain, opts.limit ?? 500],
  });
  return res.rows as unknown as CandidateRow[];
}

// ---------------------------------------------------------------------------
// Company relationships (partners/clients/competitors observed on pages)
// ---------------------------------------------------------------------------

export interface RelationRow {
  id: string;
  from_domain: string;
  type: string;
  target: string;
  target_domain: string | null;
  evidence: string | null;
  confidence: number | null;
  source_url: string | null;
  created_at: string;
}

/** Persist one company relationship (deduped by from+target+type). */
export async function upsertRelation(
  db: Client,
  fromDomain: string,
  relation: CompanyRelation,
  sourceUrl?: string | null
): Promise<void> {
  const target = (relation.target ?? "").trim();
  if (!target) return;
  const existing = await db.execute({
    sql: "SELECT id FROM company_relations WHERE from_domain = ? AND lower(target) = lower(?) AND type = ?",
    args: [fromDomain, target, relation.type],
  });
  const confidence = relation.confidence ?? 0.5;
  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE company_relations SET target_domain = COALESCE(?, target_domain),
            evidence = COALESCE(?, evidence), confidence = MAX(confidence, ?),
            source_url = COALESCE(?, source_url) WHERE id = ?`,
      args: [relation.targetDomain ?? null, relation.evidence ?? null, confidence,
        sourceUrl ?? null, String(existing.rows[0].id)],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO company_relations (id, from_domain, type, target, target_domain, evidence, confidence, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), fromDomain, relation.type, target, relation.targetDomain ?? null,
      relation.evidence ?? null, confidence, sourceUrl ?? null],
  });
}

/** Relationships observed at a domain (outgoing). */
export async function relationsForDomain(db: Client, domain: string, opts: { limit?: number } = {}): Promise<RelationRow[]> {
  const res = await db.execute({
    sql: "SELECT * FROM company_relations WHERE from_domain = ? ORDER BY confidence DESC LIMIT ?",
    args: [domain, opts.limit ?? 200],
  });
  return res.rows as unknown as RelationRow[];
}

/** Domains related to a target domain (either direction), excluding itself. */
export async function relatedDomainsFor(db: Client, domain: string, opts: { limit?: number } = {}): Promise<{ domain: string; type: string }[]> {
  const res = await db.execute({
    sql: `SELECT target_domain AS domain, type FROM company_relations
           WHERE from_domain = ? AND target_domain IS NOT NULL AND target_domain != ?
          UNION
          SELECT from_domain AS domain, type FROM company_relations
           WHERE target_domain = ? AND from_domain != ?
          ORDER BY 1 LIMIT ?`,
    args: [domain, domain, domain, domain, opts.limit ?? 200],
  });
  return res.rows as unknown as { domain: string; type: string }[];
}

/** Leads at companies that are related to the given domain (partners/clients…). */
export async function leadsRelatedTo(
  db: Client,
  domain: string,
  opts: { limit?: number; minScore?: number } = {}
): Promise<LeadRow[]> {
  const rel = await relatedDomainsFor(db, domain, { limit: 500 });
  if (rel.length === 0) return [];
  const domains = [...new Set(rel.map((r) => r.domain))];
  const placeholders = domains.map(() => "?").join(",");
  const args: (string | number)[] = [...domains];
  let scoreFilter = "";
  if (opts.minScore) {
    scoreFilter = " AND lead_score >= ?";
    args.push(opts.minScore);
  }
  const res = await db.execute({
    sql: `SELECT id, email, person_name, title, phone, company, domain, category, tier,
            confidence, email_type, email_source, email_pattern, email_score, interests, source_url, source, status,
            email_valid, verified_at, created_at, department, seniority, decision_maker, lead_score, lead_tier, icp_match
     FROM leads WHERE domain IN (${placeholders})${scoreFilter}
     ORDER BY lead_score DESC, created_at DESC LIMIT ${Number(opts.limit ?? 100)}`,
    args,
  });
  return res.rows as unknown as LeadRow[];
}

export async function dbStats(db: Client): Promise<any> {
  const byStatus = await db.execute(
    `SELECT status, COUNT(*) AS n FROM leads GROUP BY status ORDER BY n DESC`
  );
  const byCategory = await db.execute(
    `SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*) AS n FROM leads GROUP BY category ORDER BY n DESC`
  );
  const byEmailType = await db.execute(
    `SELECT COALESCE(email_type, 'unknown') AS email_type, COUNT(*) AS n FROM leads GROUP BY email_type ORDER BY n DESC`
  );
  const totals = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN email_valid = 1 THEN 1 ELSE 0 END) AS valid,
            SUM(CASE WHEN email_valid = 0 THEN 1 ELSE 0 END) AS invalid,
            SUM(CASE WHEN email_valid IS NULL AND email IS NOT NULL THEN 1 ELSE 0 END) AS unverified
     FROM leads`
  );
  const peopleCount = await db.execute(`SELECT COUNT(*) AS people FROM people`);
  const catchAllRow = await db.execute(
    `SELECT COUNT(*) AS catch_all, SUM(CASE WHEN is_catchall = 0 THEN 1 ELSE 0 END) AS verified_clear
     FROM domain_meta WHERE is_catchall IS NOT NULL`
  );
  const bySource = await db.execute(
    `SELECT COALESCE(email_source, 'unknown') AS email_source, COUNT(*) AS n
     FROM leads WHERE email IS NOT NULL GROUP BY email_source ORDER BY n DESC`
  );
  const byGrade = await db.execute(
    `SELECT COALESCE(lead_tier, 'none') AS lead_tier, COUNT(*) AS n FROM leads GROUP BY lead_tier ORDER BY n DESC`
  );
  const interestRows = await db.execute(
    `SELECT interests FROM leads WHERE interests IS NOT NULL AND interests != '[]' LIMIT 5000`
  );
  const interestCounts = new Map<string, number>();
  for (const row of interestRows.rows as unknown as { interests: string }[]) {
    try {
      const list = JSON.parse(row.interests);
      for (const i of list) {
        if (i && i.topic) interestCounts.set(i.topic, (interestCounts.get(i.topic) ?? 0) + 1);
      }
    } catch { /* skip malformed */ }
  }
  const topInterests = [...interestCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([topic, n]) => ({ topic, n }));
  return {
    byStatus: byStatus.rows as unknown as { status: string; n: number }[],
    byCategory: byCategory.rows as unknown as { category: string; n: number }[],
    byEmailType: byEmailType.rows as unknown as { email_type: string; n: number }[],
    bySource: bySource.rows as unknown as { email_source: string; n: number }[],
    byGrade: byGrade.rows as unknown as { lead_tier: string; n: number }[],
    topInterests,
    totals: (totals.rows as unknown as any[])[0],
    people: (peopleCount.rows as unknown as { people: number }[])[0]?.people ?? 0,
    /** Domains probed for catch-all behavior: (catchAll, clear) split. */
    domainsProbed: (catchAllRow.rows as unknown as { catch_all: number; verified_clear: number }[])[0] ?? null,
  };
}

export async function recordRun(
  db: Client,
  run: { id: string; target: string; source: string; startedAt: string; finishedAt: string; pagesCrawled: number; leadsFound: number; verified: number; invalid: number; errors: string[] }
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO runs (id, target, source, started_at, finished_at, pages_crawled, leads_found, leads_verified, leads_invalid, errors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id, run.target, run.source, run.startedAt, run.finishedAt,
      run.pagesCrawled, run.leadsFound, run.verified, run.invalid,
      run.errors.length ? JSON.stringify(run.errors) : null,
    ],
  });
}

// ---------------------------------------------------------------------------
// Domain metadata — catch-all detection results, persisted so we probe once
// per domain instead of on every enrichment run.
// ---------------------------------------------------------------------------

export interface DomainMetaRow {
  domain: string;
  is_catchall: number | null;
  catchall_checked_at: string | null;
  notes: string | null;
}

/** Cached domain flags (is_catchall …). */
export async function getDomainMeta(db: Client, domain: string): Promise<DomainMetaRow | null> {
  try {
    const res = await db.execute({
      sql: "SELECT domain, is_catchall, catchall_checked_at, notes FROM domain_meta WHERE domain = ?",
      args: [domain],
    });
    return (res.rows as unknown as DomainMetaRow[])[0] ?? null;
  } catch {
    return null;
  }
}

/** Persist a catch-all probe result for a domain. */
export async function setDomainCatchAll(
  db: Client,
  domain: string,
  isCatchAll: boolean,
  notes?: string
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO domain_meta (domain, is_catchall, catchall_checked_at, notes, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       is_catchall = excluded.is_catchall,
       catchall_checked_at = excluded.catchall_checked_at,
       notes = COALESCE(excluded.notes, domain_meta.notes),
       updated_at = excluded.updated_at`,
    args: [domain, isCatchAll ? 1 : 0, now, notes ?? null, now],
  });
}