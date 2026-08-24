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
5. **Discover people** — team/leadership/contact pages are also parsed for named humans
   (name, title, LinkedIn, GitHub) and stored in the `people` table (deduped by
   domain+name) — **even when no email is published**. This gives you a roster to work
   from for employee discovery.
6. **Infer employee emails** (opt-in) — for people without a published email, `guess.ts`
   generates candidate addresses from their name using common patterns (first.last,
   first_last, firstlast, f.last, flast, firstl, last.first, first), learns the
   domain's convention from already-known valid emails to rank them, and verifies
   candidates with Plunk. See "Employee email discovery" below.
7. **Store** — every lead is upserted into Turso (deduped by email), alongside the raw
   record, category, email type, interests, and source URL.
8. **Verify** — each new email is sent to Plunk's `POST /v1/verify` endpoint; results
   (valid, disposable, personal, MX records, typo) are stored with the lead. Invalid
   emails are marked `invalid` and can be filtered out of exports.
9. **Grade & score** — every lead is classified from its title into a department
   (engineering, sales, marketing, product, operations, finance, HR, legal), a seniority
   (exec / head / director / manager / IC / unknown), and a **decision-maker** flag, then
   scored 0–100 with a grade **A–D** (A Hot ≥80, B Warm ≥65, C Cool ≥45, D Cold). Email
   veracity dominates, then seniority, then company tier, then ICP fit (optional
   `ICP_INTERESTS` / `ICP_CATEGORIES`). Invalid emails score 0 / D. See [Lead scoring &
   relationships](#lead-scoring--relationships) below.
10. **Relationships** — during categorization the AI reads the site's own text for
    company-to-company relationships (e.g. "trusted by Acme", "in partnership with…") and
    stores them in a `company_relations` table (keyword rules fall back when no AI key is
    set). The `relations` command prints them; `list --related-to <domain>` surfaces leads
    at related companies.

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

# Structured data via Spider's curated per-site scraper configs (Zillow, Indeed, Yelp…)
npm start -- fetch https://zillow.com/homes/
npm start -- fetch https://zillow.com/homes/ --json

# Employee scraper: turn a site into a people list (names/titles/departments) — AI Studio
# prompt→JSON when enabled, else the standard contact pipeline; --guess infers missing emails
npm start -- employees acme.com --ai-studio --guess

# Browse Spider's curated scraper-config catalog (no API key needed)
npm start -- scrapers --domain zillow.com
npm start -- scrapers --limit 30 --json

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

# Recompute scores + grades for every stored lead (uses ICP env rules)
npm start -- score

# Show a company's relationships (partners/clients…) + leads at related companies
npm start -- relations acme.com

# Leads at companies related to a domain (partners/clients/competitors)
npm start -- list --related-to acme.com

# Only decision-makers scoring >= 80 (Hot, A-grade)
npm start -- list --min-score 80 --decision-maker

# Filter by grade / department
npm start -- list --tier A --department sales
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
| `--guess` | Infer employee emails (pattern-based) after hunting; verify with Plunk |
| `--no-guess` | Disable employee email inference |
| `--per-person N` | Max candidate addresses to try per person (default 3) |
| `--github ORGS` | Comma-separated GitHub orgs to pull public members from (enrich/hunt) |
| `--proxy` | Route requests through Spider's premium proxy pool (residential rotation) |
| `--no-proxy` | Disable the premium proxy |
| `--country CC` | ISO-2 country for proxy georouting, e.g. `--country us` |
| `--ai-studio` | Use Spider AI Studio `/ai/*` endpoints (prompt→JSON; needs an AI Studio subscription — credits apply) |
| `--no-ai-studio` | Disable AI Studio endpoints — standard extraction, no credits |
| `--category C` | Filter the scraper catalog by category (`scrapers`) |
| `--readability` | Strip navigation/ads — main content only (`fetch`) |
| `--domain D` | Filter by domain (`people` command) |
| `--no-email` | Only people without a published email (`people` command) |
| `--min-score N` | Only leads with lead score ≥ N (`list`) |
| `--tier T` | Filter by lead grade: `A` \| `B` \| `C` \| `D` (`list`) |
| `--department D` | Filter by role department: sales, engineering, marketing… (`list`) |
| `--decision-maker` | Only leads who are decision makers (exec/head/director/owner…) (`list`) |
| `--related-to D` | Leads at companies related to a domain (partners/clients…; `list`) |
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
| `SPIDER_PROXY` | no | `true` → use the premium proxy pool on every request |
| `SPIDER_COUNTRY` | no | ISO-2 country for proxy georouting, e.g. `us` |
| `SPIDER_AI_STUDIO` | no | `true` → use Spider AI Studio `/ai/*` endpoints (prompt→JSON); needs an AI Studio subscription — credits apply; defaults to standard extraction when off |
| `GUESS_EMAILS` | no | `true` → infer employee emails automatically after `hunt`/`search` |
| `GUESS_PER_PERSON` | no | Max candidate addresses per person (default 3) |
| `GITHUB_TOKEN` | no | Raises GitHub org-discovery rate limit (60/h → 5000/h) |
| `GITHUB_API_BASE` | no | GitHub API base (default `https://api.github.com`) |
| `ICP_INTERESTS` | no | Comma-separated ICP interest topics used in lead scoring (e.g. `AI, Cloud, Fintech`); empty = score without an ICP adjustment |
| `ICP_CATEGORIES` | no | Comma-separated ICP categories used in lead scoring (e.g. `SaaS / Software`); matched against a lead's company category |

## Database

Five tables are created by `init-db`:

- **leads** — one row per contact, deduped by normalized email. Columns include
  `person_name`, `title`, `phone`, `linkedin`, `company`, `domain`, `category`,
  `subcategory`, `tier`, `confidence`, `email_type` (corporate/business/student/personal),
  `interests` (JSON array), `source_url`, `status`
  (`new` → `verified` / `invalid` / `error`), Plunk results (`email_valid`,
  `is_disposable`, `is_personal_email`, `has_mx_records`, `plunk_reasons`,
  `verified_at`), and the raw extraction as `raw_data`. Employee-inference adds
  `email_source` (`page` / `guessed` / `github` / `agent` / `user` / `unknown`),
  `email_pattern` (e.g. `first.last`), and `email_score` (0–1 confidence). Lead scoring
  adds `department`, `seniority`, `decision_maker`, `lead_score` (0–100), `lead_tier`
  (A/B/C/D), and `icp_match` (0/1/null when ICP rules are unset).
- **people** — named humans discovered on team/leadership/contact pages (or GitHub org
  members), deduped by `domain + name`, stored even when no email is published. Columns:
  `name`, `title`, `email`, `linkedin`, `github`, `domain`, `company`, `source`
  (`page` / `github` / `user`), `source_url`, `notes`. This is the roster used for
  pattern-based email inference.
- **email_candidates** — every generated candidate address and its verification outcome,
  so addresses are never re-guessed. Columns: `email` (PK), `person_name`, `domain`,
  `pattern`, `score`, `reason`, `status` (`pending` / `valid` / `invalid` / `error`),
  `source_url`, `detail`.
- **company_relations** — company-to-company relationships observed on a site.
  Columns: `from_domain`, `type` (Partner / Client / Supplier / Competitor / Subsidiary /
  Parent / Investor / Other), `target`, `target_domain`, `evidence`, `confidence`,
  `source_url`. Deduped by `from_domain + target + type`.
- **runs** — one row per hunt/search execution (pages crawled, leads found/verified/invalid, errors).

`stats` includes a people count and an email-source breakdown (visible in `--json` output).

## Employee email discovery (inferred emails)

Named people are gathered from team/leadership/contact pages (and, opt-in, GitHub), and
where someone has no published address, the CLI **infers** one from the domain's email
convention — then **verifies it with Plunk before storing**. Inferred emails are stored as
leads with `email_source = 'guessed'`, plus the `email_pattern` (e.g. `first.last`) and an
`email_score` (0–1). This turns a company's public roster into a candidate list of
addresses you can double-check and use.

How it works, per domain:

1. **Load people** — all stored `people` for the domain (plus any freshly scraped ones),
   merged with GitHub org members if `--github` is given.
2. **Learn** — `guess.ts` inspects the domain's already-known valid emails (published +
   verified) and learns its convention (`first.last`, `first_last`, `firstlast`…). With no
   known emails it falls back to a generic frequency prior (first.last ≈ 65% of the world).
3. **Generate** — for each person without an email, candidate addresses are built from
   their name (first.last, first_last, firstlast, f.last, flast, firstl, last.first, first),
   ranked by the learned pattern + generic prior, and capped per person.
4. **Verify** — candidates are sent to Plunk `/v1/verify` (bounded concurrency). Valid ones
   are stored as leads (`email_source = 'guessed'`) and marked verified; invalid or errored
   ones are recorded in `email_candidates` so they are never re-guessed.
5. **GitHub org discovery (opt-in)** — `github.ts` pulls public org members via
   `api.github.com`. Public GitHub profile emails become leads with
   `email_source = 'github'` (no guessing needed); unnamed/no-email members are added to
   the `people` roster. Unauthenticated the API allows ~60 req/h; set `GITHUB_TOKEN` to
   raise that to 5000/h.

### `enrich` — infer + verify emails for domains already in the DB

```bash
# Infer + verify employee emails for every stored person at one domain
npm start -- enrich acme.com

# Fresh page scan first (discover new people before guessing), cap candidates per person
npm start -- enrich acme.com globex.io --extract spider --per-person 5

# Also pull public members of GitHub orgs (dev/tech companies)
npm start -- enrich vercel.com --github vercel,nextjs

# Skip Plunk verification — candidates are saved as 'pending' for later
npm start -- enrich acme.com --no-verify
```

`--per-person N` caps candidate addresses tried per person (default 3); `--github ORGS`
accepts a comma-separated list of GitHub orgs; `--extract auto|local|spider` optionally
scans pages first to discover fresh people (default: use the `people` already stored).

### `people` — inspect the discovered roster

```bash
npm start -- people                # everyone discovered so far
npm start -- people --domain acme.com --no-email   # people at acme without an email
npm start -- people --limit 50 --json
```

`--domain X` filters to one domain, `--no-email` limits to people without a published
email (the ones inference targets), `--limit` caps rows, `--json` gives machine-readable
rows.

### `hunt` / `search` with inference on

Hunting can run inference automatically as part of the run:

```bash
npm start -- hunt acme.com --guess            # infer + verify after extracting
npm start -- hunt acme.com --guess --per-person 4
npm start -- hunt acme.com --no-guess         # explicitly disable
```

Enable it by default in `.env` with `GUESS_EMAILS=true`:
`hunt`/`search` then infer for people without emails unless you pass `--no-guess`.
`--per-person` and `--github` work the same as for `enrich`. Inference needs a
`PLUNK_API_KEY` — without one, a `hunt --guess` run skips inference with a warning
(`enrich` instead saves candidates as `pending`).

### Env vars for inference

| Variable | Default | Meaning |
| --- | --- | --- |
| `GUESS_EMAILS` | `false` | `true` → infer employee emails automatically after `hunt`/`search` |
| `GUESS_PER_PERSON` | `3` | Max candidate addresses to try per person |
| `GITHUB_TOKEN` | — | GitHub token to raise the org-discovery rate limit (60/h → 5000/h) |
| `GITHUB_API_BASE` | `https://api.github.com` | GitHub API base (tests / proxies) |

> **Be honest about these addresses.** Every candidate is verified with Plunk
> (`/v1/verify`) before it is stored, so you know the mailbox is deliverable — but
> pattern-guessing means the address is an *inference*, not a published fact: it may
> still be wrong (a different-looking inbox, a shared mailbox, or someone who changed
> their address). Always double-check before outreach, and respect the recipient's
> expectations and your local law (CAN-SPAM / GDPR) — verification confirms a mailbox
> exists, it does not give you permission to contact it.

## Lead scoring & relationships

Every stored lead is classified from its title and given a composite **score 0–100 + grade
A–D**, and companies are linked by the relationships they state on their own sites.

### Classification

`leadscore.ts` classifies each title into:

| Field | Possible values |
| --- | --- |
| **department** | engineering, sales, marketing, product, operations, finance, hr, legal, other |
| **seniority** | exec, head, director, manager, ic (individual contributor), unknown |
| **decision_maker** | `true` for execs / heads / directors / owners / buyers / sales-and-manager leads |

The keyword rules win ties in a fixed order (engineering > marketing > sales > product > …),
so "Sales Engineer" is engineering while "Growth Marketing Manager" is marketing.

### The score

The composite score multiplies weighted factors, then applies an ICP adjustment:

```
score = 100 × emailFactor × (0.55 + 0.45 × seniority) × (0.7 + 0.3 × tier) × (0.92 + 0.08 × confidence)
score += 12   if ICP matches     score −= 10   if ICP does not match
score = clamp(round(score), 0, 100)
```

| Factor | Weight |
| --- | --- |
| **Email veracity** (dominates) | verified published 1.0 · guessed `0.55 + 0.45×confidence` · GitHub public 0.95 · published not-yet-verified 0.75 |
| **Seniority** | exec 1.0, head 0.92, director 0.86, manager 0.78, IC 0.66, unknown 0.6 |
| **Company tier** | Enterprise 1.0, Mid-market 0.9, SMB 0.8, Unknown 0.72 |
| **Categorization confidence** | `0.92 + 0.08×confidence` |
| **ICP fit** (optional) | +12 matched / −10 not matched |

An **invalid email scores 0 / D** — a dead address is a dead lead. The grade is derived from
the score (A Hot ≥80, B Warm ≥65, C Cool ≥45, D Cold):

| Score | Grade | Label |
| --- | --- | --- |
| ≥ 80 | A | Hot |
| ≥ 65 | B | Warm |
| ≥ 45 | C | Cool |
| < 45 | D | Cold |

### ICP configuration

Set `ICP_INTERESTS` and/or `ICP_CATEGORIES` in `.env` (comma-separated; also in the
extension at Options → Lead Finder). When both are empty, ICP match is **unknown** and the
score gets no adjustment. When categories are set, a lead matches if its company category
contains any configured value; when interests are set, a lead matches if any of its stored
interest topics contains the configured text.

### Relationships

During AI categorization the model returns a `relations` array parsed from the site's own text
("trusted by Acme", "in partnership with…", "powers deployments for Globex"), with `type`
(Partner / Client / Supplier / Competitor / Subsidiary / Parent / Investor / Other), `target`,
`targetDomain`, `evidence`, and `confidence`. With no AI key, keyword rules provide a
best-effort fallback. Relations are stored in `company_relations` (`from_domain`, `type`,
`target`, `target_domain`, `evidence`, `confidence`, `source_url`) and drive `relations` and
`list --related-to`.

```bash
# Recompute scores + grades for all stored leads (uses ICP env)
npm start -- score

# Show a domain's relationships + "Leads at related companies"
npm start -- relations acme.com
npm start -- relations            # every domain that has recorded relations

# Leads at companies related to a domain (partners/clients/competitors)
npm start -- list --related-to acme.com

# Filter by score / grade / department / decision-maker
npm start -- list --min-score 80 --decision-maker
npm start -- list --tier B --department product
```

The agent also exposes `score_leads` (recompute + return the top-scoring leads) and
`find_relationships` (AI-discover + persist a domain's relations).

## Employee scraper & AI Studio

Turn any company site into a people list. `employees` crawls the site and extracts **every
team member**: name, title, department, LinkedIn/GitHub, published email. It has two modes:

- **AI Studio (prompt → JSON)** — pass a plain-English prompt to Spider's `/ai/crawl` with an
  `extraction_schema`; Spider renders the pages, runs the prompt, and hands back
  `metadata.extracted_data.employees` as structured JSON. Requires an **active AI Studio
  subscription** (see [AI Studio docs](https://spider.cloud/docs/ai-studio)) — every AI call
  spends credits separately from the normal API billing, and a key that works on `/crawl` can
  still be refused on `/ai/*`. Enable with `SPIDER_AI_STUDIO=true` (or `--ai-studio`).
- **Standard pipeline (fallback)** — when AI Studio is off/unavailable, `employees` uses the
  exact same contact extraction as `hunt`. No credits, same results quality on most sites.

In both modes people go through the full pipeline: stored in `people` (even without an
email), classified (department/seniority/decision-maker), scored & graded, company
categorized with relationships — and `--guess` additionally infers + verifies missing
emails with Plunk.

```bash
# Employees of one or more companies (AI Studio extraction; credits apply)
npm start -- employees acme.com --ai-studio --guess

# Same, without AI Studio (standard extraction, no credits)
npm start -- employees acme.com globex.io --limit 10

# Every extracted employee without an email becomes a guessing target
npm start -- employees acme.com --ai-studio --guess --per-person 5
```

### Scraper catalog

[Spider's scraper directory](https://spider.cloud/docs/api/scraper-directory/) is a catalog of
curated per-site scraper configs (Zillow, Indeed, Yelp, …) — domain, path pattern, category,
confidence score and field count. It needs **no API key**:

```bash
npm start -- scrapers                     # every config (capped at --limit)
npm start -- scrapers --domain zillow.com # what's curated for one site
npm start -- scrapers --limit 30 --json
```

These are the same configs `fetch` uses: the first `fetch` call to a domain bootstraps the
config, later calls hit the cache.

## Scraping harder sites

Spider Cloud's [request modes](https://spider.cloud/docs/overview/) (`smart` auto, `http`
static, `browser` JS/SPA) plus the **premium proxy pool** and the curated **Fetch API**
decide what works where. Site-by-site reality:

| Site | Verdict | How |
| --- | --- | --- |
| Company websites, directories, job boards | ✅ | `hunt` / `search` as-is; `jobs-ats` reads Greenhouse/Lever/Ashby boards |
| **Zillow** | ⚠️ Listings yes, contacts rare | `fetch https://zillow.com/homes/` uses the curated scraper config; agent emails appear only on agent-profile pages |
| **YouTube** | ✅ Metadata, ❌ emails | `hunt <channel's linked site>` isn't needed for videos but works for their site; `search` finds channel "about" pages |
| **LinkedIn** | ⚠️ Public company data only | Their [LinkedIn scraper](https://spider.cloud/scrapers/linkedin-scraper/) returns public company profiles/jobs/employee counts; **personal emails are never public** — use Assist (logged-in browser) to read, and `enrich --github` / `enrich --guess` for contacts |
| **Facebook** | ❌ | Login wall + ToS prohibition; no curated config — don't build on it |

### Premium proxy + country

Routes every request through Spider's residential/ISP rotation (helps on bot-protected
sites). Costs a premium per request — enable it only where needed.

```bash
npm start -- hunt acme.com --proxy --country us
npm start -- enrich acme.com --proxy --country de
SPIDER_PROXY=true SPIDER_COUNTRY=us npm start -- hunt acme.com   # via env
```

In the browser extension: Options → Spider Cloud → **Premium proxy** + **Proxy country**.

### `fetch` — structured data from curated scraper configs

`POST /fetch/{domain}/{path}` uses AI-discovered (then cached) per-site scraper configs —
no CSS selectors to write. First call per domain/path bootstraps the config (~3-5s);
later calls hit cache.

```bash
# Structured items from a marketplace/listing page
npm start -- fetch https://zillow.com/homes/
npm start -- fetch https://indeed.com/jobs --json
# Raw markdown instead of structured items
npm start -- fetch https://zillow.com/homes/ -F markdown
```

The agent also has a `fetch_structured` tool, so it can pull listing/job data in the same
run as lead hunting.

## Cost-saving tips

- Set `SPIDER_EXTRACT=local` to avoid Spider AI credits and use your own LLM key.
- Use `--filter` on big sites so only contact pages are scraped.
- `request: http` mode (`-m http`) is cheapest for static sites.
- Failed/blocked/timeout pages cost **zero** credits on Spider Cloud.
- Requests still need a **positive credit balance**: an empty balance returns HTTP 402
  (`credits_required`) on every paid route — add credits at spider.cloud/credits/new.
  The scraper catalog (`scrapers`, `/data/scraper-directory`) is free and needs no key.
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
  index.ts     CLI (hunt, search, fetch, enrich, people, agent, score, relations, verify, list, stats, export, init-db)
  pipeline.ts  orchestration: links → filter → scrape → extract → categorize → store → verify
               (+ findEmployees: AI Studio employee scraper with standard fallback)
  spider.ts    Spider Cloud REST client (links, scrape, crawl, search, extract-contacts,
               /fetch configs, /ai/* prompt→JSON, scraper-directory catalog)
  ai.ts        OpenAI-compatible calls: domain categorization + contact parsing (rule fallback)
  extract.ts   regex email/phone/LinkedIn extraction + contact-URL filtering
  people.ts    named-person parsing (team/leadership pages), name splitting, GitHub handles
  guess.ts     pattern-based email candidate generation + a domain's convention learning
  github.ts    GitHub org member discovery (public api.github.com)
  enrich.ts    employee email enrichment: discover people → guess → verify → store
  plunk.ts     Plunk /v1/verify client + batch verifier
  leadscore.ts role/department classification + the 0–100 composite score & A–D grade
  db.ts        Turso schema (leads, people, email_candidates, company_relations, runs),
               upserts, queries, stats, export
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
| `fetch_structured` | curated Fetch API — structured items from Zillow/Indeed/Yelp-class pages |
| `extract_employees` | employee scraper for a domain (AI Studio prompt→JSON or standard pipeline) |
| `list_scrapers` | browse the curated scraper-config catalog (no keys needed) |
| `find_employees` | discover named employees (name/title/LinkedIn/email) → people without emails |
| `guess_emails` | infer + verify employee emails via the domain pattern, store valid ones |
| `categorize_company` | industry category + interests + tier |
| `store_leads` | upsert into Turso (dedup, validation, type classification) |
| `verify_email` | Plunk check, persisted to the stored lead |
| `query_leads` | search stored leads |
| `score_leads` | recompute scores + grades for stored leads, return the top-scoring |
| `find_relationships` | AI-discover + persist a domain's company relationships (partners/clients…) |

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
| **Inferred employee emails** (person@company, not published) | `enrich acme.com` (or `hunt acme.com --guess`) → `list --type corporate` |
| **By interest** | `list --interest "AI / Machine Learning"`, `--interest Sustainability`, … |

Interests are derived per company from its pages (AI, with keyword fallback) and stored with
every lead from that domain; the side panel shows the top two per row and the CSV export
includes the full list. `stats` prints the email-type breakdown and top interests.

## Plugin system

Plugins extend the pipeline without touching core code — **no developer skills needed**.

### Two kinds of plugins

| Kind | Who | Format |
| --- | --- | --- |
| **JSON plugins (no-code)** | anyone | A single `.json` file declaring tools, webhooks, rules, exporters — attached through the extension UI or `plugins install` |
| **Code plugins** | developers | `plugin.json` + `index.ts` exporting `{ tools?, hooks?, exporters? }` |

### No-code JSON plugin format

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "tools": [
    {
      "name": "fetch_jobs",
      "description": "Fetch jobs from a company's public board",
      "parameters": { "type": "object", "properties": { "company": { "type": "string" } }, "required": ["company"] },
      "action": { "type": "builtin", "id": "fetch_jobs", "params": { "platform": "greenhouse" } }
    }
  ],
  "hooks": {
    "onLead": { "url": "https://yourapp.com/api/new-lead", "bodyTemplate": "{\"email\":\"{email}\",\"outcome\":\"{outcome}\}" } }
  },
  "rules": { "interests": [{ "match": "open source|github", "topic": "Open Source" }] },
  "exporters": [{ "id": "jsonl", "label": "JSON Lines", "format": "jsonl" }],
  "filters": [{ "name": "jobs", "pattern": "/(jobs|careers)/" }]
}
```

- **tools** — either a **built-in action** (`fetch_url`, `search_web`, `fetch_jobs`) or a plain
  **HTTP call** (`{param}` placeholders in URL/body, optional `extract` dot-path into the JSON response).
- **hooks** — webhooks fired `onLead` (per stored lead) / `afterRun`, with `{email}`, `{company}`,
  `{title}`, `{outcome}`, `{source}` placeholders.
- **rules** — extra interest & category keyword rules (matched against page text).
- **exporters** — `jsonl` / `json` / `csv` output formats.
- **filters** — named URL filters usable as `--filter @jobs`.

### Using plugins

```bash
spider-leads plugins list                 # inspect discovered plugins
spider-leads plugins install ./my-plugin.json   # install a JSON plugin file
spider-leads hunt acme.com                # hooks fire automatically
spider-leads export out.jsonl --exporter jsonl
spider-leads agent "…"                    # plugin tools are offered to the agent
spider-leads hunt acme.com --filter @jobs # named plugin filter
```

### In the browser extension

Options → **Plugins**: attach a `.json` file (or paste it), toggle enable/disable, remove.
Installed plugins apply immediately to the Leads tab (hunt/search/agent) — webhooks fire,
extra agent tools appear, rules affect categorization, exporters appear in the panel's
export. Plugins are stored in `chrome.storage.local` as data, so MV3 CSP is never an issue.

### Trust & collisions

Plugins run with your keys' permissions — only install plugins you wrote or audited.
If two plugins define the same tool/exporter id, the first loaded wins and a warning is printed.

**Shipped examples** (`plugins/`): `jobs-ats` (code — fetch_jobs tool for Greenhouse/Lever/Ashby),
`jobs-board-json` (JSON — the same capability as a no-code plugin), `webhook-leads`
(code — onLead → `WEBHOOK_URL`), `exporter-jsonl` (code — JSON Lines export).

## Career assist (profile → tailored resume → outreach drafts)

The `career-assist` plugin (and the extension's **Career** tab) turn a resume into a job-specific
application packet — with the human always sending:

1. **Build a profile** — upload a resume (**PDF, DOCX, or TXT** — parsed locally, nothing uploaded)
   or paste text; the AI extracts a structured profile (skills, experience, education, projects).
2. **Tailor** — profile + job description → tailored resume (Markdown), cover letter, interview
   talking points, and keywords. Every fact stays true to the profile — tailoring, never fabricating.
3. **Fit score** — 0–100 fit with strengths, gaps, and questions to research.
4. **Outreach drafts** — a cold **email** (subject + body; opens in your own mail app via mailto)
   or a **LinkedIn message** (copied to your clipboard; you paste and send). The extension never
   sends anything automatically.

Agent mode gets the same powers as tools: `build_profile`, `tailor_resume`, `draft_outreach`,
`score_fit`. (These tools need the session config — plugin tools now receive `{cfg, db}` context.)

## AI plugin builder (extension)

Options → Plugins → **"Generate a plugin with AI"**: describe what you want in plain language
(e.g. *"a tool that checks a company's latest news before outreach, and a webhook that posts new
leads to Slack"*) and the AI writes a JSON plugin for you. You review/edit it in the preview box,
then install it — same validation as manual installs.

## Browser assistant (approval-gated)

The extension's **Assist** tab gives the AI browser actions — with **your approval for every single one**:

1. You're on a job/application page and type e.g. *"Fill the application form from my profile"*.
2. The AI inspects the page (`read_page`) and proposes actions one at a time (navigate, fill_form,
   set_text, click, scroll_to), each with a reason.
3. Each proposal appears as an **Approve / Deny** card — only approved actions execute, on the
   current tab, via `chrome.scripting`.

Safety rails (enforced in code, not just prompts):

- **No submit/send actions exist** — the tool schema has none, and the click helper refuses
  submit/apply/send-like elements regardless.
- **Sensitive fields are never auto-filled** — visa, salary, demographics, SSN, birth dates, etc.
  are skipped and reported.
- **Per-site allowlist** — job platforms are pre-allowed; any other site must be added explicitly
  (requests the optional host permission on your click). Non-allowlisted sites block execution.
- **Stop button**, action log, and the model is told the user submits manually.
- No login/credential handling anywhere.

The loop uses the same function-calling stack (DeepSeek `deepseek-v4-flash` / OpenAI etc.).

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