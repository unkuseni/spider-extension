# spider-leads

**Find B2B leads → categorize them with AI → store in Turso → verify emails with Plunk.**

A zero-config CLI that turns company domains (or search queries) into a clean, deduplicated,
AI-categorized lead database — with every email checked for validity via Plunk before you
ever put it in a CRM.

```
┌──────────────┐   ┌──────────────────────┐   ┌─────────┐   ┌────────────────┐
│ spider.cloud │ → │ AI / regex extraction│ → │  Turso  │ → │  Plunk /v1/verify│
│  /links      │   │ + AI categorization  │   │ (libsql)│   │  emails         │
│  /scrape     │   └──────────────────────┘   └─────────┘   └────────────────┘
└──────────────┘
```

## How it works

1. **Find** — for each target domain: `POST /links` enumerates the site, then only
   contact-likely pages (`/team`, `/about`, `/contact`, `/careers`…) are scraped as
   markdown (Spider Cloud handles anti-bot + JS rendering). `search` finds prospects
   from a web query instead.
2. **Extract** — contacts (name, email, title, phone, LinkedIn) are pulled either by
   Spider's AI pipeline (`/v1/pipeline/extract-contacts`), by your own AI key, or by
   regex as a last resort. Placeholder/fake emails are filtered out.
3. **Categorize** — one AI call per company classifies it (SaaS, Agency, E-commerce…)
   with confidence + tier, and tags its **interests** (e.g. "AI / Machine Learning",
   "Cloud / DevOps", "Sustainability") — keyword rules kick in if no AI key is set.
4. **Type each email** — every address is classified:
   `corporate` (person@company), `business` (info@/sales@ mailboxes),
   `student` (.edu / .ac.uk / university domains), or `personal` (gmail, outlook, iCloud…).
5. **Store** — every lead is upserted into Turso (deduped by email), alongside the raw
   record, category, email type, interests, and source URL.
5. **Verify** — each new email is sent to Plunk's `POST /v1/verify` endpoint; results
   (valid, disposable, personal, MX records, typo) are stored with the lead. Invalid
   emails are marked `invalid` and can be filtered out of exports.

## Requirements

- Node.js ≥ 24 (runs TypeScript natively — no build step)
- API keys: **Spider Cloud** (free balance on signup), **Turso** (free tier), **Plunk**,
  and any **OpenAI-compatible** key (OpenAI, Groq, Ollama, LM Studio…)

## Setup

```bash
cd spider-leads
npm install
cp .env.example .env   # fill in SPIDER_API_KEY, TURSO_URL, TURSO_AUTH_TOKEN, PLUNK_API_KEY, OPENAI_API_KEY
```

Create a Turso database if you don't have one:

```bash
turso db create leads && turso db show leads --url && turso db tokens create leads
```

Then initialize the schema:

```bash
npm start -- init-db
```

No Turso yet? The app falls back to a local SQLite file (`file:leads.db`) and prints a
warning — perfect for trying things out.

## Usage

```bash
# Crawl one or more sites and extract leads (auto-verifies with Plunk)
npm start -- hunt acme.com globex.io --limit 30

# Custom URL filter for big sites (only /team, /about, /contact pages)
npm start -- hunt acme.com --filter '/(team|about|contact|careers)/'

# Find prospects from a search query
npm start -- search --query "plumbing companies in Austin" --limit 20

# Let the AI drive the whole workflow (function calling / tool use)
npm start -- agent "find fintech companies interested in AI and verify their emails"

# Verify stored leads (default: status 'new')
npm start -- verify --concurrency 5

# Filter by email type: corporate | business | student | personal
npm start -- list --type student
npm start -- list --type corporate --status verified

# Filter by interest topic (substring)
npm start -- list --interest "AI / Machine Learning"
npm start -- list --interest Sustainability --type personal

# Inspect
npm start -- list --category "SaaS / Software" --status verified --limit 100
npm start -- stats
npm start -- export leads.csv
npm start -- export leads.json --format json
```

### Flags

| Flag | Meaning |
| --- | --- |
| `-l, --limit N` | Max pages / leads per target (default 30) |
| `-d, --depth N` | Crawl depth (default 2) |
| `-m, --mode MODE` | `smart` \| `http` \| `browser` (default smart) |
| `-e, --extract MODE` | `auto` (try Spider AI, fall back to local) \| `local` \| `spider` |
| `-f, --filter REGEX` | Only extract from URLs matching REGEX |
| `-t, --type TYPE` | Filter by email type: `corporate` \| `business` \| `student` \| `personal` |
| `-i, --interest TOPIC` | Filter by interest topic (substring match) |
| `-c, --concurrency N` | Concurrent scrapes / verifications |
| `--no-verify` | Skip Plunk verification after hunting |
| `--dry-run` | Rehearse: fetch + extract, write nothing |
| `-v, --verbose` | Debug logging |

### Environment (see `.env.example`)

| Variable | Required | Notes |
| --- | --- | --- |
| `SPIDER_API_KEY` | yes | https://spider.cloud/api-keys |
| `TURSO_URL` / `TURSO_AUTH_TOKEN` | yes* | *falls back to local `file:leads.db` |
| `PLUNK_API_KEY` | for verification | `sk_*`, https://docs.useplunk.com |
| `OPENAI_API_KEY` | for AI | any OpenAI-compatible provider — OpenAI, **DeepSeek**, Groq, Ollama…; set `OPENAI_BASE_URL` / `OPENAI_MODEL` to switch |
| `SPIDER_EXTRACT` | no | `auto` (default) \| `local` \| `spider` |
| `VERIFY_ON_HUNT` | no | `true` (default) — verify new emails automatically |
| `SPIDER_CRAWL_LIMIT`, `SPIDER_CRAWL_DEPTH` | no | defaults 30 / 2 |

## Database

Two tables (created by `init-db`):

- **leads** — one row per contact, deduped by normalized email. Columns include
  `person_name`, `title`, `phone`, `linkedin`, `company`, `domain`, `category`,
  `subcategory`, `tier`, `confidence`, `email_type` (corporate/business/student/personal),
  `interests` (JSON array), `source_url`, `status`
  (`new` → `verified` / `invalid` / `error`), Plunk results (`email_valid`,
  `is_disposable`, `is_personal_email`, `has_mx_records`, `plunk_reasons`,
  `verified_at`), and the raw extraction as `raw_data`.
- **runs** — one row per hunt/search execution (pages crawled, leads found/verified/invalid, errors).

## Cost-saving tips

- Set `SPIDER_EXTRACT=local` to avoid Spider AI credits and use your own LLM key.
- Use `--filter` on big sites so only contact pages are scraped.
- `request: http` mode (`-m http`) is cheapest for static sites.
- Failed/blocked/timeout pages cost **zero** credits on Spider Cloud.
- Spider's legacy `/pipeline/extract-contacts` is deprecated upstream (in favor of the
  Fetch API and `css_extraction_map`); the CLI treats it as best-effort and falls back
  to local AI/regex extraction automatically.

## Using DeepSeek for the AI

DeepSeek's API is OpenAI-compatible, so you only need three lines in `.env`:

```bash
OPENAI_API_KEY=sk-<your deepseek key>      # https://platform.deepseek.com
OPENAI_BASE_URL=https://api.deepseek.com   # /v1 suffix also accepted
OPENAI_MODEL=deepseek-chat
```

`deepseek-chat` supports the JSON output mode the extractor/categorizer uses; if you prefer
`deepseek-reasoner`, the CLI automatically retries without JSON mode and parses the JSON out of the reply.

## Local end-to-end demo (no real keys needed)

A mock server mimics Spider Cloud, Plunk, and an OpenAI-compatible API:

```bash
node scripts/mock-api.ts                 # terminal 1 — listens on :8787
SPIDER_API_BASE=http://127.0.0.1:8787 PLUNK_API_BASE=http://127.0.0.1:8787 \
OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=test PLUNK_API_KEY=sk_test \
SPIDER_API_KEY=test TURSO_URL=file:demo.db \
npm start -- hunt acme.com globex.io --limit 8
npm start -- list && npm start -- stats
```

## Project layout

```
src/
  index.ts     CLI (hunt, search, verify, list, stats, export, init-db)
  pipeline.ts  orchestration: links → filter → scrape → extract → categorize → store → verify
  spider.ts    Spider Cloud REST client (links, scrape, crawl, search, extract-contacts)
  ai.ts        OpenAI-compatible calls: domain categorization + contact parsing (rule fallback)
  extract.ts   regex email/phone/LinkedIn extraction + contact-URL filtering
  plunk.ts     Plunk /v1/verify client + batch verifier
  db.ts        Turso schema, upserts, queries, stats, export
  config.ts    environment configuration
scripts/
  mock-api.ts  local mock of Spider + Plunk + OpenAI for testing
```

## AI agent mode (tool calling)

Instead of the fixed pipeline, the model can **call tools** to decide what to do:

| Tool | What it does |
| --- | --- |
| `search_web` | find target sites from a query |
| `crawl_site` / `get_links` | enumerate and crawl a site |
| `extract_contacts` | scrape contact pages → emails/names/titles (+ email type) |
| `categorize_company` | industry category + interests + tier |
| `store_leads` | upsert into Turso (dedup, validation, type classification) |
| `verify_email` | Plunk check, persisted to the stored lead |
| `query_leads` | search stored leads |

The agent loop: chat → model requests tool calls → tools execute → results fed back →
repeat until the model answers with a summary (or the `--max-turns` budget is hit).
Example:

```bash
npm start -- agent "find B2B SaaS companies interested in AI and verify their emails" --limit 10
```

Requires a **function-calling-capable** model: OpenAI (gpt-4o etc.), **DeepSeek
(`deepseek-chat` and `deepseek-v4-flash` support function calling; `deepseek-reasoner`
does not)**, Groq, or Ollama models with tool support. `deepseek-v4-flash` is a great
fit for agent mode (tool use + reasoning, 1M-token context). If the provider rejects
the tools payload, the CLI explains and suggests the `hunt`/`search` commands instead.

## Finding specific email types & interests

| Want | How |
| --- | --- |
| **Corporate** (people at companies) | `hunt acme.com` → `list --type corporate` |
| **Business** (info@/sales@ mailboxes) | `hunt acme.com` → `list --type business` (or `search --query "… contact email"`) |
| **Student** (universities) | `hunt stanford.edu` or `search --query "admissions email site:.edu"` → `list --type student` |
| **Personal** (gmail/outlook/…) | `search --query "founder gmail.com"` → `list --type personal` |
| **By interest** | `list --interest "AI / Machine Learning"`, `--interest Sustainability`, … |

Interests are derived per company from its pages (AI, with keyword fallback) and stored with
every lead from that domain; the side panel shows the top two per row and the CSV export
includes the full list. `stats` prints the email-type breakdown and top interests.

## Browser extension integration

The same pipeline powers the **Spider browser extension** in the parent directory
(`/spider-extension`): a **Leads** tab in the side panel hunts targets, categorizes with
your AI key, stores in Turso, and verifies with Plunk — no CLI needed.

- `vendor/leads-core.js` is this pipeline bundled for the browser:
  `npm run build:vendor` (esbuild, `@libsql/client` → `@libsql/client/web`).
- The extension reuses your existing Spider key and BYOK AI settings; Turso + Plunk keys
  are configured in the extension Options (Lead Finder section).
- In the browser, Turso URLs are normalized to `https://` (Hrana over HTTPS), so no
  WebSocket permissions are required.

See the root `README.md` for extension setup and the full file map.

## Legal

Only scrape sites you're allowed to (check robots.txt/ToS), and only contact leads who
consented or have a legitimate business interest. Spider Cloud respects robots.txt when
configured, but the final responsibility is yours.