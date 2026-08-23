// Employee email enrichment: take named people (from pages, GitHub, or the DB),
// infer candidate addresses using the domain's learned pattern, verify them with
// Plunk, and store the valid ones as leads (email_source = 'guessed').
// Browser-safe (no node imports).

import type { Client } from "@libsql/client";
import type { Config } from "./config.ts";
import type { Categorization, EmailCandidate, EmployeeEnrichResult, Person } from "./types.ts";
import { candidatesForPerson, learnPatterns } from "./guess.ts";
import { findGithubPeople } from "./github.ts";
import { classifyEmailType, isValidEmail } from "./extract.ts";
import {
  candidatesForDomain, knownEmailsForDomain, markCandidate, peopleForDomain, recordVerification,
  upsertCandidate, upsertLead, upsertPerson,
} from "./db.ts";
import { verifyBatch, verifyEmail } from "./plunk.ts";
import { log } from "./log.ts";

export interface EnrichOptions {
  /** Extra persons discovered during this run (they are upserted first). */
  people?: Person[];
  /** Verify candidates with Plunk (requires PLUNK_API_KEY). */
  verify?: boolean;
  /** Max candidates to try per person (default 3). */
  perPerson?: number;
  concurrency?: number;
  /** GitHub org names to pull public members from. */
  githubOrgs?: string[];
  githubToken?: string;
  githubApiBase?: string;
  dryRun?: boolean;
  /** Company metadata copied onto newly found emails (category etc.). */
  meta?: Partial<Categorization> & { company?: string };
  onProgress?: (msg: string) => void;
}

const progress = (opts: EnrichOptions, msg: string): void => {
  if (opts.onProgress) opts.onProgress(msg);
  else log.info(msg);
};

/** Merge a batch of freshly discovered persons into the people table. */
export async function storePersons(
  db: Client,
  domain: string,
  persons: Person[],
  company?: string
): Promise<{ newPeople: number }> {
  let newPeople = 0;
  for (const p of persons) {
    const outcome = await upsertPerson(db, domain, p, company);
    if (outcome === "new") newPeople++;
  }
  return { newPeople };
}

/** Persons with a publicly listed email (e.g. GitHub profile) — store directly. */
function publicEmailPersons(persons: Person[]): Person[] {
  return persons.filter((p) => p.email && isValidEmail(p.email));
}

/**
 * Run employee email discovery + inference for one domain:
 *   1. load stored people (+ any freshly discovered), merge with GitHub members
 *   2. learn the domain's address convention from known valid emails
 *   3. generate candidate addresses per person (bounded), persist them
 *   4. verify with Plunk; valid ones become leads (email_source 'guessed'),
 *      invalid ones are recorded so we never re-guess the same address
 */
export async function enrichDomain(
  db: Client,
  cfg: Config,
  domain: string,
  opts: EnrichOptions = {}
): Promise<EmployeeEnrichResult> {
  const result: EmployeeEnrichResult = {
    domain,
    people: 0,
    candidatesGenerated: 0,
    candidatesVerified: 0,
    emailsFound: 0,
    invalid: 0,
    errors: [],
    emails: [],
  };
  const perPerson = Math.max(1, opts.perPerson ?? 3);
  const verify = opts.verify !== false && !!cfg.plunkApiKey;

  // Fill in metadata (company/category/interests) from an existing lead at this
  // domain when the caller didn't provide it — guessed emails then match the
  // company's categorization instead of arriving empty.
  const meta = { ...(opts.meta ?? {}) };
  if (!meta.company || !meta.category) {
    const existing = await firstLeadForDomain(db, domain);
    if (existing) {
      meta.company = meta.company ?? existing.company ?? domain;
      meta.category = meta.category ?? existing.category ?? undefined;
      meta.subcategory = meta.subcategory ?? existing.subcategory ?? undefined;
      meta.tier = meta.tier ?? existing.tier ?? undefined;
      meta.confidence = meta.confidence ?? existing.confidence ?? undefined;
      if (!meta.interests || meta.interests.length === 0) {
        try {
          const parsed = JSON.parse(existing.interests ?? "[]");
          if (Array.isArray(parsed) && parsed.length > 0) meta.interests = parsed;
        } catch { /* ignore malformed */ }
      }
    }
  }
  meta.company = meta.company ?? domain;

  // 1) People: stored + freshly discovered + GitHub members
  const stored = await peopleForDomain(db, domain, { noEmail: true });
  const fresh = (opts.people ?? []).filter((p) => !p.email || !isValidEmail(p.email));
  if ((opts.people ?? []).length > 0 && !opts.dryRun) {
    const { newPeople } = await storePersons(db, domain, opts.people!, meta.company ?? domain);
    result.people += newPeople;
  }

  // GitHub public members (opt-in; free public API).
  let githubPeople: Person[] = [];
  for (const org of opts.githubOrgs ?? []) {
    try {
      progress(opts, "GitHub: fetching public members of " + org);
      const members = await findGithubPeople(org, {
        token: opts.githubToken,
        base: opts.githubApiBase ?? cfg.githubApiBase,
      });
      githubPeople = githubPeople.concat(members);
    } catch (err) {
      result.errors.push("github " + org + ": " + (err as Error).message);
      log.warn("GitHub " + org + ": " + (err as Error).message);
    }
  }
  if (githubPeople.length > 0 && !opts.dryRun) {
    const { newPeople } = await storePersons(db, domain, githubPeople, meta.company ?? domain);
    result.people += newPeople;
    // GitHub people with public emails are real addresses — verify, then store.
    for (const p of publicEmailPersons(githubPeople)) {
      await storePublicEmail(db, cfg, domain, p, opts, result, meta);
    }
  }

  // Merge into the guessing pool: stored people + fresh + GitHub (dedupe by name).
  const pool = dedupePersons([
    ...stored.map((r) => ({
      name: r.name,
      title: r.title ?? undefined,
      linkedin: r.linkedin ?? undefined,
      github: r.github ?? undefined,
      source: r.source,
      sourceUrl: r.source_url ?? undefined,
    })),
    ...fresh,
    ...githubPeople.filter((p) => !p.email),
  ]);
  result.people = Math.max(result.people, pool.length);

  const noEmail = pool.filter((p) => !p.email || !isValidEmail(p.email));
  if (noEmail.length === 0) {
    progress(opts, domain + ": no people without emails — nothing to guess.");
    return result;
  }

  // 2) Learn the domain's convention from known valid emails.
  const known = await knownEmailsForDomain(db, domain);
  const learned = learnPatterns(known);
  if (learned.total > 0) {
    const top = Object.entries(learned.counts).sort((a, b) => b[1] - a[1])[0];
    progress(opts, domain + ": learned pattern '" + top[0] + "' from " + learned.total + " known email(s)");
  }

  // 3) Generate candidates (bounded per person), skipping already-known outcomes.
  const existingEmails = new Set(await emailsForDomain(db, domain));
  const invalidEmails = new Set(
    (await candidatesForDomain(db, domain, { status: "invalid", limit: 5000 })).map((c) => c.email)
  );
  const candidates: EmailCandidate[] = [];
  const planned = new Set<string>();
  for (const person of noEmail) {
    const list = candidatesForPerson(person, domain, learned).slice(0, perPerson);
    for (const c of list) {
      if (planned.has(c.email) || existingEmails.has(c.email) || invalidEmails.has(c.email)) continue;
      planned.add(c.email);
      candidates.push(c);
    }
  }
  result.candidatesGenerated = candidates.length;
  progress(opts, domain + ": " + noEmail.length + " person(s) → " + candidates.length + " candidate email(s)");

  if (candidates.length === 0) return result;
  if (!verify) {
    // Persist candidates as pending so the user can verify them later.
    let persisted = 0;
    for (const c of candidates) {
      if (!opts.dryRun) {
        await upsertCandidate(db, c);
        persisted++;
      }
    }
    if (persisted > 0) {
      log.warn("Verification skipped (no PLUNK_API_KEY or verify disabled) — candidates saved as pending.");
    }
    return result;
  }
  if (opts.dryRun) return result;

  // 4) Verify — one Plunk call per candidate, bounded concurrency.
  progress(opts, "Verifying " + candidates.length + " candidate email(s) with Plunk…");
  const byEmail = new Map(candidates.map((c) => [c.email, c]));
  await verifyBatch(cfg, candidates.map((c) => c.email), {
    concurrency: opts.concurrency ?? 5,
    onResult: async (email, res, err) => {
      result.candidatesVerified++;
      const candidate = byEmail.get(email);
      if (!candidate) return;
      if (err) {
        result.errors.push(email + ": " + err.message);
        await upsertCandidate(db, candidate);
        await markCandidate(db, email, "error", err.message);
        return;
      }
      if (res.valid) {
        if (!opts.dryRun) {
          await upsertCandidate(db, candidate);
          await markCandidate(db, email, "valid", "Plunk verified");
          await upsertLead(db, {
            email,
            emailType: classifyEmailType(email),
            emailSource: "guessed",
            emailPattern: candidate.pattern,
            emailScore: candidate.score,
            personName: candidate.personName,
            title: null,
            phone: null,
            linkedin: null,
            company: meta.company ?? domain,
            domain,
            category: meta.category ?? null,
            subcategory: meta.subcategory ?? null,
            tier: meta.tier ?? null,
            confidence: meta.confidence ?? candidate.score,
            interests: meta.interests ?? [],
            sourceUrl: null,
            source: "guess",
            raw: { guess: true, candidate },
          });
          await recordVerification(db, email, res);
          result.emails.push({
            email,
            personName: candidate.personName,
            pattern: candidate.pattern,
            score: candidate.score,
          });
          log.ok("  ✓ guessed " + email + " (" + candidate.pattern + ", " + candidate.score + ")");
          result.emailsFound++;
        }
      } else {
        await upsertCandidate(db, candidate);
        await markCandidate(db, email, "invalid", (res.reasons ?? []).join("; "));
        result.invalid++;
        log.debug("  ✗ " + email + " invalid");
      }
    },
  });
  return result;
}

async function storePublicEmail(
  db: Client,
  cfg: Config,
  domain: string,
  person: Person,
  opts: EnrichOptions,
  result: EmployeeEnrichResult,
  meta: Partial<Categorization> & { company?: string }
): Promise<void> {
  const email = person.email!.toLowerCase().trim();
  if (!isValidEmail(email)) return;

  // Verify before storing when verification is enabled: only real addresses
  // become leads. Without a key we store them unverified (status 'new').
  if (opts.verify !== false && cfg.plunkApiKey) {
    try {
      const res = await verifyEmail(cfg, email);
      if (!res.valid) {
        result.invalid++;
        log.debug("  ✗ github " + email + " invalid — not stored");
        return;
      }
      await upsertLead(db, {
        email,
        emailType: classifyEmailType(email),
        emailSource: "github",
        personName: person.name,
        title: person.title ?? null,
        phone: null,
        linkedin: person.linkedin ?? null,
        company: meta.company ?? domain,
        domain,
        category: meta.category ?? null,
        subcategory: meta.subcategory ?? null,
        tier: meta.tier ?? null,
        confidence: meta.confidence ?? 0.8,
        interests: meta.interests ?? [],
        sourceUrl: person.sourceUrl ?? null,
        source: "github",
        raw: { github: true, person },
      });
      await recordVerification(db, email, res);
    } catch (err) {
      result.errors.push(email + ": " + (err as Error).message);
      return;
    }
  } else {
    await upsertLead(db, {
      email,
      emailType: classifyEmailType(email),
      emailSource: "github",
      personName: person.name,
      title: person.title ?? null,
      phone: null,
      linkedin: person.linkedin ?? null,
      company: meta.company ?? domain,
      domain,
      category: meta.category ?? null,
      subcategory: meta.subcategory ?? null,
      tier: meta.tier ?? null,
      confidence: meta.confidence ?? 0.8,
      interests: meta.interests ?? [],
      sourceUrl: person.sourceUrl ?? null,
      source: "github",
      raw: { github: true, person },
    });
  }
  result.emails.push({
    email,
    personName: person.name,
    pattern: "published",
    score: 0.8,
  });
  result.emailsFound++;
}

function dedupePersons(persons: Person[]): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const p of persons) {
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function emailsForDomain(db: Client, domain: string): Promise<string[]> {
  try {
    const res = await db.execute({
      sql: "SELECT email FROM leads WHERE domain = ? AND email IS NOT NULL LIMIT 5000",
      args: [domain],
    });
    return (res.rows as unknown as { email: string }[]).map((r) => r.email.toLowerCase());
  } catch {
    return [];
  }
}

interface FirstLeadMeta {
  company: string | null;
  category: string | null;
  subcategory: string | null;
  tier: string | null;
  confidence: number | null;
  interests: string | null;
}

/** Pick the most recent lead at a domain to reuse its company metadata. */
async function firstLeadForDomain(db: Client, domain: string): Promise<FirstLeadMeta | null> {
  try {
    const res = await db.execute({
      sql: `SELECT company, category, subcategory, tier, confidence, interests FROM leads
       WHERE domain = ? ORDER BY created_at DESC LIMIT 1`,
      args: [domain],
    });
    const row = (res.rows as unknown as FirstLeadMeta[])[0];
    return row ?? null;
  } catch {
    return null;
  }
}
