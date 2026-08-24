# Spider — Web Scraper & Crawler (Chrome/Firefox extension)

Scrape any page, crawl entire sites, search the web — powered by [Spider Cloud](https://spider.cloud) —
**plus a built-in Lead Finder**: hunt company sites, categorize contacts with AI, save them to
[Turso](https://turso.tech), and verify emails with [Plunk](https://docs.useplunk.com).

## Features

- **Scrape / Crawl / Search** — Spider Cloud API with smart HTTP/Chrome modes, streaming crawl results
- **AI Extract (BYOK)** — summarize, extract emails/entities, clean markdown with your own
  OpenAI / Anthropic / Gemini / Ollama keys (DeepSeek works via the OpenAI-compatible endpoint)
- **Lead Finder (side panel → Leads tab)**:
  1. enter domains (or a search query) → Spider Cloud enumerates links and scrapes contact pages
  2. contacts are extracted (Spider AI pipeline, your AI key, or regex fallback)
  3. each company is AI-categorized (SaaS, Agency, E-commerce…) with confidence + tier,
     and tagged with **interests** (AI / ML, Cloud / DevOps, Sustainability…)
  4. every email is typed: **corporate** (person@company), **business** (info@/sales@),
     **student** (.edu/.ac.uk), or **personal** (gmail/outlook/…)
  5. leads are upserted into Turso (deduped by email)
  6. emails are checked with Plunk's `/v1/verify` (valid, disposable, MX, typo) — invalid ones flagged
  7. browse (filter by type/interest), stats, and export to CSV right in the panel
- **Employee email discovery (pattern-based)** — named people (with title/LinkedIn/GitHub,
  even with no published email) are extracted from team/leadership/contact pages and stored
  in a `people` table. When **"Infer employee emails"** is ticked (or you hit the 🔮
  **Enrich emails** button), the pipeline learns the domain's address convention from
  already-known valid emails, generates candidate addresses per person (first.last,
  firstlast, … — capped, default 3), and verifies them with Plunk before storing. Valid
  ones become leads with a **🔮 Guessed** **Source** badge. The shared pipeline also pulls
  GitHub org members (CLI `--github`) and stores any public GitHub email directly. See
  [spider-leads](spider-leads/README.md#employee-email-discovery-inferred-emails).
- **Lead scoring + relationships** — every lead is classified from its title into a
  department (engineering, sales, marketing, product, operations, finance, HR, legal),
  a seniority (exec / head / director / manager / IC / unknown), and a **decision-maker**
  flag, then given a composite **score 0–100 + grade A–D** (`A` Hot ≥80, `B` Warm ≥65,
  `C` Cool ≥45, `D` Cold), weighted by email veracity → seniority → company tier → ICP fit.
  Optional **ICP rules** (Options → Lead Finder: **ICP interests / ICP categories**,
  comma-separated) add a +12 / −10 ICP adjustment; empty means scoring without it. During
  AI categorization the model also extracts **company relationships** (partner, client,
  supplier, competitor, investor…) from the site's own text into a `company_relations`
  table. The CLI's `score` recomputes grades, `relations [domain…]` prints them, and
  `list --related-to <domain>` finds leads at related companies. See
  [spider-leads](spider-leads/README.md#lead-scoring--relationships).
- **AI Agent (Leads tab)** — type an objective ("find fintech companies interested in AI and
  verify their emails") and the model drives the whole workflow itself via tool calling:
  `search_web`, `extract_contacts`, `find_employees`, `guess_emails`, `categorize_company`,
  `find_relationships`, `score_leads`, `store_leads`, `verify_email`, `query_leads`.
  Requires a function-calling model (OpenAI, DeepSeek `deepseek-chat` / `deepseek-v4-flash`, Groq…).
- **Career tab** — build a profile from your resume (**PDF/DOCX/TXT**, parsed locally),
  tailor resume + cover letter to any job, get a fit score, and draft cold email (opens in your
  mail app) or LinkedIn messages (copy & send yourself). The extension never auto-sends.
- **AI plugin builder** — Options → Plugins → describe a plugin in plain language, the AI writes
  the JSON, you review and install it.
- **Employee scraper + AI Studio** — the **👥 Employees** button (or `spider-leads employees`)
  turns any company site into a people list (names, titles, departments, links, published
  emails). With AI Studio enabled it uses Spider's prompt→JSON `/ai/*` endpoints (structured
  `extracted_data`; needs an [AI Studio](https://spider.cloud/docs/ai-studio) subscription,
  credits apply) and falls back to the standard extractor otherwise. The **📚 Scrapers**
  button browses Spider's curated scraper-config catalog (Zillow/Indeed/Yelp…) — no key
  needed.
- **Harder sites** — requests can go through Spider Cloud's **premium proxy pool**
  (Options → Spider Cloud → *Premium proxy* + country code) to beat bot protection, and the
  CLI exposes the curated [Fetch API](https://spider.cloud/api/fetch) (`spider-leads fetch
  https://zillow.com/homes/`) for structured data on marketplace sites (Zillow, Indeed,
  Yelp…). See the [site reachability](spider-leads/README.md#scraping-harder-sites) guide —
  company sites / directories / GitHub / job boards work great; **Facebook is out** and
  LinkedIn only yields public company data, never personal emails.
- **Assist tab (approval-gated browser control)** — the AI controls the browser: navigate,
  open/close/activate/list tabs, fill application forms from your profile, set text, click
  (non-submit), scroll, copy to clipboard. You approve each action before it runs (optionally
  auto-approve read-only actions). It cannot submit, send, or log in — those stay yours.
  Per-site allowlist, sensitive fields never auto-filled, stop button, full action log.
- **Plugins (no-code)** — attach `.json` plugins in Options → **Plugins**: add AI agent tools
  (built-in actions or custom HTTP calls), stream leads to webhooks, add interest/category rules,
  and add export formats. No coding required; works in the CLI too (`plugins install`).

## Project layout

```
manifest.json      MV3 manifest (permissions incl. api.spider.cloud, Plunk, Turso, DeepSeek)
background.js      service worker — side panel routing, quick actions
popup/             quick Scrape / Crawl / Search + "Find Leads" button
sidepanel/         full panel: Scrape, Crawl, Search, AI Extract, **Leads**, Career, Assist
options/           API keys (Spider, BYOK AI incl. DeepSeek endpoint), Turso + Plunk settings
lib/               spider-api.js (Spider client), ai-client.js (BYOK AI),
                   leads.js (Lead Finder glue: storage → config → shared pipeline)
vendor/            leads-core.js — the shared spider-leads pipeline, bundled for the browser
                   (build from source with: npm run build:vendor)
spider-leads/      the standalone CLI version of the same pipeline (Node ≥ 24, no build step)
```

The extension and the [spider-leads CLI](spider-leads/README.md) share one pipeline:
`spider-leads/src/*.ts` is bundled (esbuild) into `vendor/leads-core.js` with the
`@libsql/client` web build, so behavior is identical in the browser and on the CLI.

## Setup

1. Load the extension: chrome://extensions → Developer mode → **Load unpacked** → this folder.
2. **Settings** (right-click the spider icon → Options, or the ⚙ in the panel):
   - Spider Cloud API key (required for scraping) — plus optional **premium proxy**
     (residential rotation, useful on bot-protected sites) and a **proxy country** (ISO-2)
   - BYOK AI key — pick a provider; for **DeepSeek** set the OpenAI endpoint to
     `https://api.deepseek.com/v1/chat/completions` and model `deepseek-chat`
     (or `deepseek-v4-flash` for function-calling agent mode)
   - Lead Finder: **Turso URL + token** (free at turso.tech) and **Plunk API key** (sk_*)
   - Optional: **AI Studio** checkbox (Lead Finder) for prompt→JSON employee extraction —
     needs a Spider AI Studio subscription (credits apply).
     Optionally set **ICP interests** and **ICP categories** (comma-separated) so lead
     scoring can favor your ideal customer profile — leave them empty to score without an
     ICP adjustment.
3. Open the side panel (Ctrl+Shift+Z) → **Leads** tab → enter target domains → **Hunt**.

## Browsers

**Chrome** (primary), **Firefox** (WebExtensions MV3), and **Safari** (via the converter).

- Firefox: `npm run build:firefox` → `dist/firefox/` (web-ext lint: 0 errors). Panel opens in
  a tab (no sidePanel API). See the Firefox section below.
- Safari: `npm run build:safari` → `dist/safari/`, then on macOS run
  `xcrun safari-web-extension-converter dist/safari --app-name "Spider"` and build the Xcode
  project. Safari compatibility is handled in code: `lib/storage.js` falls back from
  `storage.sync` to `storage.local` (Safari has no sync storage), the panel opens in a tab,
  runtime host permissions are skipped (all hosts declared up front), and `chrome.scripting`
  is feature-detected. See `dist/safari/SAFARI.md`.

## Firefox

The extension supports Firefox (WebExtensions MV3). Firefox has no
`chrome.sidePanel` API, so the Firefox build opens the panel UI in a regular tab —
everything else (scraping, Lead Finder, Turso, Plunk, DeepSeek/AI) is identical.

Build and run:

```bash
npm run build:firefox          # → dist/firefox/ (Firefox-flavored manifest)
npm run lint:firefox           # web-ext lint — 0 errors
npx web-ext run --source-dir dist/firefox   # launch a Firefox instance with the add-on
```

Or load it manually: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
`dist/firefox/manifest.json`. To publish on addons.mozilla.org: `npx web-ext build --source-dir dist/firefox`.

Firefox-specific manifest ([`manifest.firefox.json`](manifest.firefox.json)):
`background.scripts` event page (Firefox doesn't support `service_worker`), no
`side_panel`/sidePanel permission, `gecko.id` + `strict_min_version: 127` (needed for
promise-based `chrome.*` APIs). The build script copies only extension files — no
`node_modules`/CLI sources — into `dist/firefox`.

## Rebuilding the shared pipeline bundle

The browser bundles are **generated** (gitignored) — a fresh clone needs:

```bash
npm install
npm run build:vendor   # spider-leads/src/*.ts → vendor/leads-core.js
npm run build:pdf      # pdf.js → vendor/pdf-extract.js + vendor/pdf.worker.mjs
npm run build:firefox  # → dist/firefox/
npm run build:safari   # → dist/safari/
npm test               # full suite: unit (helpers/storage/plugins) + integration
                       # (hunt, search, agent loop, career, assist loop, verify,
                       #  plugin http tools & webhooks, employee-email inference —
                       #  all against the mock API, no real keys or network needed)
```

Then reload the extension. Re-run `build:vendor` whenever you change
`spider-leads/src/*.ts`, `build:pdf` when PDF handling changes.

## Notes

- **Keys are stored in plaintext** in the browser's extension storage (synced via your
  browser account where supported). Anyone with device access could read them — treat
  them like passwords. The extension never sends them anywhere except their own provider.
- Your **resume text is sent to your configured AI provider** when you build a profile
  (Career tab) — it goes nowhere else. Pick a provider you trust.
- The DOCX resume parser reads `word/document.xml` (main body); headers/footers and encrypted
  documents aren't extracted — paste the text for those.
- Turso URLs are normalized `libsql://…` → `https://…` in the extension so the browser
  client uses Hrana over HTTPS (no WebSocket host permission needed). Custom Turso domains
  must be added to `host_permissions` in the manifest.
- Keys live in `chrome.storage.sync` and go directly to their providers — never to Spider servers.
- Only scrape sites you're allowed to, and only contact leads with consent / legitimate interest.