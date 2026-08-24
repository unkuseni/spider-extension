#!/usr/bin/env node
// spider-leads CLI — find leads, categorize with AI, store in Turso, verify with Plunk.

import type { Config } from "./config.ts";
import { extractMode, loadConfig, requestMode } from "./config.ts";
import {
  defaultRunOptions, ensureDb, extractContactsFromSite, findEmployees, hunt, huntSearch, verifyStored,
} from "./pipeline.ts";
import { runAgent } from "./agent.ts";
import { enrichDomain } from "./enrich.ts";
import { fetchStructured, listScraperDirectory } from "./spider.ts";
import { discoverPluginsDir, installJsonPluginFile, loadPlugins, resolveNamedFilter } from "./plugins.ts";
import type { Plugin, Person } from "./types.ts";
import { dbStats, leadsRelatedTo, listLeads, listPeople, relationsForDomain, updateLeadScore } from "./db.ts";
import { classifyTitle, icpMatch, scoreLead } from "./leadscore.ts";
import { domainOf, toRoot } from "./extract.ts";
import { log } from "./log.ts";

interface Flag {
  name: string;
  alias?: string;
  takesValue: boolean;
}

const FLAGS: Flag[] = [
  { name: "limit", alias: "l", takesValue: true },
  { name: "depth", alias: "d", takesValue: true },
  { name: "mode", alias: "m", takesValue: true },
  { name: "extract", alias: "e", takesValue: true },
  { name: "filter", alias: "f", takesValue: true },
  { name: "concurrency", alias: "c", takesValue: true },
  { name: "status", alias: "s", takesValue: true },
  { name: "category", alias: "C", takesValue: true },
  { name: "type", alias: "t", takesValue: true },
  { name: "source", alias: "S", takesValue: true },
  { name: "interest", alias: "i", takesValue: true },
  { name: "format", alias: "F", takesValue: true },
  { name: "output", alias: "o", takesValue: true },
  { name: "plugins-dir", takesValue: true },
  { name: "exporter", takesValue: true },
  { name: "query", alias: "q", takesValue: true },
  { name: "per-person", takesValue: true },
  { name: "github", takesValue: true },
  { name: "domain", takesValue: true },
  { name: "min-score", takesValue: true },
  { name: "tier", takesValue: true },
  { name: "department", takesValue: true },
  { name: "decision-maker", takesValue: false },
  { name: "related-to", takesValue: true },
  { name: "verify", takesValue: false },
  { name: "no-verify", takesValue: false },
  { name: "proxy", takesValue: false },
  { name: "no-proxy", takesValue: false },
  { name: "country", takesValue: true },
  { name: "ai-studio", takesValue: false },
  { name: "no-ai-studio", takesValue: false },
  { name: "category", takesValue: true },
  { name: "readability", takesValue: false },
  { name: "guess", takesValue: false },
  { name: "no-guess", takesValue: false },
  { name: "no-email", takesValue: false },
  { name: "dry-run", takesValue: false },
  { name: "json", takesValue: false },
  { name: "verbose", alias: "v", takesValue: false },
  { name: "help", alias: "h", takesValue: false },
];

function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const flag = FLAGS.find((f) => f.name === name);
      if (!flag) throw new Error(`Unknown flag: --${name}`);
      if (flag.takesValue) {
        const val = eq !== -1 ? arg.slice(eq + 1) : argv[++i];
        if (val === undefined) throw new Error(`Flag --${name} needs a value`);
        flags[name] = val;
      } else {
        flags[name] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const name = arg.slice(1);
      const flag = FLAGS.find((f) => f.alias === name);
      if (!flag) throw new Error(`Unknown flag: -${name}`);
      if (flag.takesValue) {
        const val = argv[++i];
        if (val === undefined) throw new Error(`Flag -${name} needs a value`);
        flags[flag.name] = val;
      } else {
        flags[flag.name] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }
  return { command, positionals, flags };
}

const HELP = `spider-leads — find B2B leads, categorize with AI, store in Turso, verify with Plunk

USAGE
  spider-leads <command> [args] [flags]

COMMANDS
  init-db                 Create the leads + runs tables in the database
  hunt <url|domain...>    Crawl sites and extract leads (links → contact pages → AI extraction)
  search <query>          Search the web and extract leads from result pages
  fetch <url>             Structured extraction via Spider's curated/AI per-site scraper
                          configs (zillow.com, indeed.com, yelp.com…; /fetch API)
  employees <domain...>   Employee scraper: extract a site's people (names/titles/emails
                          via AI Studio prompt → JSON when enabled; standard pipeline
                          otherwise), store them as people/leads, optionally infer emails
  scrapers [--domain D]   Browse Spider's scraper-directory config catalog (no auth)
  enrich <domain...>      Infer employee emails: discover people, learn the domain's email
                          pattern, generate candidates, verify with Plunk, store valid ones
  people                  List discovered people (--domain X, --no-email)
  score                   Recompute lead scores + role classification for stored leads
                          (uses ICP_INTERESTS / ICP_CATEGORIES from the environment)
  relations [domain...]   Show company relationships (partners/clients/competitors) found
                          by AI on the sites, plus leads at related companies
  agent <objective>       Let the AI drive the whole workflow via tool calling
                          (search_web, extract_contacts, find_employees, guess_emails,
                           categorize_company, verify_email, store_leads…)
  verify                  Verify stored leads with Plunk (default: status 'new')
  list                    Show stored leads
  stats                   Database summary (counts by status and category)
  export <file>           Export leads to CSV or JSON (--format csv|json, or --exporter <id>)
  plugins list            List discovered plugins (tools / hooks / exporters)
  plugins install <file>  Install a JSON plugin file into the plugins directory
  help                    This help

FLAGS
  -l, --limit N        Max pages/leads per target (default 30)
  -d, --depth N        Crawl depth for /crawl-based flows (default 2)
  -m, --mode MODE      smart | http | browser (default smart)
  -e, --extract MODE   auto | local | spider — how contacts are extracted (default auto)
  -f, --filter REGEX   Only extract from URLs matching REGEX
  -c, --concurrency N  Concurrent fetches / verifications (default 4-5)
      --proxy          Route requests through Spider's premium proxy pool
                       (residential rotation — for bot-protected sites)
      --no-proxy       Disable the premium proxy
      --country CC     ISO-2 country for proxy georouting, e.g. --country us (en/de…)
      --ai-studio      Use Spider AI Studio /ai/* endpoints (prompt→JSON; needs an
                       AI Studio subscription — credits apply)
      --no-ai-studio   Disable AI Studio endpoints
      --category C     Filter scraper catalog by category (scrapers)
      --readability    Strip navigation/ads, main content only (fetch)
      --guess          Infer employee emails (pattern-based) after hunting; verify with Plunk
      --no-guess       Disable employee email inference
      --per-person N   Max candidate addresses to try per person (default 3)
      --github ORGS    Comma-separated GitHub orgs to pull public members from (enrich)
      --max-turns N    Agent turn budget (default 20)
      --plugins-dir P   Plugin directory (default: ./plugins or $SPIDER_PLUGINS_DIR)
      --exporter ID     Use a plugin exporter for 'export' (e.g. --exporter jsonl)
  -s, --status ST      Filter by status: new | verified | invalid | error
  -C, --category CAT   Filter by industry category
  -t, --type TYPE      Filter by email type: corporate | business | student | personal
  -S, --source SOURCE  Filter by email source: page | guessed | github | agent | user
  -i, --interest TOPIC Filter by interest topic (substring match)
      --min-score N    Only leads with lead score >= N (list)
      --tier T         Filter by lead grade: A | B | C | D
      --department D   Filter by role department (sales, engineering, marketing…)
      --decision-maker Only leads who are decision makers (exec/head/director/owner…)
      --related-to D   List leads at companies related to a domain (partners/clients…)
      --domain D       Filter by domain (people command)
      --no-email       Only people without a published email (people command)
  -F, --format FMT     csv | json (export); markdown|text|html2text|raw (fetch)
  -o, --output FILE    Output file (export)
  -q, --query Q        Query text (search)
      --no-verify      Don't verify emails after hunting
      --dry-run        Rehearse a run: fetch + extract, but write nothing to the DB
      --json           Machine-readable output (list/stats/people/fetch)
  -v, --verbose        Verbose debug logging
  -h, --help           This help

ENV (.env — see .env.example)
  SPIDER_API_KEY  TURSO_URL / TURSO_AUTH_TOKEN  PLUNK_API_KEY
  OPENAI_API_KEY (any OpenAI-compatible endpoint)  VERIFY_ON_HUNT
  GUESS_EMAILS (true to infer employee emails after hunts)  GITHUB_TOKEN (optional)
  SPIDER_PROXY (true to use the premium proxy pool)  SPIDER_COUNTRY (ISO-2, e.g. us)
`;

function numFlag(flags: Record<string, string | boolean>, name: string, def: number): number {
  const v = flags[name];
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function printRunSummary(s: { target: string; source: string; pagesCrawled: number; leadsFound: number; leadsNew: number; leadsUpdated: number; leadsVerified: number; leadsInvalid: number; peopleFound?: number; guessesMade?: number; guessedEmailsFound?: number; guessedInvalid?: number; errors: string[] }): void {
  log.raw("");
  log.raw(`┌─ Run complete: ${s.target} (${s.source})`);
  log.raw(`│  pages crawled : ${s.pagesCrawled}`);
  log.raw(`│  leads found   : ${s.leadsFound}  (new ${s.leadsNew}, updated ${s.leadsUpdated})`);
  log.raw(`│  verified      : ${s.leadsVerified}`);
  log.raw(`│  invalid       : ${s.leadsInvalid}`);
  if (s.peopleFound) log.raw(`│  people        : ${s.peopleFound}`);
  if (s.guessesMade) {
    log.raw(`│  email guesses : ${s.guessesMade} verified → ${s.guessedEmailsFound} found, ${s.guessedInvalid} invalid`);
  }
  if (s.errors.length) log.raw(`│  errors        : ${s.errors.length} (see --verbose)`);
  log.raw(`└─ run id: ${(s as any).id ?? "-"}`);
}

function printPeople(rows: any[]): void {
  if (rows.length === 0) {
    log.info("No people found.");
    return;
  }
  const cols = ["name", "title", "email", "domain", "source", "linkedin", "github"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const pad = (s: string, w: number) => s.padEnd(w);
  log.raw(cols.map((c, i) => pad(c, widths[i])).join("  "));
  log.raw(cols.map((_, i) => "-".repeat(widths[i])).join("  "));
  for (const r of rows) {
    log.raw(cols.map((c, i) => pad(String(r[c] ?? "").slice(0, 40), widths[i])).join("  "));
  }
  log.raw(`${rows.length} row(s)`);
}

function printLeads(rows: any[]): void {
  if (rows.length === 0) {
    log.info("No leads found.");
    return;
  }
  const cols = ["email", "src", "score", "tier", "person_name", "title", "company", "type", "category", "status"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const pad = (s: string, w: number) => s.padEnd(w);
  log.raw(cols.map((c, i) => pad(c, widths[i])).join("  "));
  log.raw(cols.map((_, i) => "-".repeat(widths[i])).join("  "));
  for (const r of rows) {
    const vals = cols.map((c, i) => {
      let v = String(
        c === "type" ? (r as any).email_type ?? ""
          : c === "src" ? (r as any).email_source ?? ""
            : c === "score" ? (r as any).lead_score ?? ""
              : c === "tier" ? (r as any).lead_tier ?? ""
                : r[c] ?? ""
      );
      return pad(v, widths[i]);
    });
    log.raw(vals.join("  "));
  }
  log.raw(`${rows.length} row(s)`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log(HELP);
    return 0;
  }
  const { command, positionals, flags } = parseArgs(argv);
  if (command === "help" || flags.help) {
    console.log(HELP);
    return 0;
  }
  const cfg: Config = loadConfig();
  cfg.verbose = !!flags.verbose;
  log.verbose = cfg.verbose;
  if (flags["no-proxy"]) cfg.spiderProxy = false;
  else if (flags.proxy) cfg.spiderProxy = true;
  if (typeof flags.country === "string") cfg.spiderCountry = flags.country;
  if (flags["no-ai-studio"]) cfg.aiStudio = false;
  else if (flags["ai-studio"]) cfg.aiStudio = true;

  // Load plugins once for commands that support them.
  let plugins: Plugin[] = [];
  if (["hunt", "search", "agent", "export"].includes(command)) {
    const dir = discoverPluginsDir(typeof flags["plugins-dir"] === "string" ? flags["plugins-dir"] : undefined);
    const loaded = await loadPlugins(dir, cfg);
    plugins = loaded.plugins;
    if (loaded.plugins.length > 0) {
      log.info("Plugins: " + loaded.plugins.map((p) => p.id).join(", "));
    }
  }

  try {
    switch (command) {
      case "init-db": {
        const db = await ensureDb(cfg);
        log.ok(`Database ready: ${cfg.tursoUrl}`);
        await db.close();
        return 0;
      }
      case "hunt": {
        if (positionals.length === 0) throw new Error("hunt needs at least one URL or domain. e.g. spider-leads hunt acme.com");
        const opts = defaultRunOptions(cfg);
        opts.limit = numFlag(flags, "limit", opts.limit);
        opts.depth = numFlag(flags, "depth", opts.depth);
        opts.mode = requestMode(typeof flags.mode === "string" ? flags.mode : "smart");
        opts.extract = extractMode(typeof flags.extract === "string" ? flags.extract : cfg.spiderExtract);
        opts.verify = flags["no-verify"] ? false : cfg.verifyOnHunt;
        opts.dryRun = !!flags["dry-run"];
        opts.concurrency = numFlag(flags, "concurrency", opts.concurrency);
        opts.guessEmails = flags["no-guess"] ? false : flags.guess ? true : cfg.guessEmails;
        opts.perPerson = numFlag(flags, "per-person", cfg.guessPerPerson);
        if (typeof flags.github === "string") {
          opts.githubOrgs = flags.github.split(",").map((s) => s.trim()).filter(Boolean);
        }
        if (typeof flags.filter === "string") {
          opts.urlFilter = resolveNamedFilter(plugins, flags.filter) ?? flags.filter;
          if (flags.filter.startsWith("@") && opts.urlFilter === flags.filter) {
            log.warn("Named filter '" + flags.filter + "' not found in any plugin — using it as a raw regex");
          }
        }
        if (opts.dryRun) log.warn("dry-run mode — nothing will be fetched or stored");

        opts.plugins = plugins;
        const db = await ensureDb(cfg);
        const summary = await hunt(db, cfg, positionals, opts);
        printRunSummary(summary);
        await db.close();
        return 0;
      }
      case "search": {
        const query = typeof flags.query === "string" ? flags.query : positionals.join(" ");
        if (!query) throw new Error("search needs a query. e.g. spider-leads search --query \"plumbing companies in Austin\"");
        const opts = defaultRunOptions(cfg);
        opts.limit = numFlag(flags, "limit", opts.limit);
        opts.depth = numFlag(flags, "depth", opts.depth);
        opts.mode = requestMode(typeof flags.mode === "string" ? flags.mode : "smart");
        opts.extract = extractMode(typeof flags.extract === "string" ? flags.extract : cfg.spiderExtract);
        opts.verify = flags["no-verify"] ? false : cfg.verifyOnHunt;
        opts.dryRun = !!flags["dry-run"];
        opts.concurrency = numFlag(flags, "concurrency", opts.concurrency);
        opts.guessEmails = flags["no-guess"] ? false : flags.guess ? true : cfg.guessEmails;
        opts.perPerson = numFlag(flags, "per-person", cfg.guessPerPerson);
        if (typeof flags.github === "string") {
          opts.githubOrgs = flags.github.split(",").map((s) => s.trim()).filter(Boolean);
        }
        opts.plugins = plugins;
        const db = await ensureDb(cfg);
        const summary = await huntSearch(db, cfg, query, opts);
        printRunSummary(summary);
        await db.close();
        return 0;
      }
      case "plugins": {
        const dir = discoverPluginsDir(typeof flags["plugins-dir"] === "string" ? flags["plugins-dir"] : undefined);
        if (positionals[0] === "install") {
          const file = positionals[1];
          if (!file) throw new Error("plugins install needs a plugin file path, e.g. plugins install ./my-plugin.json");
          await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
          const id = await installJsonPluginFile(file, dir, cfg);
          log.ok("Installed plugin '" + id + "' into " + dir);
          return 0;
        }
        const { plugins: found, errors } = await loadPlugins(dir, cfg);
        log.raw("Plugins directory: " + dir);
        if (found.length === 0) log.raw("No plugins found.");
        for (const p of found) {
          log.raw("");
          log.raw(p.id + " v" + p.version + " — " + p.name);
          if (p.description) log.raw("  " + p.description);
          if (p.tools.length) log.raw("  tools: " + p.tools.map((t) => t.name).join(", "));
          const hookNames = Object.keys(p.hooks).filter((k) => typeof (p.hooks as Record<string, unknown>)[k] === "function");
          if (hookNames.length) log.raw("  hooks: " + hookNames.join(", "));
          if (p.exporters.length) log.raw("  exporters: " + p.exporters.map((e) => e.id + " (" + e.label + ")").join(", "));
        }
        for (const e of errors) log.warn("Failed: " + e);
        return 0;
      }
      case "enrich": {
        if (positionals.length === 0) {
          throw new Error("enrich needs at least one domain. e.g. spider-leads enrich acme.com");
        }
        if (!cfg.plunkApiKey) {
          log.warn("PLUNK_API_KEY is not set — candidates will be saved as pending (not verified).");
        }
        const db = await ensureDb(cfg);
        const perPerson = numFlag(flags, "per-person", cfg.guessPerPerson);
        const githubOrgs = typeof flags.github === "string"
          ? flags.github.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        const doExtract = typeof flags.extract === "string";
        for (const target of positionals) {
          const domain = domainOf(toRoot(target));
          log.step("Enriching " + domain);

          // Optional fresh page extraction to discover new people before guessing.
          let freshPeople: Person[] = [];
          if (doExtract) {
            const opts = defaultRunOptions(cfg);
            opts.limit = numFlag(flags, "limit", opts.limit);
            opts.extract = extractMode(flags.extract as string);
            opts.verify = false;
            const extraction = await extractContactsFromSite(cfg, target, opts);
            freshPeople = extraction.contacts
              .filter((c: any) => c.person_name && !c.email)
              .map((c: any) => ({
                name: c.person_name,
                title: c.title,
                linkedin: c.linkedin,
                email: c.email,
                source: "page",
                sourceUrl: extraction.pages[0]?.url,
              }));
            log.info(extraction.contacts.length + " contact(s), " + freshPeople.length + " new person(s) without emails");
          }

          const res = await enrichDomain(db, cfg, domain, {
            people: freshPeople,
            verify: !flags["no-verify"],
            perPerson,
            githubOrgs,
            githubToken: cfg.githubToken,
            meta: { company: domain },
          });
          log.raw("");
          log.raw(`┌─ Enriched ${domain}`);
          log.raw(`│  people          : ${res.people}`);
          log.raw(`│  candidates      : ${res.candidatesGenerated} (${res.candidatesVerified} verified)`);
          log.raw(`│  emails found    : ${res.emailsFound}`);
          log.raw(`│  invalid         : ${res.invalid}`);
          for (const e of (res.emails ?? []).slice(0, 15)) {
            const { grade } = scoreLead({
              emailValid: 1, emailScore: e.pattern === "published" ? null : e.score,
              emailSource: e.pattern === "published" ? "github" : "guessed",
              title: null, companyTier: null,
            });
            log.raw(`│    ${e.email}  [${grade}]  (${e.pattern})`);
          }
          if (res.errors.length) log.raw(`│  errors          : ${res.errors.length} (see --verbose)`);
          log.raw("└─ done");
          for (const e of res.errors) log.warn(domain + ": " + e);
        }
        await db.close();
        return 0;
      }
      case "people": {
        const db = await ensureDb(cfg);
        const rows = await listPeople(db, {
          domain: typeof flags.domain === "string" ? flags.domain : undefined,
          noEmail: !!flags["no-email"],
          limit: numFlag(flags, "limit", 100),
        });
        if (flags.json) console.log(JSON.stringify(rows, null, 2));
        else printPeople(rows);
        await db.close();
        return 0;
      }
      case "employees": {
        if (positionals.length === 0) {
          throw new Error("employees needs at least one domain. e.g. spider-leads employees acme.com");
        }
        const opts = defaultRunOptions(cfg);
        opts.limit = numFlag(flags, "limit", opts.limit);
        opts.mode = requestMode(typeof flags.mode === "string" ? flags.mode : "smart");
        opts.extract = extractMode(typeof flags.extract === "string" ? flags.extract : cfg.spiderExtract);
        opts.verify = flags["no-verify"] ? false : cfg.verifyOnHunt;
        opts.dryRun = !!flags["dry-run"];
        opts.concurrency = numFlag(flags, "concurrency", opts.concurrency);
        opts.guessEmails = flags["no-guess"] ? false : flags.guess ? true : cfg.guessEmails;
        opts.perPerson = numFlag(flags, "per-person", cfg.guessPerPerson);
        if (typeof flags.github === "string") {
          opts.githubOrgs = flags.github.split(",").map((s) => s.trim()).filter(Boolean);
        }
        opts.plugins = plugins;
        const db = await ensureDb(cfg);
        const summary = await findEmployees(db, cfg, positionals, opts);
        printRunSummary(summary);
        const { listLeads: ll } = await import("./db.ts");
        for (const r of await ll(db, { minScore: 0, limit: 10 })) {
          log.raw(`  ${r.email ?? "(no email)"} · ${r.person_name ?? ""} ${r.title ?? ""} @ ${r.company ?? r.domain} [${r.lead_tier ?? "-"} ${r.lead_score ?? ""}]`);
        }
        await db.close();
        return 0;
      }
      case "scrapers": {
        const configs = await listScraperDirectory({
          domain: typeof flags.domain === "string" ? flags.domain : undefined,
          category: typeof flags.category === "string" ? flags.category : undefined,
          limit: numFlag(flags, "limit", 50),
        });
        if (flags.json) {
          console.log(JSON.stringify(configs, null, 2));
          return 0;
        }
        if (configs.length === 0) {
          log.info("No scraper configs found — try without filters.");
          return 0;
        }
        log.raw(`Spider scraper-directory configs (${configs.length}):`);
        log.raw("domain        path                     category       conf   fields  description");
        for (const c of configs) {
          log.raw(
            (c.domain ?? "").padEnd(13) +
            (String(c.path_pattern ?? "").padEnd(24).slice(0, 24)) +
            (String(c.category ?? "").padEnd(15).slice(0, 15)) +
            String(c.confidence_score?.toFixed(2) ?? "").padEnd(7) +
            String(c.fields_count ?? "").padEnd(8) +
            String(c.display_name ?? c.description ?? "").slice(0, 60)
          );
        }
        log.raw("Tip: spider-leads fetch <url> uses these configs automatically (first call bootstraps).");
        return 0;
      }
      case "fetch": {
        const target = positionals[0];
        if (!target) throw new Error("fetch needs a URL, e.g. spider-leads fetch https://zillow.com/homes/");
        const data = await fetchStructured(cfg, target, {
          returnFormat: typeof flags.format === "string" ? flags.format : undefined,
          limit: numFlag(flags, "limit", 1),
          readability: !!flags.readability,
        });
        if (flags.json) {
          console.log(JSON.stringify(data, null, 2));
          return 0;
        }
        log.raw("URL: " + data.url + "  (HTTP " + data.status + ")");
        if (data.metadata?.title) log.raw("Title: " + data.metadata.title);
        if (data.metadata?.description) log.raw("Description: " + data.metadata.description.slice(0, 200));
        let items: any = data.css_extracted;
        if (items == null && typeof data.content === "string") {
          log.raw("");
          log.raw(data.content.slice(0, 3000));
        }
        if (items != null) {
          const list = Array.isArray(items) ? items : Array.isArray((items as any).items) ? (items as any).items : [items];
          log.raw("");
          log.raw("Items (" + list.length + "):");
          for (const it of list.slice(0, 20)) {
            const str = typeof it === "string"
              ? it
              : Object.values(it as Record<string, unknown>).slice(0, 5).map((v) => String(v ?? "")).filter(Boolean).join(" · ");
            log.raw("  - " + str.slice(0, 180));
          }
        }
        log.raw("Links: " + (data.links?.length ?? 0));
        return 0;
      }
      case "agent": {
        const objective = positionals.join(" ");
        if (!objective) throw new Error("agent needs an objective. e.g. spider-leads agent \"find fintech companies interested in AI and verify their emails\"");
        if (!cfg.openaiApiKey) throw new Error("agent mode needs an AI key (OPENAI_API_KEY or any OpenAI-compatible provider). deepseek-chat and OpenAI support function calling.");
        const db = await ensureDb(cfg);
        const result = await runAgent(db, cfg, objective, {
          maxTurns: numFlag(flags, "max-turns", 20),
          limit: numFlag(flags, "limit", 10),
          dryRun: !!flags["dry-run"],
          extraTools: plugins.flatMap((p) => p.tools),
        });
        log.raw("");
        log.raw("┌─ Agent run: " + objective);
        log.raw("│  turns        : " + result.turns);
        log.raw("│  tool calls   : " + result.toolCalls.map((t) => t.tool + "×" + t.count).join(", "));
        log.raw("│  stored       : " + result.stored + "  (updated " + result.updated + ")");
        log.raw("│  verified     : " + result.verified);
        log.raw("│  invalid      : " + result.invalid);
        log.raw("│  errors       : " + result.errors.length);
        log.raw("└─ summary: " + result.final);
        await db.close();
        return 0;
      }
      case "verify": {
        const db = await ensureDb(cfg);
        const res = await verifyStored(db, cfg, {
          limit: numFlag(flags, "limit", 1000),
          status: typeof flags.status === "string" ? flags.status : undefined,
          concurrency: numFlag(flags, "concurrency", 5),
        });
        log.ok(`Done — checked ${res.checked}, valid ${res.verified}, invalid ${res.invalid}, failed ${res.failed}`);
        await db.close();
        return 0;
      }
      case "list": {
        const db = await ensureDb(cfg);
        let rows;
        if (typeof flags["related-to"] === "string") {
          rows = await leadsRelatedTo(db, flags["related-to"], {
            limit: numFlag(flags, "limit", 50),
            minScore: numFlag(flags, "min-score", 0),
          });
        } else {
          rows = await listLeads(db, {
            category: typeof flags.category === "string" ? flags.category : undefined,
            status: typeof flags.status === "string" ? flags.status : undefined,
            emailType: typeof flags.type === "string" ? flags.type : undefined,
            emailSource: typeof flags.source === "string" ? flags.source : undefined,
            interest: typeof flags.interest === "string" ? flags.interest : undefined,
            department: typeof flags.department === "string" ? flags.department : undefined,
            tier: typeof flags.tier === "string" ? flags.tier : undefined,
            minScore: numFlag(flags, "min-score", 0) || undefined,
            decisionMaker: flags["decision-maker"] ? true : undefined,
            limit: numFlag(flags, "limit", 50),
          });
        }
        if (flags.json) console.log(JSON.stringify(rows, null, 2));
        else printLeads(rows);
        await db.close();
        return 0;
      }
      case "score": {
        const db = await ensureDb(cfg);
        const rows = await listLeads(db, { limit: 100000 });
        let updated = 0, skipped = 0;
        for (const r of rows) {
          if (!r.email) { skipped++; continue; }
          let interests: string[] = [];
          try {
            const parsed = JSON.parse(r.interests ?? "[]");
            interests = Array.isArray(parsed) ? parsed.map((i: any) => typeof i === "string" ? i : i?.topic ?? "") : [];
          } catch { /* ignore */ }
          const cls = classifyTitle(r.title);
          const icp = icpMatch(r.category, interests, cfg.icpCategories, cfg.icpInterests);
          const { score, grade } = scoreLead({
            emailValid: r.email_valid,
            emailScore: r.email_score,
            emailSource: r.email_source,
            companyTier: r.tier,
            companyConfidence: r.confidence,
            icpMatch: icp,
            title: r.title,
          });
          await updateLeadScore(db, r.email, {
            department: cls.department, seniority: cls.seniority,
            decisionMaker: cls.decisionMaker, leadScore: score, leadTier: grade, icpMatch: icp,
          });
          updated++;
        }
        log.ok(`Scored ${updated} lead(s) (${skipped} skipped — no email)`);
        await db.close();
        return 0;
      }
      case "relations": {
        const db = await ensureDb(cfg);
        const targets = positionals.length > 0 ? positionals : await (async () => {
          const res = await db.execute("SELECT DISTINCT from_domain AS domain FROM company_relations");
          return (res.rows as unknown as { domain: string }[]).map((r) => r.domain);
        })();
        if (targets.length === 0) {
          log.info("No relationships recorded yet — run hunt/search first (AI extraction) or relations <domain>.");
          await db.close();
          return 0;
        }
        for (const target of targets) {
          const domain = domainOf(toRoot(target));
          const rows = await relationsForDomain(db, domain);
          if (flags.json) {
            console.log(JSON.stringify({ domain, relations: rows }, null, 2));
            continue;
          }
          log.raw(`Relations for ${domain} (${rows.length}):`);
          for (const r of rows) {
            log.raw(`  [${r.type}] ${r.target}${r.target_domain ? " (" + r.target_domain + ")" : ""} — conf ${r.confidence?.toFixed(2)}`);
            if (r.evidence) log.raw(`      ${r.evidence.slice(0, 140)}`);
          }
          // Related leads: contacts at companies that interact with this one.
          const related = await leadsRelatedTo(db, domain, { limit: 20 });
          if (related.length > 0) {
            log.raw(`Leads at related companies (${related.length}):`);
            for (const l of related) {
              log.raw(`  ${l.email ?? ""}  ${l.person_name ?? ""}  @ ${l.company}  [${l.lead_tier ?? ""} ${l.lead_score ?? ""}]`);
            }
          }
        }
        await db.close();
        return 0;
      }
      case "stats": {
        const db = await ensureDb(cfg);
        const s = await dbStats(db);
        if (flags.json) {
          console.log(JSON.stringify(s, null, 2));
        } else {
          log.raw(`Total: ${s.totals.total}  |  valid: ${s.totals.valid ?? 0}  |  invalid: ${s.totals.invalid ?? 0}  |  unverified: ${s.totals.unverified ?? 0}`);
          log.raw(`People: ${s.people ?? 0}`);
          log.raw("By status:");
          for (const r of s.byStatus) log.raw(`  ${r.status.padEnd(10)} ${r.n}`);
          log.raw("By category:");
          for (const r of s.byCategory) log.raw(`  ${String(r.category).padEnd(30)} ${r.n}`);
          log.raw("By email type:");
          for (const r of s.byEmailType ?? []) log.raw(`  ${String(r.email_type).padEnd(12)} ${r.n}`);
          log.raw("By email source:");
          for (const r of s.bySource ?? []) log.raw(`  ${String(r.email_source).padEnd(12)} ${r.n}`);
          log.raw("By lead grade:");
          for (const r of s.byGrade ?? []) log.raw(`  ${String(r.lead_tier).padEnd(12)} ${r.n}`);
          log.raw("Top interests:");
          for (const r of s.topInterests ?? []) log.raw(`  ${String(r.topic).padEnd(32)} ${r.n}`);
        }
        await db.close();
        return 0;
      }
      case "export": {
        const file = typeof flags.output === "string" ? flags.output : positionals[0];
        if (!file) throw new Error("export needs an output path. e.g. spider-leads export leads.csv");
        const fmt = (typeof flags.format === "string" ? flags.format : file.endsWith(".json") ? "json" : "csv").toLowerCase();
        const db = await ensureDb(cfg);
        const rows = await listLeads(db, { limit: 100000 });

        // Plugin exporters: --exporter <id>
        if (typeof flags.exporter === "string") {
          const exporter = plugins.flatMap((p) => p.exporters).find((e) => e.id === flags.exporter);
          if (!exporter) throw new Error("No plugin exporter with id '" + flags.exporter + "' (see 'plugins list')");
          const out = await exporter.export(rows);
          await import("node:fs/promises").then((fs) => fs.writeFile(file, out.content));
          log.ok("Wrote " + rows.length + " lead(s) to " + file + " via plugin exporter '" + exporter.id + "'");
          await db.close();
          return 0;
        }
        const cols = ["email", "email_source", "person_name", "title", "company", "domain", "email_type", "category", "tier",
          "department", "seniority", "decision_maker", "lead_score", "lead_tier", "icp_match",
          "status", "interests", "source_url", "created_at"];
        const csv = [
          cols.join(","),
          ...rows.map((r) =>
            cols
              .map((k) => {
                const v = String((r as unknown as Record<string, unknown>)[k] ?? "");
                return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
              })
              .join(",")
          ),
        ].join("\n");
        await import("node:fs/promises").then((fs) => fs.writeFile(file, fmt === "json" ? JSON.stringify(rows, null, 2) : csv));
        log.ok(`Wrote ${rows.length} lead(s) to ${file} (${fmt})`);
        await db.close();
        return 0;
      }
      default:
        throw new Error(`Unknown command: ${command}. Run 'spider-leads help'.`);
    }
  } catch (err) {
    log.error((err as Error).message);
    if (cfg.verbose) console.error(err);
    return 1;
  }
}

process.exit(await main());