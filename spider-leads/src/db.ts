// Turso DB layer (@libsql/client). Works with Turso (libsql://) or local files (file:).
// Schema: leads (deduped by email) + runs (per hunt/search execution).

import { createClient, type Client } from "@libsql/client";
import type { Config } from "./config.ts";
import type {
  CandidateStatus, EmailCandidate, Lead, LeadStatus, Person, VerificationResult,
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
];

export async function initSchema(db: Client): Promise<void> {
  for (const sql of SCHEMA) await db.execute(sql);
  // Migrate pre-existing databases (new columns added after v0.2)
  await ensureColumn(db, "leads", "email_type", "TEXT");
  await ensureColumn(db, "leads", "interests", "TEXT");
  await ensureColumn(db, "leads", "email_source", "TEXT");
  await ensureColumn(db, "leads", "email_pattern", "TEXT");
  await ensureColumn(db, "leads", "email_score", "REAL");
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
            interests, source_url, source, status, raw_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
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
       interests   = COALESCE(excluded.interests, leads.interests),
       source_url  = COALESCE(excluded.source_url, leads.source_url),
       raw_data    = COALESCE(excluded.raw_data, leads.raw_data),
       updated_at  = excluded.updated_at`,
    args: [
      id, email, lead.personName, lead.title, lead.phone, lead.linkedin, lead.company,
      lead.domain, lead.category, lead.subcategory, lead.tier, lead.confidence,
      lead.emailType, emailSource, lead.emailPattern ?? null, lead.emailScore ?? null,
      interests, lead.sourceUrl, lead.source, raw, new Date().toISOString(),
    ],
  });
  return outcome;
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
  company: string | null;
  domain: string | null;
  category: string | null;
  tier: string | null;
  confidence: number | null;
  email_type: string | null;
  email_source: string | null;
  email_pattern: string | null;
  email_score: number | null;
  interests: string | null;
  source_url: string | null;
  source: string;
  status: string;
  email_valid: number | null;
  verified_at: string | null;
  created_at: string;
}

export async function listLeads(
  db: Client,
  opts: { category?: string; status?: string; emailType?: string; emailSource?: string; interest?: string; limit?: number; offset?: number } = {}
): Promise<LeadRow[]> {
  const where: string[] = [];
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
  if (opts.interest) {
    where.push("interests LIKE ?");
    args.push("%" + opts.interest + "%");
  }
  const sql = `SELECT id, email, person_name, title, phone, company, domain, category, tier,
            confidence, email_type, email_source, email_pattern, email_score, interests, source_url, source, status, email_valid, verified_at, created_at
     FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`;
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
  const bySource = await db.execute(
    `SELECT COALESCE(email_source, 'unknown') AS email_source, COUNT(*) AS n
     FROM leads WHERE email IS NOT NULL GROUP BY email_source ORDER BY n DESC`
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
    topInterests,
    totals: (totals.rows as unknown as any[])[0],
    people: (peopleCount.rows as unknown as { people: number }[])[0]?.people ?? 0,
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