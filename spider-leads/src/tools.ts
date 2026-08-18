// Agent tools: the LLM calls these to search, crawl, extract, classify, verify, and store.

import type { Client } from "@libsql/client";
import type { Config } from "./config.ts";
import type { ToolDef } from "./ai.ts";
import { categorizeDomain } from "./ai.ts";
import type { PageContent } from "./types.ts";
import { classifyEmailType, domainOf, isValidEmail, toRoot } from "./extract.ts";
import { crawlPages, getSiteLinks, searchPages, scrapePage } from "./spider.ts";
import { extractContactsFromSite, normalizeContacts } from "./pipeline.ts";
import { verifyEmail as plunkVerify } from "./plunk.ts";
import { listLeads, recordVerification, upsertLead } from "./db.ts";
import { log } from "./log.ts";

export interface AgentToolOpts {
  dryRun?: boolean;
  limit?: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: any, ctx?: { cfg?: unknown; db?: unknown }) => Promise<string>;
}

function def(t: Tool): ToolDef {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

export function toolDefs(tools: Record<string, Tool>): ToolDef[] {
  return Object.values(tools).map(def);
}

const preview = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Build the tool registry bound to this config + DB session. */
export function buildTools(cfg: Config, db: Client, opts: AgentToolOpts = {}): Record<string, Tool> {
  const limit = opts.limit ?? 10;

  const tools: Record<string, Tool> = {
    search_web: {
      name: "search_web",
      description:
        "Search the web for a query and return matching pages with content previews. " +
        "Use this to discover target companies/sites (e.g. \"fintech companies in Austin\").",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          limit: { type: "integer", description: "Max results (default " + limit + ")" },
        },
        required: ["query"],
      },
      async run(args) {
        const pages = await searchPages(cfg, String(args.query ?? ""), { limit: Number(args.limit) || limit });
        return JSON.stringify({
          count: pages.length,
          results: pages.map((p) => ({ url: p.url, status: p.status, preview: preview(p.markdown) })),
        });
      },
    },

    crawl_site: {
      name: "crawl_site",
      description:
        "Crawl a website starting from a URL and return the discovered pages with content previews.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Starting URL (e.g. https://acme.com)" },
          limit: { type: "integer", description: "Max pages (default " + limit + ")" },
          depth: { type: "integer", description: "Link depth (default 2)" },
        },
        required: ["url"],
      },
      async run(args) {
        const pages = await crawlPages(cfg, String(args.url), {
          limit: Number(args.limit) || limit,
          depth: Number(args.depth) || 2,
        });
        return JSON.stringify({
          count: pages.length,
          pages: pages.map((p) => ({ url: p.url, status: p.status, preview: preview(p.markdown) })),
        });
      },
    },

    get_links: {
      name: "get_links",
      description: "List internal links of a website without fetching full page content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Website URL" },
          limit: { type: "integer", description: "Max links (default 50)" },
        },
        required: ["url"],
      },
      async run(args) {
        const urls = await getSiteLinks(cfg, String(args.url), { limit: Number(args.limit) || 50 });
        return JSON.stringify({ count: urls.length, urls: urls.slice(0, 100) });
      },
    },

    extract_contacts: {
      name: "extract_contacts",
      description:
        "Extract contact information (emails, names, titles, phones, LinkedIn) from a company website. " +
        "Crawls contact-likely pages (team/about/contact), then uses AI (or regex fallback). " +
        "Each contact includes an email_type classification: corporate, business, student, or personal.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Company domain or URL, e.g. https://acme.com" },
          limit: { type: "integer", description: "Max pages to scrape (default " + limit + ")" },
        },
        required: ["url"],
      },
      async run(args) {
        const url = String(args.url ?? "");
        if (!/^https?:\/\//.test(url)) {
          return JSON.stringify({ error: "url must be absolute, e.g. https://acme.com" });
        }
        const extraction = await extractContactsFromSite(cfg, url, {
          limit: Number(args.limit) || limit,
          depth: 2,
          mode: "smart",
          extract: cfg.spiderExtract,
          verify: false,
          dryRun: false,
          concurrency: 4,
        });
        return JSON.stringify({
          domain: extraction.domain,
          linksFound: extraction.linksFound,
          pagesScraped: extraction.pages.length,
          errors: extraction.errors,
          contacts: normalizeContacts(extraction.contacts, extraction.pages).map((c) => ({
            email: c.email ?? null,
            email_type: c.email ? classifyEmailType(c.email) : null,
            person_name: c.person_name ?? null,
            title: c.title ?? null,
            phone: c.phone ?? null,
            linkedin: c.linkedin ?? null,
          })),
        });
      },
    },

    categorize_company: {
      name: "categorize_company",
      description:
        "Classify a company: industry category (SaaS, Agency, E-commerce…), tier, confidence, " +
        "and interest topics (e.g. AI / Machine Learning, Sustainability) derived from its website.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain, e.g. acme.com" },
        },
        required: ["domain"],
      },
      async run(args) {
        const domain = String(args.domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
        let pages: PageContent[] = [];
        try {
          pages = [await scrapePage(cfg, toRoot(domain), { mode: "smart" })];
        } catch (err) {
          log.debug("categorize_company: could not scrape " + domain + ": " + (err as Error).message);
        }
        const cat = await categorizeDomain(cfg, domain, pages);
        return JSON.stringify(cat);
      },
    },

    verify_email: {
      name: "verify_email",
      description:
        "Verify a single email address with Plunk: validity, disposable/personal flags, MX records, typos. " +
        "If the email is already stored, its verification status is updated in the database.",
      parameters: {
        type: "object",
        properties: { email: { type: "string", description: "Email address to verify" } },
        required: ["email"],
      },
      async run(args) {
        const email = String(args.email ?? "").toLowerCase().trim();
        if (!isValidEmail(email)) return JSON.stringify({ error: "invalid email address: " + email });
        if (!cfg.plunkApiKey) {
          return JSON.stringify({ error: "PLUNK_API_KEY is not set — cannot verify emails" });
        }
        const res = await plunkVerify(cfg, email);
        try {
          await recordVerification(db, email, res);
        } catch (err) {
          log.debug("verify_email: could not persist result: " + (err as Error).message);
        }
        return JSON.stringify(res);
      },
    },

    store_leads: {
      name: "store_leads",
      description:
        "Store leads in the Turso database (deduped by email). Accepts an array of leads with " +
        "email (required for email leads), person_name, title, phone, linkedin, company, domain, " +
        "category, interests (array of strings or {topic, confidence} objects), source_url. " +
        "Emails are validated and classified (corporate/business/student/personal) automatically.",
      parameters: {
        type: "object",
        properties: {
          leads: {
            type: "array",
            description: "Leads to store",
            items: {
              type: "object",
              properties: {
                email: { type: "string" },
                person_name: { type: "string" },
                title: { type: "string" },
                phone: { type: "string" },
                linkedin: { type: "string" },
                company: { type: "string" },
                domain: { type: "string" },
                category: { type: "string" },
                interests: {
                  type: "array",
                  items: {
                    anyOf: [
                      { type: "string" },
                      { type: "object", properties: { topic: { type: "string" }, confidence: { type: "number" } } },
                    ],
                  },
                },
                source_url: { type: "string" },
              },
              required: ["email"],
            },
          },
        },
        required: ["leads"],
      },
      async run(args) {
        const raw: any[] = Array.isArray(args.leads) ? args.leads : [];
        if (raw.length === 0) return JSON.stringify({ error: "no leads provided" });
        let stored = 0, updated = 0, rejected = 0;
        const rejectedReasons: string[] = [];
        for (const l of raw) {
          const email = String(l.email ?? "").toLowerCase().trim();
          if (!email || !isValidEmail(email)) {
            rejected++;
            rejectedReasons.push((l.email ?? "?") + " (invalid or placeholder)");
            continue;
          }
          const interests = Array.isArray(l.interests)
            ? l.interests.map((i: any) =>
                typeof i === "string" ? { topic: i, confidence: 0.6 } : { topic: String(i?.topic ?? ""), confidence: Number(i?.confidence) || 0.6 }
              ).filter((i: any) => i.topic.length > 0)
            : [];
          const lead = {
            email,
            emailType: classifyEmailType(email),
            personName: l.person_name ? String(l.person_name) : null,
            title: l.title ? String(l.title) : null,
            phone: l.phone ? String(l.phone) : null,
            linkedin: l.linkedin ? String(l.linkedin) : null,
            company: l.company ? String(l.company) : null,
            domain: l.domain ? String(l.domain) : domainOf(email.split("@")[1] ? "https://" + email.split("@")[1] : email),
            category: l.category ? String(l.category) : null,
            subcategory: null,
            tier: null,
            confidence: null,
            interests,
            sourceUrl: l.source_url ? String(l.source_url) : null,
            source: "agent",
            raw: { agent: true, input: l },
          };
          if (opts.dryRun) {
            stored++;
            continue;
          }
          const outcome = await upsertLead(db, lead);
          if (outcome === "new") stored++;
          else updated++;
        }
        return JSON.stringify({ stored, updated, rejected, rejectedReasons: rejectedReasons.slice(0, 10) });
      },
    },

    query_leads: {
      name: "query_leads",
      description:
        "Query stored leads from the database. Filters: status (new/verified/invalid), category, " +
        "email_type (corporate/business/student/personal), interest (topic substring). Returns rows.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          category: { type: "string" },
          email_type: { type: "string" },
          interest: { type: "string" },
          limit: { type: "integer", description: "Max rows (default 20)" },
        },
      },
      async run(args) {
        const rows = await listLeads(db, {
          status: args.status ? String(args.status) : undefined,
          category: args.category ? String(args.category) : undefined,
          emailType: args.email_type ? String(args.email_type) : undefined,
          interest: args.interest ? String(args.interest) : undefined,
          limit: Number(args.limit) || 20,
        });
        return JSON.stringify({ count: rows.length, rows });
      },
    },
  };

  return tools;
}