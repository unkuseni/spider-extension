// AI layer: any OpenAI-compatible chat endpoint (OpenAI, Groq, Ollama, LM Studio…).
// Used for 1) domain categorization and 2) structured contact parsing.
// Falls back to keyword rules when no API key is configured.

import type { Config } from "./config.ts";
import type { Categorization, ContactRecord, Interest, PageContent } from "./types.ts";
import { emailNameHint, extractEmails, extractLinkedin, extractPhones } from "./extract.ts";
import { extractNamedPeople } from "./people.ts";
import { log } from "./log.ts";

export const CATEGORIES = [
  "SaaS / Software", "Agency / Services", "E-commerce / Retail", "Consulting",
  "Manufacturing / Industrial", "Finance / Insurance", "Healthcare", "Education / Training",
  "Real Estate / Construction", "Media / Publishing", "Hospitality / Travel",
  "Nonprofit / Government", "Other",
];

export function hasAiKey(cfg: Config): boolean {
  return cfg.openaiApiKey.length > 0;
}

export async function chatJson(
  cfg: Config,
  system: string,
  user: string,
  maxTokens = 1200
): Promise<string> {
  return chatJsonOnce(cfg, system, user, maxTokens, true).catch(async (err: Error) => {
    // Some providers/models reject response_format (e.g. DeepSeek reasoner) and the
    // error wording varies — retry without JSON mode on any 400, never on auth 401.
    if (/\b400\b/.test(err.message) && !/\b401\b/.test(err.message)) {
      return chatJsonOnce(cfg, system, user, maxTokens, false);
    }
    throw err;
  });
}

async function chatJsonOnce(
  cfg: Config,
  system: string,
  user: string,
  maxTokens: number,
  useJsonMode: boolean
): Promise<string> {
  const payload: Record<string, unknown> = {
    model: cfg.openaiModel,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (useJsonMode) payload.response_format = { type: "json_object" };
  const resp = await fetch(cfg.openaiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`AI request failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data: any = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  return content;
}

// ---------------------------------------------------------------------------
// Tool / function calling (OpenAI-compatible: OpenAI, DeepSeek chat, Groq, Ollama…)
// ---------------------------------------------------------------------------

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallMsg {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatWithToolsResult {
  content: string;
  toolCalls: ToolCallMsg[];
}

function tryParseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    return {};
  }
}

/**
 * Single chat round with tool definitions. Does NOT use response_format
 * (function calling and JSON mode are mutually exclusive on some providers,
 * e.g. DeepSeek). Returns the assistant text plus any requested tool calls.
 */
export async function chatWithTools(
  cfg: Config,
  messages: any[],
  tools: ToolDef[]
): Promise<ChatWithToolsResult> {
  const payload: Record<string, unknown> = {
    model: cfg.openaiModel,
    temperature: 0,
    max_tokens: 4000,
    messages,
  };
  if (tools.length > 0) payload.tools = tools;

  const resp = await fetch(cfg.openaiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.openaiApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error("AI tool call failed (" + resp.status + "): " + body.slice(0, 300));
  }
  const data: any = await resp.json();
  const message = data?.choices?.[0]?.message ?? {};
  const content: string = typeof message.content === "string" ? message.content : "";
  const rawCalls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCallMsg[] = rawCalls.map((tc) => ({
    id: String(tc.id ?? "call_" + Math.random().toString(36).slice(2)),
    name: String(tc?.function?.name ?? ""),
    args: tryParseArgs(String(tc?.function?.arguments ?? "{}")),
  })).filter((tc) => tc.name.length > 0);
  return { content, toolCalls };
}

/** Robustly pull the first JSON object out of an LLM answer. */
export function parseJsonObject(text: string): any {
  const cleaned = text.replace(/^\s*\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch { /* fall through */ }
  }
  throw new Error("AI returned no parseable JSON: " + text.slice(0, 200));
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugin-contributed rules (JSON plugins register keyword rules without code)
// ---------------------------------------------------------------------------

interface ExtraRule { match: RegExp; label: string }
const EXTRA_CATEGORY_RULES: ExtraRule[] = [];
const EXTRA_INTEREST_RULES: ExtraRule[] = [];
const registeredRuleSets = new Set<string>();

/** Register category/interest rules from a JSON plugin (idempotent per plugin id). */
export function registerRuleSets(pluginId: string, rules: { categories?: { match: string; category: string }[]; interests?: { match: string; topic: string; confidence?: number }[] } | undefined): void {
  if (!rules) return;
  if (registeredRuleSets.has(pluginId)) return;
  registeredRuleSets.add(pluginId);
  for (const r of rules.categories ?? []) {
    try { EXTRA_CATEGORY_RULES.push({ match: new RegExp(r.match, "i"), label: r.category }); } catch { /* bad regex ignored */ }
  }
  for (const r of rules.interests ?? []) {
    try { EXTRA_INTEREST_RULES.push({ match: new RegExp(r.match, "i"), label: r.topic }); } catch { /* bad regex ignored */ }
  }
}

const RULE_CATEGORIES: [RegExp, string, string][] = [
  [/\b(shopify|woocommerce|etsy|amazon|e-commerce|ecommerce|store|products?|cart)\b/i, "E-commerce / Retail", "storefront language"],
  [/\b(saas|software|cloud|platform|api|developer|app |app$|technology|tech |ai |machine learning|data)\b/i, "SaaS / Software", "technology language"],
  [/\b(agency|studio|marketing|design|creative|consultancy|consulting|services)\b/i, "Agency / Services", "agency language"],
  [/\b(manufactur|industrial|factory|logistics|supply chain|wholesale|distribut)\b/i, "Manufacturing / Industrial", "industrial language"],
  [/\b(bank|fintech|insurance|invest|capital|finance|financial|payments?|credit)\b/i, "Finance / Insurance", "finance language"],
  [/\b(hospital|clinic|medical|health|care|wellness|dental|pharma)\b/i, "Healthcare", "healthcare language"],
  [/\b(school|university|college|academy|training|education|learn|course|tutoring)\b/i, "Education / Training", "education language"],
  [/\b(real estate|property|construction|building|architecture|interior|realtor|housing)\b/i, "Real Estate / Construction", "real estate language"],
  [/\b(news|media|publish|magazine|blog|podcast|youtube|journal)\b/i, "Media / Publishing", "media language"],
  [/\b(hotel|travel|tourism|restaurant|hospitality|resort|cafe|food)\b/i, "Hospitality / Travel", "hospitality language"],
  [/\b(nonprofit|non-profit|foundation|charity|ngo|organization|ministry|church)\b/i, "Nonprofit / Government", "nonprofit language"],
];

const INTEREST_RULES: [RegExp, string][] = [
  [/\b(ai|artificial intelligence|machine learning|llm|gpt|neural|deep learning|agent)\b/i, "AI / Machine Learning"],
  [/\b(cloud|aws|azure|gcp|kubernetes|devops|infrastructure|serverless)\b/i, "Cloud / DevOps"],
  [/\b(fintech|payments?|banking|investing|blockchain|crypto|web3|defi)\b/i, "Fintech / Web3"],
  [/\b(ecommerce|e-commerce|shopify|dropshipping|retail|marketplace|online store)\b/i, "E-commerce"],
  [/\b(cybersecurity|security|privacy|compliance|gdpr|ransomware)\b/i, "Security / Privacy"],
  [/\b(sustainability|esg|green|renewable|climate|carbon|clean energy)\b/i, "Sustainability / ESG"],
  [/\b(healthcare|health|medical|wellness|biotech|pharma|clinic|hospital)\b/i, "Healthcare / Biotech"],
  [/\b(education|elearning|edtech|online course|university|training|academy)\b/i, "Education / EdTech"],
  [/\b(real estate|property|proptech|construction|housing|realtor)\b/i, "Real Estate / PropTech"],
  [/\b(marketing|seo|content|social media|growth|brand|advertising)\b/i, "Marketing / Growth"],
  [/\b(gaming|esports|metaverse|vr|ar|game studio)\b/i, "Gaming / XR"],
  [/\b(sales|b2b|lead generation|crm|outbound|revenue)\b/i, "Sales / CRM"],
  [/\b(data|analytics|big data|database|business intelligence|dashboard)\b/i, "Data / Analytics"],
  [/\b(automotive|ev|electric vehicle|mobility|charging)\b/i, "Automotive / Mobility"],
  [/\b(logistics|supply chain|shipping|fulfillment|freight|warehouse)\b/i, "Logistics / Supply Chain"],
  [/\b(food|restaurant|hospitality|travel|tourism|hotel)\b/i, "Food / Travel"],
  [/\b(energy|oil|gas|solar|power|utilities|grid)\b/i, "Energy"],
  [/\b(legal|law|attorney|lawyer|litigation)\b/i, "Legal"],
  [/\b(recruiting|hiring|talent|hr|people ops|headhunting)\b/i, "HR / Talent"],
  [/\b(manufactur|industrial|factory|supply chain|logistics)\b/i, "Manufacturing / Industrial"],
  [/\b(saas|software|api|developer|platform|startup|product)\b/i, "SaaS / Startups"],
];

export function extractInterestsByRules(texts: string[]): Interest[] {
  const haystack = texts.join(" ").slice(0, 20000).toLowerCase();
  const out: Interest[] = [];
  for (const [re, topic] of INTEREST_RULES) {
    const hits = (haystack.match(re) ?? []).length;
    if (hits > 0) {
      out.push({ topic, confidence: Math.min(0.4 + hits * 0.12, 0.85) });
    }
  }
  for (const rule of EXTRA_INTEREST_RULES) {
    const hits = (haystack.match(rule.match) ?? []).length;
    if (hits > 0) {
      out.push({ topic: rule.label, confidence: Math.min(0.5 + hits * 0.1, 0.8) });
    }
  }
  return out.sort((x, y) => y.confidence - x.confidence).slice(0, 8);
}

export function categorizeByRules(texts: string[]): Categorization {
  const haystack = texts.join(" ").slice(0, 20000);
  let best: [string, string, number] | null = null;
  for (const [re, cat, why] of RULE_CATEGORIES) {
    const hits = (haystack.match(re) ?? []).length;
    if (hits > 0 && (!best || hits > best[2])) best = [cat, why, hits];
  }
  // Plugin-contributed category rules (weighted equally with built-ins)
  for (const rule of EXTRA_CATEGORY_RULES) {
    const hits = (haystack.match(rule.match) ?? []).length;
    if (hits > 0 && (!best || hits > best[2])) best = [rule.label, "plugin rule", hits];
  }
  const base = best
    ? {
        category: best[0],
        subcategory: best[1],
        tier: "Unknown",
        confidence: Math.min(0.5 + best[2] * 0.08, 0.85),
        reason: `keyword match (${best[1]})`,
      }
    : { category: "Other", subcategory: "", tier: "Unknown", confidence: 0.3, reason: "no strong signal" };
  return { ...base, method: "rules", interests: extractInterestsByRules(texts) };
}

export async function categorizeDomain(
  cfg: Config,
  domain: string,
  pages: PageContent[]
): Promise<Categorization> {
  const texts = pages.map((p) => p.markdown.slice(0, 4000));
  if (!hasAiKey(cfg)) {
    log.debug(`categorizing ${domain} with rules (no OPENAI_API_KEY)`);
    return categorizeByRules(texts);
  }
  try {
    const snippet = texts.join("\n\n---\n\n").slice(0, 20000);
    const system =
      "You classify businesses for B2B lead generation. Return ONLY JSON with keys: " +
      "category (one of: " + CATEGORIES.join(", ") + "), subcategory (short, e.g. \"B2B marketing agency\"), " +
      "tier (SMB | Mid-market | Enterprise | Unknown), confidence (0-1), reason (one sentence), " +
      "interests (array of 3-6 objects {topic, confidence} — topics this company or its audience cares " +
      "about, e.g. \"AI / Machine Learning\", \"Sustainability\", \"Developer Tools\").";
    const user = `Classify this company. Domain: ${domain}\n\nWebsite content:\n\n${snippet}`;
    const json = parseJsonObject(await chatJson(cfg, system, user));
    const cat = String(json.category ?? "Other");
    const rawInterests: any[] = Array.isArray(json.interests) ? json.interests : [];
    const interests: Interest[] = rawInterests
      .map((i) => ({
        topic: String(i?.topic ?? "").trim(),
        confidence: Math.min(Math.max(Number(i?.confidence) || 0.5, 0), 1),
      }))
      .filter((i) => i.topic.length > 0)
      .slice(0, 8);
    return {
      category: CATEGORIES.includes(cat) ? cat : "Other",
      subcategory: String(json.subcategory ?? ""),
      tier: String(json.tier ?? "Unknown"),
      confidence: Math.min(Math.max(Number(json.confidence) || 0.5, 0), 1),
      reason: String(json.reason ?? ""),
      method: "ai",
      interests: interests.length > 0 ? interests : extractInterestsByRules(texts),
    };
  } catch (err) {
    log.warn(`AI categorization failed for ${domain}: ${(err as Error).message} — using rules`);
    return categorizeByRules(texts);
  }
}

// ---------------------------------------------------------------------------
// Contact parsing
// ---------------------------------------------------------------------------

/** Regex-only parsing (fallback). */
export function parseContactsLocal(pages: PageContent[]): ContactRecord[] {
  const seen = new Set<string>();
  const out: ContactRecord[] = [];
  for (const page of pages) {
    const emails = extractEmails(page.markdown);
    const phones = extractPhones(page.markdown);
    const linkedin = extractLinkedin(page.markdown);
    for (const email of emails) {
      const key = email;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        email,
        person_name: emailNameHint(email) ?? undefined,
        linkedin: linkedin[0],
        phone: phones[0],
      });
    }
    if (emails.length === 0) {
      for (const phone of phones.slice(0, 2)) {
        const key = "p:" + phone;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ phone, person_name: undefined });
      }
    }
    // Named people without a published email (feeds employee email guessing).
    for (const person of extractNamedPeople(page.markdown)) {
      const key = "n:" + person.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        person_name: person.name,
        title: person.title,
        linkedin: person.linkedin,
        github: undefined,
      });
    }
  }
  return out;
}

/**
 * AI-powered contact parsing: extract structured contacts from crawled pages.
 * Falls back to regex when no AI key is configured.
 */
export async function parseContacts(
  cfg: Config,
  pages: PageContent[],
  company: string
): Promise<ContactRecord[]> {
  const textPages = pages.filter((p) => p.markdown.trim().length > 0);
  if (!hasAiKey(cfg) || textPages.length === 0) {
    return parseContactsLocal(textPages.length > 0 ? textPages : pages);
  }

  const out: ContactRecord[] = [];
  const seen = new Set<string>();
  const CHUNK_CHARS = 35000;

  let chunk: PageContent[] = [];
  let chunkSize = 0;
  const flush = async (): Promise<void> => {
    if (chunk.length === 0) return;
    try {
      const snippet = chunk
        .map((p) => `URL: ${p.url}\n${p.markdown.slice(0, 6000)}`)
        .join("\n\n----\n\n")
        .slice(0, CHUNK_CHARS);
      const system =
        "You extract business contact information from website pages for B2B lead generation. " +
        "Return ONLY a JSON object: {\"contacts\": [{\"email\": \"…\", \"person_name\": \"…\", " +
        "\"title\": \"…\", \"phone\": \"…\", \"linkedin\": \"…\"}]}. " +
        "Include only real contact records that appear in the text. Include team members even when no " +
        "email is published (set email to null — the name, title and LinkedIn are what matter). " +
        "Email must look like a real address (reject image filenames, placeholder domains, @example.com etc.). " +
        "Use null for unknown fields.";
      const user = `Company: ${company}\n\nPages:\n\n${snippet}`;
      const json = parseJsonObject(await chatJson(cfg, system, user, 2000));
      const contacts: any[] = Array.isArray(json.contacts) ? json.contacts : [];
      for (const c of contacts) {
        const rec: ContactRecord = {
          email: typeof c.email === "string" && c.email ? c.email.toLowerCase() : undefined,
          person_name: typeof c.person_name === "string" ? c.person_name : undefined,
          title: typeof c.title === "string" ? c.title : undefined,
          phone: typeof c.phone === "string" ? c.phone : undefined,
          linkedin: typeof c.linkedin === "string" ? c.linkedin : undefined,
          github: typeof c.github === "string" ? c.github : undefined,
        };
        const key = rec.email ?? `p:${rec.phone ?? rec.person_name ?? Math.random()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
    } catch (err) {
      log.warn(`AI contact parsing failed: ${(err as Error).message} — falling back to regex for this chunk`);
      for (const rec of parseContactsLocal(chunk)) {
        const key = rec.email ?? `p:${rec.phone ?? Math.random()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
    }
    chunk = [];
    chunkSize = 0;
  };

  for (const page of textPages) {
    chunk.push(page);
    chunkSize += page.markdown.length;
    if (chunkSize >= CHUNK_CHARS) await flush();
  }
  await flush();
  return out;
}