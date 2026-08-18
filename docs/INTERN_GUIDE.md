# Spider Leads & Scraper — Intern Guide

> A friendly, complete walkthrough of the Spider project: what it does, how to set it up,
> how to use it day-to-day, how it works under the hood, and how to extend it. Read this
> top to bottom once, then use it as a reference.

---

## 1. What is this project?

This repository contains **two ways to use one product**:

1. **A Chrome/Firefox browser extension** (the top-level folder) — scrape pages, crawl sites,
   search the web, and run a full **Lead Finder** (find contacts → categorize → store → verify) from
   the side panel.
2. **A command-line tool** (`spider-leads/`) — the same engine as a CLI you can script,
   schedule, or run on a server.

Both share the **same pipeline code**. The CLI sources (`spider-leads/src/*.ts`) are bundled
into `vendor/leads-core.js`, which the extension imports. One codebase, two interfaces.

```
┌───────────────────────────  SPIDER CLOUD  ───────────────────────────┐
│  /links  /scrape  /crawl  /search   (anti-bot + JS rendering handled)│
└───────────────┬──────────────────────────────────────┬──────────────┘
                │                                      │
   ┌────────────▼───────────┐              ┌───────────▼───────────┐
   │  spider-leads pipeline │              │  AI (your own key)    │
   │  hunt / search / agent │              │  OpenAI / DeepSeek /  │
   │  extract + classify    │              │  Groq / Ollama        │
   └────────────┬───────────┘              │  - categorize company │
                │                          │  - tag interests      │
                │                          │  - agent tool calling │
   ┌────────────▼───────────┐              └───────────────────────┘
   │   TURSO (SQLite DB)    │      ┌──────────────────────────────┐
   │   leads + runs tables  │      │  PLUNK (/v1/verify)          │
   │   dedup by email       │─────▶│  valid / disposable / MX …   │
   └────────────────────────┘      └──────────────────────────────┘
```

**The one-sentence summary:** point it at websites (or give the AI an objective), it scrapes
them, extracts contact info, categorizes each company + tags interests, types each email
(corporate / business / student / personal), stores everything in Turso, and double-checks
each email with Plunk.

---

## 2. The services (what each external piece does)

| Service | Role in this project | Where to get it | Cost model |
| --- | --- | --- | --- |
| **Spider Cloud** | Crawling/scraping/searching the web. Handles anti-bot protection, JS-rendered pages, proxies. | spider.cloud (API keys page) | $1 per 10,000 credits; **failed pages cost 0**; free balance on signup |
| **AI provider** (OpenAI / DeepSeek / Groq / Ollama) | Company categorization, interest tagging, contact extraction, and the **agent mode** (tool calling). Any OpenAI-compatible API works. | DeepSeek: platform.deepseek.com — `deepseek-chat` (JSON mode) or `deepseek-v4-flash` (function calling) | per-token |
| **Turso** | The database. `@libsql/client` connects to `libsql://` databases (or a local `file:` SQLite for development). | turso.tech (free tier) | free tier: 9 GB |
| **Plunk** | Email verification: is the address valid? disposable? personal? does the domain have MX records? | useplunk.com → API key `sk_*` | free tier, then pay-per-verify |

> **Key idea:** your keys never go anywhere except directly to the provider. The extension
> stores them in `chrome.storage.sync`; the CLI reads them from `.env`. Spider Cloud never
> sees your OpenAI or Plunk keys.

---

## 3. Repository map

```
.
├── manifest.json              Chrome (MV3) manifest
├── manifest.firefox.json      Firefox manifest (background.scripts, no sidePanel)
├── background.js              Service worker: routing, side-panel open (Firefox tab fallback)
├── popup/                     Quick Scrape / Crawl / Search + "Find Leads" button
├── sidepanel/                 Full UI: Scrape, Crawl, Search, AI Extract, Leads tabs
├── options/                   Settings: Spider key, BYOK AI, Turso + Plunk
├── lib/                       Extension modules
│   ├── spider-api.js          Spider Cloud REST client (scrape/crawl/search)
│   ├── ai-client.js           BYOK AI calls (OpenAI/Anthropic/Gemini/Ollama presets)
│   ├── leads.js               Lead Finder glue: storage → config → shared pipeline
│   └── utils.js               clipboard, download, formatting helpers
├── vendor/                    leads-core.js — the shared pipeline, bundled for the browser
├── scripts/                   build-firefox.mjs (→ dist/firefox/)
├── spider-leads/              THE CLI + shared pipeline (Node ≥ 24, runs TS natively)
│   ├── src/
│   │   ├── index.ts           CLI entry (hunt/search/agent/verify/list/stats/export)
│   │   ├── pipeline.ts        Orchestration: links → filter → scrape → extract → store → verify
│   │   ├── agent.ts           The AI agent loop (function calling)
│   │   ├── tools.ts           The tools the agent can call
│   │   ├── spider.ts          Spider Cloud API client
│   │   ├── ai.ts              AI calls: categorization, interests, chat-with-tools
│   │   ├── extract.ts         Regex extraction + email-type classifier + URL filters
│   │   ├── plunk.ts           Plunk /v1/verify client
│   │   ├── db.ts              Turso schema, upserts, queries, stats
│   │   ├── config.ts / types.ts / log.ts
│   ├── scripts/mock-api.ts    Local fake of Spider + Plunk + OpenAI (testing without keys!)
│   └── README.md / .env.example
└── docs/INTERN_GUIDE.md       This document
```
---

## 4. Core concepts

### The lead lifecycle

```
new ──▶ verified   (Plunk says the address is valid)
  │
  ├──▶ invalid    (Plunk says it fails — no MX, nonexistent, …)
  └──▶ error      (verification itself failed)
```

### Email types (computed automatically for every email)

| Type | Meaning | Examples |
| --- | --- | --- |
| `corporate` | A person at a company domain | sarah@acme.com |
| `business` | A role mailbox at a company domain | info@, sales@, hello@ |
| `student` | An education-domain address | .edu, .ac.uk, .edu.cn |
| `personal` | A free personal mail provider | gmail.com, outlook.com, proton.me |

### Categories vs Interests

- **Category** = what the *company* is (industry): `SaaS / Software`, `Agency / Services`,
  `E-commerce / Retail`, `Finance / Insurance`, … (14 options, one per company).
- **Interests** = topics the company/site signals it cares about: `AI / Machine Learning`,
  `Cloud / DevOps`, `Sustainability`, `Fintech / Web3`, … (up to 8 per company, each with a
  confidence score).
- Both come from **one AI call per company** (cheap), with a **keyword-rule fallback** when
  no AI key is configured.

### Runs

Every `hunt`/`search`/`agent` execution is recorded in the `runs` table: target, pages
crawled, leads found/verified/invalid, errors. Useful for auditing and cost tracking.

### Deduplication

Leads are keyed by **lowercased email** (unique index). Re-hunting the same site updates
existing rows instead of creating duplicates (`new` vs `updated` in the run summary).

---

## 5. Setup — step by step

### 5.1 Get API keys

1. **Spider Cloud** — sign up at spider.cloud, create an API key (`sp_…`).
2. **Turso** — `turso db create leads`, then grab the URL and a token:
   ```bash
   turso db show leads --url            # libsql://leads-<you>.turso.io
   turso db tokens create leads         # eyJ…
   ```
3. **Plunk** — sign up, create a secret API key (`sk_…`).
4. **AI** — any OpenAI-compatible key. Recommended: DeepSeek `deepseek-v4-flash`
   (function calling + reasoning, cheap).

### 5.2 CLI

```bash
cd spider-leads
npm install
cp .env.example .env        # then fill in the keys with your editor
npm start -- init-db        # creates the leads + runs tables
```

> No Turso yet? Just omit `TURSO_URL` — the CLI falls back to a local file
> `leads.db` (SQLite) and prints a warning. Perfect for learning.

### 5.3 Extension (Chrome)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → this repo folder.
2. Right-click the 🕷 icon → **Options** (or the ⚙ in the panel):
   - **Spider Cloud API key** (required)
   - **BYOK AI** — provider + key; for DeepSeek set endpoint
     `https://api.deepseek.com/v1/chat/completions` and model `deepseek-v4-flash`
   - **Lead Finder** — Turso URL + token, Plunk key
3. Open the side panel (`Ctrl+Shift+Z`) → **Leads** tab.

### 5.4 Extension (Firefox)

Firefox has no `chrome.sidePanel` API and no MV3 service workers, so there is a
Firefox-flavored build (panel opens in a tab instead):

```bash
npm run build:firefox        # → dist/firefox/
npx web-ext run --source-dir dist/firefox        # launches Firefox with it
# or load manually: about:debugging#/runtime/this-firefox → Load Temporary Add-on
```

`npm run lint:firefox` runs Mozilla's official validator (web-ext lint) — keep it at 0 errors.

---

## 6. Your first run (CLI walkthrough)

```bash
cd spider-leads
npm start -- hunt acme.com --limit 10
```

What happens, step by step:

1. `POST /links` asks Spider Cloud for internal links of acme.com.
2. The pipeline **filters** to contact-likely pages (`/team`, `/about`, `/contact`, `/careers`…)
   — or pages matching your `--filter` regex.
3. Those pages are **scraped** as markdown (up to `--limit` pages, `--concurrency` at a time).
4. Contacts are **extracted** — Spider AI pipeline first (`auto` mode), then your AI key,
   then regex. Placeholder/fake emails are rejected.
5. One AI call **categorizes** the company (category + tier + interests).
6. Every email is **typed** (corporate/business/student/personal) and **stored** in Turso.
7. If `VERIFY_ON_HUNT=true` (default) and Plunk is configured, new emails are **verified**
   and their status is written back.

Then inspect:

```bash
npm start -- list                 # table of leads
npm start -- list --type corporate --status verified
npm start -- stats                # totals by status / category / email type / interests
npm start -- export leads.csv     # or leads.json
```

---

## 7. Recipes (common tasks)

| Task | Command |
| --- | --- |
| Corporate contacts from a company | `npm start -- hunt acme.com` then `npm start -- list --type corporate` |
| Business mailboxes (info@, sales@) | `npm start -- list --type business` |
| Student emails | `npm start -- hunt stanford.edu` → `list --type student` |
| Personal emails | `npm start -- search --query "founder" --limit 20` → `list --type personal` |
| Leads interested in AI | `npm start -- list --interest "AI / Machine Learning"` |
| Hunt with a custom URL filter (big sites) | `npm start -- hunt acme.com --filter '/(team|about|contact)/'` |
| Skip verification / rehearsal | `--no-verify` / `--dry-run` |
| AI agent does everything | `npm start -- agent "find fintech companies interested in AI and verify their emails"` |

---

## 8. Command & flag reference

| Command | Purpose |
| --- | --- |
| `init-db` | Create tables |
| `hunt <domain...>` | Crawl sites → extract → categorize → store → verify |
| `search <query>` | Web search, then the same pipeline over result pages |
| `agent <objective>` | AI drives everything via tool calling |
| `verify` | Verify stored `new` leads with Plunk |
| `list` | Show leads (`--status`, `--category`, `--type`, `--interest`, `--json`) |
| `stats` | Summary counts |
| `export <file>` | CSV/JSON export (`--format`) |

| Flag | Meaning |
| --- | --- |
| `-l, --limit N` | Max pages/leads per target (default 30) |
| `-d, --depth N` | Crawl depth (default 2) |
| `-m, --mode MODE` | `smart` or `http` (fast/cheap) or `browser` (JS-heavy sites) |
| `-e, --extract MODE` | `auto` (try Spider AI, fall back) or `local` or `spider` |
| `-f, --filter REGEX` | Only extract from matching URLs |
| `-c, --concurrency N` | Parallel fetches/verifications (default 4–5) |
| `--max-turns N` | Agent turn budget (default 20) |
| `--no-verify` | Skip Plunk verification |
| `--dry-run` | Rehearse — nothing written to the DB |
| `-v, --verbose` | Debug logging |
---

## 9. The AI agent mode (deep dive)

This is the most interesting part. Instead of a fixed pipeline, you give the model an
**objective** and it decides what to do, calling tools in a loop:

```
you ──▶ "find fintech companies interested in AI and verify their emails"
         │
         ▼  (loop, up to --max-turns)
   model requests tool calls ──▶ tools execute ──▶ results fed back ──┐
         ▲                                                          │
         └──────────────────────────────────────────────────────────┘
         │
         └──▶ model replies with a summary (no more tool calls) → done
```

### The 7 tools

| Tool | Description |
| --- | --- |
| `search_web` | Find target sites from a query |
| `crawl_site` / `get_links` | Enumerate + crawl a site |
| `extract_contacts` | Scrape contact pages → typed contacts |
| `categorize_company` | Industry + interests + tier |
| `store_leads` | Upsert to Turso (validation + typing built in) |
| `verify_email` | Plunk check, persisted to the stored lead |
| `query_leads` | Search what's already stored |

### Requirements & guardrails

- Needs a **function-calling-capable model**: OpenAI (gpt-4o…), **DeepSeek `deepseek-chat` or
  `deepseek-v4-flash`** (NOT `deepseek-reasoner`), Groq, or Ollama models with tool support.
- The model **cannot fabricate data that gets stored**: `store_leads` validates emails;
  `verify_email` only reports what Plunk says.
- Every tool error is fed back to the model (it can retry or explain) instead of crashing.
- The agent uses the same extraction code as `hunt`, so results are equally trustworthy.

---

## 10. The database (Turso)

Two tables. The `leads` table columns:

| Group | Columns |
| --- | --- |
| Identity | `id`, `email` (unique, lowercased), `person_name`, `title`, `phone`, `linkedin`, `company`, `domain` |
| Classification | `category`, `subcategory`, `tier`, `confidence`, `email_type`, `interests` (JSON) |
| Provenance | `source` (hunt/search/agent), `source_url`, `raw_data` (JSON), `created_at`, `updated_at` |
| Verification | `status` (new/verified/invalid/error), `email_valid`, `is_disposable`, `is_personal_email`, `has_mx_records`, `is_typo`, `plunk_reasons`, `verified_at` |

`runs` — one row per execution: target, pages, leads found/verified/invalid, errors.

Tip: query it directly with the `turso` CLI or any SQLite tool — it's just SQL.

---

## 11. Testing without any API keys (the mock)

`spider-leads/scripts/mock-api.ts` pretends to be Spider Cloud + Plunk + an OpenAI-compatible
API on `http://127.0.0.1:8787`. It even speaks the agent's function-calling protocol,
so you can test **everything** offline:

```bash
cd spider-leads
PORT=8787 node scripts/mock-api.ts        # terminal 1

# terminal 2:
export SPIDER_API_KEY=test SPIDER_API_BASE=http://127.0.0.1:8787
export OPENAI_API_KEY=test OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_MODEL=mock-gpt
export PLUNK_API_KEY=sk_test PLUNK_API_BASE=http://127.0.0.1:8787
export TURSO_URL=file:demo.db VERIFY_ON_HUNT=true

node src/index.ts init-db
node src/index.ts hunt acme.com stanford.edu --limit 8
node src/index.ts list --type student
node src/index.ts agent "find companies and verify emails"
```

Rules of thumb for development: if it works against the mock, the only things left to
test with real keys are quotas, rate limits, and real-world anti-bot behavior.

---

## 12. Common errors & troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SPIDER_API_KEY is not set` | Missing env | Add to `.env` (CLI) or Options (extension) |
| Spider `401 Not authorized` | Bad/expired key or no plan for that endpoint | Check key; `/pipeline/extract-contacts` is legacy — `SPIDER_EXTRACT=local` avoids it |
| `PLUNK_API_KEY is not set` | Missing Plunk key | Set it, or run with `--no-verify` |
| AI `400 … response_format` | Model doesn't support JSON mode (e.g. deepseek-reasoner) | The code auto-retries without JSON mode; or use `deepseek-chat`/`gpt-4o-mini` |
| `AI tool call failed (400) … not supported` | Model can't do function calling | Use OpenAI / DeepSeek `deepseek-chat` or `deepseek-v4-flash` / Groq |
| Turso connection errors | Wrong URL/token, or custom domain not in `host_permissions` (extension) | Check `TURSO_URL`/token; extension uses `https://…` (libsql:// is converted) |
| Empty results / 0 leads | Site has no contact pages, JS-heavy, or blocked | `-m browser`, raise `--limit`, use `--filter`, try `search` instead |
| Cost worries | Crawling too much | `-m http` is cheapest, `--filter` limits pages, `SPIDER_EXTRACT=local` avoids Spider AI credits; failed pages cost 0 |
| `list` shows old data | DB is local file | Check the warning line — real Turso needs `TURSO_URL`/token |

### Debugging tips

- `-v` (verbose) shows every request and tool call.
- `--dry-run` rehearses without writing anything.
- The extension shows errors in the panel's status bar; the DevTools console of the panel
  (right-click → Inspect) has full stack traces.
---

## 13. Extending the project

### Adding a new agent tool

1. Open `spider-leads/src/tools.ts`, add a `Tool` object to `buildTools()`:
   a JSON-schema `parameters` object, a `description` (the model reads it!), and a `run(args)`
   that returns a JSON string.
2. It appears automatically in agent mode (tools are serialized from the registry).
3. Typecheck: `cd spider-leads && npx tsc --noEmit`.
4. Rebuild the extension bundle: `npm run build:vendor` (from the repo root).
5. Reload the extension, re-run `npm run build:firefox` if you test Firefox.

### Browser assistant (Assist tab)

The AI can act on the page you're viewing — but only with **per-action approval**: it proposes
(navigate, fill_form, set_text, click, scroll_to), you Approve/Deny each. Enforced rails: no
submit/send actions exist; visa/salary/demographic fields are never auto-filled; per-site
allowlist (with runtime permission request); Stop button. Files: `lib/assist.js` (loop),
`lib/browser-assist.js` (execution + allowlist), `lib/assist-page.js` (page-context helpers —
self-contained, also unit-tested in Node with a fake DOM).

### Career assist + AI plugin builder

- The **Career** tab (side panel) builds a profile from a resume (PDF/DOCX/TXT parsed locally),
  tailors resume + cover letter to a pasted job, scores fit, and drafts email/LinkedIn outreach.
  The user reviews and sends — nothing is auto-submitted (job boards/LinkedIn prohibit bots, and
  the attestation must come from the real applicant).
- Options → Plugins → **Generate a plugin with AI** lets non-developers describe a plugin in
  plain language; the AI writes the JSON, they review and install.

### Writing a plugin

Plugins add agent tools, pipeline hooks (beforeRun / onLead / afterRun), and exporters
without touching core code. Drop a folder with `plugin.json` + `index.ts` into
`spider-leads/plugins/` (see the shipped examples: `jobs-ats`, `webhook-leads`,
`exporter-jsonl`), then `spider-leads plugins list` to verify. Details in the
spider-leads README ("Plugin system"). Plugins are trusted code — audit before installing.

### Changing extraction or classification logic

- Email type rules: `spider-leads/src/extract.ts` (`PERSONAL_DOMAINS`, `ROLE_LOCAL_PARTS`, `classifyEmailType`).
- Interest keyword rules: `spider-leads/src/ai.ts` (`INTEREST_RULES`).
- Contact-URL patterns: `CONTACT_PATH_RE` in `extract.ts`.

### The build pipeline (repo root)

```bash
npm run build:vendor     # spider-leads/src/*.ts → vendor/leads-core.js (browser bundle)
npm run build:firefox    # → dist/firefox/ (Firefox manifest + files)
npm run lint:firefox     # web-ext lint — must stay 0 errors
npm run typecheck        # cd spider-leads && tsc --noEmit
```

### Testing checklist before you say "done"

1. `npm run typecheck` clean
2. New/changed behavior works against the **mock** (offline)
3. `npm run build:vendor` + `npm run build:firefox` if shared pipeline code changed
4. Extension: reload and click through the affected tab; check the console
5. `npm run lint:firefox` → 0 errors

---

## 14. Good habits & ethics checklist

- **Only scrape sites you're allowed to** (check `robots.txt` and the site's terms). Spider
  Cloud respects robots.txt when configured.
- **Only email people who would reasonably expect it.** Verification (Plunk) confirms an
  address exists — it does not give you permission to contact it. Know CAN-SPAM/GDPR basics
  before sending anything.
- **Be mindful of costs** — start with `--limit 10` and `--dry-run`; watch the `costs` field
  and your Spider balance page.
- **Keys are secrets** — never commit `.env` (it's gitignored), never paste keys into chat/PRs.
- **Keep the mock updated** when you change API behavior — it's how the next intern tests.
- **Write things down** — if a command surprised you, add it to this guide.

---

## 15. Quick answers

- *How do I try it fastest?* Mock server + `file:` DB (no keys, no money).
- *What's the difference between hunt and search?* `hunt` crawls sites you name; `search`
  finds sites from a query first.
- *Why is the email marked `business` and not `corporate`?* Role mailboxes (info@, sales@)
  are `business`; person-named addresses at company domains are `corporate`.
- *Do I need an AI key?* Not strictly — extraction falls back to regex and categorization to
  keyword rules. But AI makes results dramatically better.
- *Extension or CLI?* Extension for interactive use; CLI for scripts, schedules, and servers.