// Turso DB layer (@libsql/client). Works with Turso (libsql://) or local files (file:).
// Schema: leads (deduped by email) + runs (per hunt/search execution).

import { createClient, type Client } from "@libsql/client";
import type { Config } from "./config.ts";
import type { Lead, LeadStatus, VerificationResult } from "./types.ts";
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
  await db.execute({
    sql: `INSERT INTO leads (id, email, person_name, title, phone, linkedin, company, domain,
            category, subcategory, tier, confidence, email_type, interests,
            source_url, source, status, raw_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
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
       interests   = COALESCE(excluded.interests, leads.interests),
       source_url  = COALESCE(excluded.source_url, leads.source_url),
       raw_data    = COALESCE(excluded.raw_data, leads.raw_data),
       updated_at  = excluded.updated_at`,
    args: [
      id, email, lead.personName, lead.title, lead.phone, lead.linkedin, lead.company,
      lead.domain, lead.category, lead.subcategory, lead.tier, lead.confidence,
      lead.emailType, interests, lead.sourceUrl, lead.source, raw, new Date().toISOString(),
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
  opts: { category?: string; status?: string; emailType?: string; interest?: string; limit?: number; offset?: number } = {}
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
  if (opts.interest) {
    where.push("interests LIKE ?");
    args.push("%" + opts.interest + "%");
  }
  const sql = `SELECT id, email, person_name, title, phone, company, domain, category, tier,
            confidence, email_type, interests, source_url, source, status, email_valid, verified_at, created_at
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
    topInterests,
    totals: (totals.rows as unknown as any[])[0],
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