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
- **AI Agent (Leads tab)** — type an objective ("find fintech companies interested in AI and
  verify their emails") and the model drives the whole workflow itself via tool calling:
  `search_web`, `extract_contacts`, `categorize_company`, `store_leads`, `verify_email`,
  `query_leads`. Requires a function-calling model (OpenAI, DeepSeek `deepseek-chat` /
  `deepseek-v4-flash`, Groq…).

## Project layout

```
manifest.json      MV3 manifest (permissions incl. api.spider.cloud, Plunk, Turso, DeepSeek)
background.js      service worker — side panel routing, quick actions
popup/             quick Scrape / Crawl / Search + "Find Leads" button
sidepanel/         full panel: Scrape, Crawl, Search, AI Extract, **Leads**
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
   - Spider Cloud API key (required for scraping)
   - BYOK AI key — pick a provider; for **DeepSeek** set the OpenAI endpoint to
     `https://api.deepseek.com/v1/chat/completions` and model `deepseek-chat`
     (or `deepseek-v4-flash` for function-calling agent mode)
   - Lead Finder: **Turso URL + token** (free at turso.tech) and **Plunk API key** (sk_*)
3. Open the side panel (Ctrl+Shift+Z) → **Leads** tab → enter target domains → **Hunt**.

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

Only needed if you change `spider-leads/src/*.ts`:

```bash
npm install          # dev deps (esbuild, @libsql/client)
npm run build:vendor # → vendor/leads-core.js
```

Then reload the extension.

## Notes

- Turso URLs are normalized `libsql://…` → `https://…` in the extension so the browser
  client uses Hrana over HTTPS (no WebSocket host permission needed). Custom Turso domains
  must be added to `host_permissions` in the manifest.
- Keys live in `chrome.storage.sync` and go directly to their providers — never to Spider servers.
- Only scrape sites you're allowed to, and only contact leads with consent / legitimate interest.