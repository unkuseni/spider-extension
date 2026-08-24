// Orchestration: hunt/search → links → filter → scrape → extract contacts → categorize → store → verify

import type { Client } from "@libsql/client";
import type { Config } from "./config.ts";
import { requireSpiderKey } from "./config.ts";
import type {
  Categorization, ContactRecord, PageContent, Person, RequestMode, RunSummary, VerificationResult,
} from "./types.ts";
import {
  extractContactsSpider, getSiteLinks, scrapePage, searchPages, aiStudioExtract,
} from "./spider.ts";
import { classifyEmailType, filterContactUrls, isValidEmail, domainOf, emailNameHint } from "./extract.ts";
import { categorizeDomain, parseContacts } from "./ai.ts";
import { classifyTitle, icpMatch, scoreLead } from "./leadscore.ts";
import { verifyBatch } from "./plunk.ts";
import { initSchema, leadRowByEmail, openDb, recordRun, recordVerification, updateLeadScore, upsertLead, upsertRelation, unverifiedEmails } from "./db.ts";
import { enrichDomain, storePersons } from "./enrich.ts";
import { extractLinkedinCompany } from "./people.ts";
import { fireHook } from "./hooks.ts";
import type { Plugin } from "./types.ts";
import { log } from "./log.ts";

export interface RunOptions {
  limit: number;
  depth: number;
  mode: RequestMode;
  extract: "auto" | "local" | "spider";
  verify: boolean;
  /** Infer + verify employee emails from discovered names (pattern guessing). */
  guessEmails: boolean;
  /** Max candidate addresses per person. */
  perPerson: number;
  /** GitHub org names to pull public members from (opt-in). */
  githubOrgs?: string[];
  dryRun: boolean;
  urlFilter?: string;
  concurrency: number;
  /** Loaded plugins — their hooks fire around/inside the run. */
  plugins?: Plugin[];
}

export const defaultRunOptions = (cfg: Config): RunOptions => ({
  limit: cfg.crawlLimit,
  depth: cfg.crawlDepth,
  mode: "smart",
  extract: cfg.spiderExtract,
  verify: cfg.verifyOnHunt,
  guessEmails: cfg.guessEmails,
  perPerson: cfg.guessPerPerson,
  dryRun: false,
  concurrency: 4,
});

/** Run fn over items with bounded concurrency, collecting errors per item. */
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<{ results: R[]; errors: Error[] }> {
  const results: R[] = [];
  const errors: Error[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        results.push(await fn(item));
      } catch (err) {
        errors.push(err as Error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
  return { results, errors };
}

function toRootUrl(target: string): string {
  if (/^https?:\/\//.test(target)) {
    const u = new URL(target);
    return u.protocol + "//" + u.hostname;
  }
  return "https://" + target;
}

/** Scrape the selected pages (plus the root) and return page contents. */
async function collectPages(
  cfg: Config,
  rootUrl: string,
  urls: string[],
  opts: RunOptions
): Promise<{ pages: PageContent[]; errors: Error[] }> {
  const targets = [rootUrl, ...urls.filter((u) => u !== rootUrl)];
  const { results, errors } = await pMap(targets, opts.concurrency, (url) =>
    scrapePage(cfg, url, { mode: opts.mode })
  );
  return { pages: results.filter((p) => p.markdown.trim().length > 0), errors };
}

export function normalizeContacts(contacts: ContactRecord[], pages: PageContent[]): ContactRecord[] {
  const out: ContactRecord[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    const email = c.email?.toLowerCase().trim() ?? "";
    const phone = c.phone?.trim() ?? "";
    if (email && !isValidEmail(email)) continue;
    // Keep named people even without an email/phone — they feed employee
    // discovery (they are stored in the people table, not as leads).
    const name = c.person_name?.trim() ?? "";
    if (!email && !phone && !(name && (c.title || c.linkedin))) continue;
    // Dedupe by email, else phone, else name — the empty-string constants must
    // not become the key (email ? … : phone ? … : name).
    const key = email ? email : phone ? "p:" + phone : "n:" + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      email: email || undefined,
      person_name: name || (email ? emailNameHint(email) ?? undefined : undefined),
      title: c.title?.trim() || undefined,
      phone: phone || undefined,
      linkedin: c.linkedin?.trim() || undefined,
      github: c.github?.trim() || undefined,
      twitter: c.twitter?.trim() || undefined,
      scheduler: c.scheduler?.trim() || undefined,
    });
  }
  void pages;
  return out;
}

/**
 * Re-score a lead the moment its Plunk verification lands. The initial score is
 * necessarily optimistic (emailValid unknown); the verified truth — validity,
 * disposable, MX records, domain existence, personal mailbox — immediately
 * reshapes it: invalid/disposable emails collapse to D (dead lead), no-MX
 * domains drop hard, personal mailboxes lose a little.
 */
export async function rescoreAfterVerification(
  db: Client,
  cfg: Config,
  email: string,
  res: VerificationResult
): Promise<void> {
  try {
    const row = await leadRowByEmail(db, email);
    if (!row) return;
    let topics: string[] = [];
    try {
      const parsed = JSON.parse(row.interests ?? "[]");
      topics = Array.isArray(parsed) ? parsed.map((i: any) => typeof i === "string" ? i : (i?.topic ?? "")) : [];
    } catch { /* ignore malformed interests */ }
    const cls = classifyTitle(row.title);
    const icp = icpMatch(row.category, topics, cfg.icpCategories, cfg.icpInterests);
    const { score, grade } = scoreLead({
      emailValid: res.valid ? 1 : 0,
      emailSource: row.email_source,
      emailScore: row.email_score,
      companyTier: row.tier,
      companyConfidence: row.confidence,
      icpMatch: icp,
      title: row.title,
      isDisposable: res.isDisposable,
      hasMxRecords: res.hasMxRecords,
      domainExists: res.domainExists,
      isPersonalEmail: res.isPersonalEmail,
    });
    await updateLeadScore(db, email, {
      department: cls.department, seniority: cls.seniority,
      decisionMaker: cls.decisionMaker, leadScore: score, leadTier: grade, icpMatch: icp,
    });
  } catch (err) {
    log.debug("rescore " + email + ": " + (err as Error).message);
  }
}

/** Verify a set of emails with Plunk and write results to the DB. */
export async function verifyEmails(
  db: Client,
  cfg: Config,
  emails: string[],
  opts: { concurrency?: number; onStatus?: (done: number, total: number, valid: number, invalid: number) => void } = {}
): Promise<{ verified: number; invalid: number; failed: number }> {
  let verified = 0, invalid = 0, failed = 0, done = 0;
  const total = emails.length;
  await verifyBatch(cfg, emails, {
    concurrency: opts.concurrency ?? 5,
    onResult: async (email, res, err) => {
      done++;
      if (err) {
        failed++;
        log.warn("verify " + email + ": " + err.message);
      } else if (res.valid) {
        verified++;
        log.ok(email + " — valid");
      } else {
        invalid++;
        log.warn(email + " — INVALID");
      }
      await recordVerification(db, email, res, err);
      if (!err) await rescoreAfterVerification(db, cfg, email, res);
      opts.onStatus?.(done, total, verified, invalid);
    },
  });
  return { verified, invalid, failed };
}

function emptyRun(target: string, source: string): RunSummary {
  return {
    id: crypto.randomUUID(),
    target,
    source,
    pagesCrawled: 0,
    leadsFound: 0,
    leadsNew: 0,
    leadsUpdated: 0,
    leadsVerified: 0,
    leadsInvalid: 0,
    peopleFound: 0,
    guessesMade: 0,
    guessedEmailsFound: 0,
    guessedInvalid: 0,
    errors: [],
  };
}

function mergeRun(target: RunSummary, src: RunSummary): void {
  target.pagesCrawled += src.pagesCrawled;
  target.leadsFound += src.leadsFound;
  target.leadsNew += src.leadsNew;
  target.leadsUpdated += src.leadsUpdated;
  target.leadsVerified += src.leadsVerified;
  target.leadsInvalid += src.leadsInvalid;
  target.peopleFound += src.peopleFound;
  target.guessesMade += src.guessesMade;
  target.guessedEmailsFound += src.guessedEmailsFound;
  target.guessedInvalid += src.guessedInvalid;
  target.errors.push(...src.errors);
}

async function storeAndVerify(
  db: Client,
  cfg: Config,
  domain: string,
  company: string,
  cat: Categorization,
  contacts: ContactRecord[],
  pages: PageContent[],
  opts: RunOptions,
  summary: RunSummary
): Promise<void> {
  const leads = normalizeContacts(contacts, pages);
  summary.leadsFound += leads.filter((c) => c.email || c.phone).length;
  const freshEmails: string[] = [];

  // Named humans (with or without a published email) go into the people table —
  // this is the employee directory used by pattern-based email inference.
  // Social channels + scheduling links are kept as notes (outreach signal).
  const persons: Person[] = leads
    .filter((c) => c.person_name)
    .map((c) => ({
      name: c.person_name!,
      title: c.title,
      linkedin: c.linkedin,
      github: c.github,
      email: c.email,
      source: "page",
      sourceUrl: pages[0]?.url,
      notes: [c.twitter ? "twitter: " + c.twitter : null, c.scheduler ? "scheduler: " + c.scheduler : null]
        .filter(Boolean).join("\n") || undefined,
    }));
  if (!opts.dryRun && persons.length > 0) {
    const { newPeople } = await storePersons(db, domain, persons, company);
    summary.peopleFound += newPeople;
  }

  for (const c of leads) {
    if (!c.email && !c.phone) continue; // name-only people are handled above
    const interests = cat.interests ?? [];
    const cls = classifyTitle(c.title);
    const icp = icpMatch(cat.category, interests.map((i) => i.topic), cfg.icpCategories, cfg.icpInterests);
    const { score, grade } = scoreLead({
      emailValid: null,
      emailScore: null,
      emailSource: c.email ? "page" : "unknown",
      companyTier: cat.tier,
      companyConfidence: cat.confidence,
      icpMatch: icp,
      title: c.title,
    });
    const lead = {
      email: c.email ?? null,
      emailType: c.email ? classifyEmailType(c.email) : null,
      emailSource: c.email ? ("page" as const) : ("unknown" as const),
      personName: c.person_name ?? null,
      title: c.title ?? null,
      phone: c.phone ?? null,
      linkedin: c.linkedin ?? null,
      company: company || domain,
      domain,
      category: cat.category,
      subcategory: cat.subcategory,
      tier: cat.tier,
      confidence: cat.confidence,
      interests,
      department: cls.department,
      seniority: cls.seniority,
      decisionMaker: cls.decisionMaker,
      leadScore: score,
      leadTier: grade,
      icpMatch: icp,
      sourceUrl: pages[0]?.url ?? toRootUrl(domain),
      source: summary.source,
      raw: { contact: c, category: cat },
    };
    if (opts.dryRun) {
      log.debug("[dry-run] would store " + (c.email ?? c.phone ?? "(no contact info)"));
      continue;
    }
    const outcome = await upsertLead(db, lead);
    if (outcome === "new") {
      summary.leadsNew++;
      if (c.email && opts.verify) freshEmails.push(c.email);
    } else {
      summary.leadsUpdated++;
    }
    if (opts.plugins && opts.plugins.length > 0) {
      await fireHook(opts.plugins, "onLead", { lead, outcome }, summary.errors);
    }
  }

  // Company-to-company relationships found on the site (partners, clients…).
  if (!opts.dryRun && cat.relations && cat.relations.length > 0) {
    for (const rel of cat.relations) {
      await upsertRelation(db, domain, rel, pages[0]?.url);
    }
    log.info("Relations: " + cat.relations.length + " recorded for " + domain);
  }

  if (opts.verify && !opts.dryRun && freshEmails.length > 0) {
    if (!cfg.plunkApiKey) {
      log.warn("VERIFY_ON_HUNT is enabled but PLUNK_API_KEY is not set — skipping verification.");
    } else {
      log.step("Verifying " + freshEmails.length + " new email(s) with Plunk…");
      const { verified, invalid } = await verifyEmails(db, cfg, freshEmails, { concurrency: opts.concurrency });
      summary.leadsVerified += verified;
      summary.leadsInvalid += invalid;
    }
  }

  // Employee email inference: names without published emails → candidate
  // addresses → Plunk verification → valid ones stored as leads.
  const peopleWithoutEmail = persons.filter((p) => !p.email);
  if (opts.guessEmails && !opts.dryRun && peopleWithoutEmail.length > 0) {
    if (!cfg.plunkApiKey) {
      log.warn("GUESS_EMAILS is on but PLUNK_API_KEY is not set — skipping email inference.");
    } else {
      log.step("Inferring employee emails for " + peopleWithoutEmail.length + " person(s) at " + domain + "…");
      const res = await enrichDomain(db, cfg, domain, {
        people: peopleWithoutEmail,
        verify: true,
        perPerson: opts.perPerson,
        concurrency: opts.concurrency,
        githubOrgs: opts.githubOrgs,
        githubToken: cfg.githubToken,
        meta: { company, ...cat },
      });
      summary.peopleFound = Math.max(summary.peopleFound, res.people);
      summary.guessesMade += res.candidatesVerified;
      summary.guessedEmailsFound += res.emailsFound;
      summary.guessedInvalid += res.invalid;
      summary.errors.push(...res.errors);
      log.ok("Employee email inference: " + res.emailsFound + " found, " + res.invalid + " invalid.");
    }
  }
}

/** Hunt one target: links → contact pages → extract → categorize → store → verify. */
export async function hunt(
  db: Client,
  cfg: Config,
  targets: string[],
  opts: RunOptions
): Promise<RunSummary> {
  requireSpiderKey(cfg);
  const merged = emptyRun(targets.join(", "), "hunt");
  for (const target of targets) {
    const run = await huntOne(db, cfg, target, opts);
    mergeRun(merged, run);
  }
  return merged;
}

async function huntOne(
  db: Client,
  cfg: Config,
  target: string,
  opts: RunOptions
): Promise<RunSummary> {
  const summary = emptyRun(target, "hunt");
  const startedAt = new Date().toISOString();
  const rootUrl = toRootUrl(target);
  const domain = domainOf(rootUrl);
  log.step("Hunting " + domain);
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "beforeRun", { source: "hunt", target: domain }, summary.errors);
  }

  // 1-4) Links → filter → scrape → extract (shared with the agent tools)
  const extraction = await extractContactsFromSite(cfg, target, opts);
  summary.errors.push(...extraction.errors);
  summary.pagesCrawled += extraction.pages.length;
  if (extraction.linksFound === 0) {
    log.warn("No links returned for " + domain);
    await recordRun(db, {
      id: summary.id, target: domain, source: "hunt", startedAt,
      finishedAt: new Date().toISOString(), pagesCrawled: 0, leadsFound: 0,
      verified: 0, invalid: 0, errors: summary.errors,
    });
    return summary;
  }
  const contacts = extraction.contacts;
  const pages = extraction.pages;

  // 5) Categorize the company (one call per domain)
  const cat = await categorizeDomain(cfg, domain, pages.length > 0 ? pages : [{ url: rootUrl, markdown: "", status: 200 }]);
  log.info("Category: " + cat.category + " (" + cat.method + ", confidence " + cat.confidence.toFixed(2) + ")");

  // 6) Store + verify
  await storeAndVerify(db, cfg, domain, domain, cat, contacts, pages, opts, summary);

  await recordRun(db, {
    id: summary.id, target: domain, source: "hunt", startedAt,
    finishedAt: new Date().toISOString(), pagesCrawled: pages.length,
    leadsFound: summary.leadsFound, verified: summary.leadsVerified,
    invalid: summary.leadsInvalid, errors: summary.errors,
  });
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "afterRun", { summary }, summary.errors);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Reusable site extraction (used by hunt and by the agent's extract_contacts tool)
// ---------------------------------------------------------------------------

export interface SiteExtraction {
  contacts: ContactRecord[];
  pages: PageContent[];
  errors: string[];
  linksFound: number;
  linksSelected: number;
  domain: string;
}

/** Links → contact-page filter → scrape → extract contacts for one site. */
export async function extractContactsFromSite(
  cfg: Config,
  target: string,
  opts: RunOptions
): Promise<SiteExtraction> {
  const rootUrl = toRootUrl(target);
  const domain = domainOf(rootUrl);
  const errors: string[] = [];

  // 1) Enumerate links
  const links = await getSiteLinks(cfg, rootUrl, { limit: Math.max(opts.limit * 5, 50), mode: opts.mode });
  log.info(links.length + " link(s) discovered for " + domain);
  if (links.length === 0) {
    return { contacts: [], pages: [], errors: [domain + ": no links returned"], linksFound: 0, linksSelected: 0, domain };
  }

  // 2) Filter to contact-likely pages (custom regex overrides)
  let selected: string[] = [];
  if (opts.urlFilter) {
    try {
      const re = new RegExp(opts.urlFilter, "i");
      selected = [...new Set(links.filter((u) => re.test(u)))];
    } catch {
      log.warn("Invalid --filter regex " + opts.urlFilter + "; ignoring");
    }
  }
  if (selected.length === 0) selected = filterContactUrls(links, opts.limit);
  log.info("Selected " + selected.length + " page(s) for extraction");

  // 3) Scrape pages
  const { pages, errors: scrapeErrors } = await collectPages(cfg, rootUrl, selected, opts);
  for (const e of scrapeErrors) errors.push(domain + ": " + e.message);
  log.info("Scraped " + pages.length + " page(s)");

  // 4) Extract contacts — Spider AI pipeline, or local (AI/regex)
  let contacts: ContactRecord[] = [];
  if (opts.extract === "spider" || opts.extract === "auto") {
    try {
      contacts = await extractContactsSpider(cfg, rootUrl, { limit: opts.limit });
      log.info("Spider AI extraction returned " + contacts.length + " raw record(s)");
    } catch (err) {
      if (opts.extract === "spider") throw err;
      log.warn("Spider AI extraction unavailable (" + (err as Error).message + ") — using local extraction");
    }
  }
  if (contacts.length === 0) {
    contacts = await parseContacts(cfg, pages, domain);
    log.info("Local extraction found " + contacts.length + " contact record(s)");
  }
  return { contacts, pages, errors, linksFound: links.length, linksSelected: selected.length, domain };
}

/** Search the web, then extract leads from the result pages. */
export async function huntSearch(
  db: Client,
  cfg: Config,
  query: string,
  opts: RunOptions
): Promise<RunSummary> {
  requireSpiderKey(cfg);
  const summary = emptyRun(query, "search");
  const startedAt = new Date().toISOString();
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "beforeRun", { source: "search", target: query }, summary.errors);
  }

  log.step("Searching: " + query);
  const pages = await searchPages(cfg, query, { limit: opts.limit, mode: opts.mode });
  summary.pagesCrawled = pages.length;
  log.info("Search returned " + pages.length + " page(s)");

  // Group by domain so we categorize once per company
  const byDomain = new Map<string, PageContent[]>();
  for (const p of pages) {
    const d = domainOf(p.url);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(p);
  }

  for (const [domain, domainPages] of byDomain) {
    log.step("Processing " + domain);
    const cat = await categorizeDomain(cfg, domain, domainPages);
    const contacts = await parseContacts(cfg, domainPages, domain);
    log.info(contacts.length + " contact(s), category " + cat.category);
    await storeAndVerify(db, cfg, domain, domain, cat, contacts, domainPages, opts, summary);
  }

  await recordRun(db, {
    id: summary.id,
    target: query,
    source: "search",
    startedAt,
    finishedAt: new Date().toISOString(),
    pagesCrawled: pages.length,
    leadsFound: summary.leadsFound,
    verified: summary.leadsVerified,
    invalid: summary.leadsInvalid,
    errors: summary.errors,
  });
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "afterRun", { summary }, summary.errors);
  }
  return summary;
}

/** Verify previously stored leads (default: status 'new'). */
export async function verifyStored(
  db: Client,
  cfg: Config,
  opts: { limit?: number; status?: string; concurrency?: number }
): Promise<{ checked: number; verified: number; invalid: number; failed: number }> {
  if (!cfg.plunkApiKey) throw new Error("PLUNK_API_KEY is not set. Add it to .env to verify emails.");
  const emails = await unverifiedEmails(db, { limit: opts.limit, status: opts.status });
  if (emails.length === 0) {
    log.info("No unverified emails found.");
    return { checked: 0, verified: 0, invalid: 0, failed: 0 };
  }
  log.step("Verifying " + emails.length + " email(s) with Plunk…");
  const res = await verifyEmails(db, cfg, emails, { concurrency: opts.concurrency ?? 5 });
  return { checked: emails.length, ...res };
}

export async function ensureDb(cfg: Config): Promise<Client> {
  const db = openDb(cfg);
  await initSchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// Employee scraper — AI Studio prompt-driven extraction of a site's people,
// falling back to the standard contact pipeline when AI Studio is not enabled.
// ---------------------------------------------------------------------------

export const EMPLOYEE_AI_PROMPT =
  "Extract every team member and employee shown on this site: full name, job title, " +
  "department (engineering/sales/marketing/product/operations/finance/hr/legal/other), " +
  "LinkedIn URL, GitHub URL, and any published email. Include people WITHOUT an email " +
  "(email stays null). Only include people actually listed on the site.";

const EMPLOYEE_SCHEMA = {
  name: "employees",
  description: "Team members and employees of the company",
  schema: {
    type: "object",
    properties: {
      employees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            department: { type: "string" },
            email: { type: ["string", "null"] },
            linkedin: { type: ["string", "null"] },
            github: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

interface AiEmployee {
  name?: string;
  title?: string;
  department?: string;
  email?: string | null;
  linkedin?: string | null;
  github?: string | null;
}

/** AI Studio crawl: one page object per page, employees pulled from extracted_data. */
async function extractEmployeesAiStudio(
  cfg: Config,
  rootUrl: string,
  opts: RunOptions
): Promise<SiteExtraction> {
  const errors: string[] = [];
  const pages: PageContent[] = [];
  const contacts: ContactRecord[] = [];
  const results = await aiStudioExtract(cfg, "crawl", rootUrl, EMPLOYEE_AI_PROMPT, {
    limit: opts.limit,
    metadata: true,
    schema: EMPLOYEE_SCHEMA,
  });
  for (const r of results) {
    if (r.url) pages.push({ url: r.url, markdown: typeof r.content === "string" ? r.content : "", status: r.status });
    if (r.error) errors.push(String(r.error));
    const data: any = r.extractedData;
    const items: AiEmployee[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.employees) ? data.employees
        : Array.isArray(data?.people) ? data.people : [];
    for (const e of items) {
      if (!e?.name && !e?.email) continue;
      contacts.push({
        person_name: e.name ?? undefined,
        title: e.title ?? undefined,
        email: e.email ?? undefined,
        linkedin: e.linkedin ?? undefined,
        github: e.github ?? undefined,
      });
    }
  }
  const domain = domainOf(rootUrl);
  return { contacts, pages, errors, linksFound: results.length, linksSelected: results.length, domain };
}

/** Find employees for a set of targets (AI Studio first, standard pipeline fallback). */
export async function findEmployees(
  db: Client,
  cfg: Config,
  targets: string[],
  opts: RunOptions
): Promise<RunSummary> {
  requireSpiderKey(cfg);
  const merged = emptyRun(targets.join(", "), "employees");
  for (const target of targets) {
    const summary = emptyRun(target, "employees");
    const startedAt = new Date().toISOString();
    const rootUrl = toRootUrl(target);
    const domain = domainOf(rootUrl);
    log.step("Employees: " + domain);

    let extraction: SiteExtraction;
    if (cfg.aiStudio) {
      log.info("Using AI Studio employee extraction (credits apply)");
      try {
        extraction = await extractEmployeesAiStudio(cfg, rootUrl, opts);
        // Silent extraction failure: AI Studio may fetch pages but hand back no
        // extracted_data (account without a full AI Studio subscription). Fall
        // back to the standard pipeline so the user still gets results.
        if (extraction.contacts.length === 0 && extraction.pages.length > 0) {
          log.warn("AI Studio returned no employees — falling back to standard extraction");
          extraction = await extractContactsFromSite(cfg, target, opts);
        }
      } catch (err) {
        log.warn("AI Studio extraction failed (" + (err as Error).message + ") — falling back to standard extraction");
        extraction = await extractContactsFromSite(cfg, target, opts);
      }
    } else {
      extraction = await extractContactsFromSite(cfg, target, opts);
    }
    summary.errors.push(...extraction.errors);
    summary.pagesCrawled += extraction.pages.length;
    const contacts = extraction.contacts;
    const pages = extraction.pages;
    if (contacts.length === 0) {
      log.warn("No people found for " + domain);
      summary.errors.push(domain + ": no employees found");
      await recordRun(db, {
        id: summary.id, target: domain, source: "employees", startedAt,
        finishedAt: new Date().toISOString(), pagesCrawled: pages.length,
        leadsFound: 0, verified: 0, invalid: 0, errors: summary.errors,
      });
      mergeRun(merged, summary);
      continue;
    }

    const people = contacts.filter((c) => c.person_name).length;
    log.info(people + " person(s) found on " + domain);
    const cat = await categorizeDomain(cfg, domain, pages.length > 0
      ? pages
      : [{ url: rootUrl, markdown: "", status: 200 }]);
    await storeAndVerify(db, cfg, domain, domain, cat, contacts, pages, opts, summary);
    await recordRun(db, {
      id: summary.id, target: domain, source: "employees", startedAt,
      finishedAt: new Date().toISOString(), pagesCrawled: pages.length,
      leadsFound: summary.leadsFound, verified: summary.leadsVerified,
      invalid: summary.leadsInvalid, errors: summary.errors,
    });
    mergeRun(merged, summary);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// LinkedIn company-page employee discovery (public pages only).
// Scrapes the public company page (browser + premium proxy), extracts the
// employee cards LinkedIn exposes there, stores them as people, then enriches
// the company's website domain: learns the email pattern from known addresses
// and guesses + (with a Plunk key) verifies the employees' emails.
// ---------------------------------------------------------------------------

export interface LinkedinCompanyResult {
  company: string | null;
  industry: string | null;
  size: string | null;
  hq: string | null;
  employeeCount: number | null;
  specialties: string[];
  website: string | null;
  employeesFound: number;
  /** Names stored in the people table. */
  peopleStored: number;
  domain: string | null;
  guessesMade: number;
  emailsFound: number;
  emails: { email: string; personName: string; pattern: string; score: number }[];
  errors: string[];
}

function linkedinSlug(input: string): string {
  return input
    .replace(/^https?:\/\/(?:www\.)?linkedin\.com\/company\//i, "")
    .replace(/^https?:\/\/(?:www\.)?linkedin\.com\//i, "")
    .replace(/\/.*$/, "")
    .trim();
}

export async function linkedinCompany(
  db: Client,
  cfg: Config,
  slug: string,
  opts: { verify?: boolean; perPerson?: number; mode?: RequestMode } = {}
): Promise<LinkedinCompanyResult> {
  requireSpiderKey(cfg);
  const clean = linkedinSlug(slug);
  if (!clean) throw new Error("invalid LinkedIn company slug: " + slug);
  const url = `https://www.linkedin.com/company/${encodeURIComponent(clean)}`;
  const result: LinkedinCompanyResult = {
    company: null, industry: null, size: null, hq: null, employeeCount: null,
    specialties: [], website: null, employeesFound: 0, peopleStored: 0,
    domain: null, guessesMade: 0, emailsFound: 0, emails: [], errors: [],
  };

  log.step("LinkedIn company page: " + url);
  const page = await scrapePage(cfg, url, {
    mode: opts.mode ?? "browser",
    params: { premiumProxy: true, waitForSelector: ".org-top-card-summary" },
  });
  const info = extractLinkedinCompany(page.markdown);
  result.company = info.name;
  result.industry = info.industry;
  result.size = info.size;
  result.hq = info.hq;
  result.employeeCount = info.employeeCount;
  result.specialties = info.specialties;
  result.website = info.website;
  result.employeesFound = info.employees.length;
  log.info(`LinkedIn: ${info.name ?? clean} · ${info.industry ?? "?"} · ${info.size ?? "?"}` +
    (info.employeeCount ? ` · ${info.employeeCount} employees` : "") +
    ` · ${info.employees.length} exposed employee card(s)`);

  if (info.employees.length === 0) {
    log.warn("No employee cards exposed on the public page (the roster section is login-gated).");
    return result;
  }
  if (!info.website) {
    log.warn("No website on the LinkedIn page — cannot map employees to an email domain.");
  }

  const companyName = info.name ?? clean;
  const domain = info.website ? domainOf(info.website) : null;
  result.domain = domain;
  if (domain) {
    const { newPeople } = await storePersons(db, domain, info.employees, companyName);
    result.peopleStored = newPeople;
    log.info(`Stored ${newPeople} employee(s) at ${domain}`);
    // Enrich: learn the domain's convention from any known emails, infer the
    // employees' addresses, verify with Plunk when configured.
    const res = await enrichDomain(db, cfg, domain, {
      people: info.employees,
      verify: opts.verify !== false,
      perPerson: opts.perPerson ?? 4,
      meta: { company: companyName, category: info.industry ?? undefined },
    });
    result.guessesMade = res.candidatesVerified;
    result.emailsFound = res.emailsFound;
    result.emails = res.emails ?? [];
    result.errors.push(...res.errors);
    log.ok(`Employee email inference: ${res.emailsFound} found (${res.candidatesVerified} verified, ${res.invalid} invalid).`);
  } else {
    // No domain — store the employees against the company slug so enrich/people
    // still record the discovery (people table is keyed by domain, so fall back
    // to the slug for traceability).
    const { newPeople } = await storePersons(db, clean, info.employees, companyName);
    result.peopleStored = newPeople;
  }
  return result;
}