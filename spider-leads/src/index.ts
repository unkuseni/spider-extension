#!/usr/bin/env node
// spider-leads CLI — find leads, categorize with AI, store in Turso, verify with Plunk.

import type { Config } from "./config.ts";
import { extractMode, loadConfig, requestMode } from "./config.ts";
import {
  defaultRunOptions, ensureDb, hunt, huntSearch, verifyStored,
} from "./pipeline.ts";
import { runAgent } from "./agent.ts";
import { discoverPluginsDir, installJsonPluginFile, loadPlugins, resolveNamedFilter } from "./plugins.ts";
import type { Plugin } from "./types.ts";
import { dbStats, listLeads } from "./db.ts";
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
  { name: "interest", alias: "i", takesValue: true },
  { name: "format", alias: "F", takesValue: true },
  { name: "output", alias: "o", takesValue: true },
  { name: "plugins-dir", takesValue: true },
  { name: "exporter", takesValue: true },
  { name: "query", alias: "q", takesValue: true },
  { name: "verify", takesValue: false },
  { name: "no-verify", takesValue: false },
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
  agent <objective>       Let the AI drive the whole workflow via tool calling
                          (search_web, extract_contacts, categorize_company, verify_email, store_leads…)
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
      --max-turns N    Agent turn budget (default 20)
      --plugins-dir P   Plugin directory (default: ./plugins or $SPIDER_PLUGINS_DIR)
      --exporter ID     Use a plugin exporter for 'export' (e.g. --exporter jsonl)
  -s, --status ST      Filter by status: new | verified | invalid | error
  -C, --category CAT   Filter by industry category
  -t, --type TYPE      Filter by email type: corporate | business | student | personal
  -i, --interest TOPIC Filter by interest topic (substring match)
  -F, --format FMT     csv | json (export)
  -o, --output FILE    Output file (export)
  -q, --query Q        Query text (search)
      --no-verify      Don't verify emails after hunting
      --dry-run        Rehearse a run: fetch + extract, but write nothing to the DB
      --json           Machine-readable output (list/stats)
  -v, --verbose        Verbose debug logging
  -h, --help           This help

ENV (.env — see .env.example)
  SPIDER_API_KEY  TURSO_URL / TURSO_AUTH_TOKEN  PLUNK_API_KEY
  OPENAI_API_KEY (any OpenAI-compatible endpoint)  VERIFY_ON_HUNT
`;

function numFlag(flags: Record<string, string | boolean>, name: string, def: number): number {
  const v = flags[name];
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

function printRunSummary(s: { target: string; source: string; pagesCrawled: number; leadsFound: number; leadsNew: number; leadsUpdated: number; leadsVerified: number; leadsInvalid: number; errors: string[] }): void {
  log.raw("");
  log.raw(`┌─ Run complete: ${s.target} (${s.source})`);
  log.raw(`│  pages crawled : ${s.pagesCrawled}`);
  log.raw(`│  leads found   : ${s.leadsFound}  (new ${s.leadsNew}, updated ${s.leadsUpdated})`);
  log.raw(`│  verified      : ${s.leadsVerified}`);
  log.raw(`│  invalid       : ${s.leadsInvalid}`);
  if (s.errors.length) log.raw(`│  errors        : ${s.errors.length} (see --verbose)`);
  log.raw(`└─ run id: ${(s as any).id ?? "-"}`);
}

function printLeads(rows: any[]): void {
  if (rows.length === 0) {
    log.info("No leads found.");
    return;
  }
  const cols = ["email", "person_name", "title", "company", "type", "category", "status", "email_valid"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const pad = (s: string, w: number) => s.padEnd(w);
  log.raw(cols.map((c, i) => pad(c, widths[i])).join("  "));
  log.raw(cols.map((_, i) => "-".repeat(widths[i])).join("  "));
  for (const r of rows) {
    const vals = cols.map((c, i) => {
      let v = String(c === "type" ? (r as any).email_type ?? "" : r[c] ?? "");
      if (c === "email_valid") v = v === "1" ? "✓" : v === "0" ? "✗" : "";
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
        const rows = await listLeads(db, {
          category: typeof flags.category === "string" ? flags.category : undefined,
          status: typeof flags.status === "string" ? flags.status : undefined,
          emailType: typeof flags.type === "string" ? flags.type : undefined,
          interest: typeof flags.interest === "string" ? flags.interest : undefined,
          limit: numFlag(flags, "limit", 50),
        });
        if (flags.json) console.log(JSON.stringify(rows, null, 2));
        else printLeads(rows);
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
          log.raw("By status:");
          for (const r of s.byStatus) log.raw(`  ${r.status.padEnd(10)} ${r.n}`);
          log.raw("By category:");
          for (const r of s.byCategory) log.raw(`  ${String(r.category).padEnd(30)} ${r.n}`);
          log.raw("By email type:");
          for (const r of s.byEmailType ?? []) log.raw(`  ${String(r.email_type).padEnd(12)} ${r.n}`);
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
        const cols = ["email", "person_name", "title", "phone", "company", "domain", "email_type", "category", "tier", "status", "interests", "source_url", "created_at"];
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