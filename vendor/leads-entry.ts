// Shared spider-leads pipeline, bundled for the browser extension.
// Built with: npm run build:vendor  →  vendor/leads-core.js

export {
  hunt, huntSearch, verifyStored, ensureDb, defaultRunOptions,
} from "../spider-leads/src/pipeline.ts";
export type { RunOptions, RunSummary } from "../spider-leads/src/pipeline.ts";

export {
  openDb, initSchema, listLeads, dbStats, upsertLead, recordVerification, unverifiedEmails,
} from "../spider-leads/src/db.ts";
export type { LeadRow } from "../spider-leads/src/db.ts";

export { verifyEmail } from "../spider-leads/src/plunk.ts";
export type { VerificationResult } from "../spider-leads/src/types.ts";

export { getSiteLinks, scrapePage, crawlPages, searchPages, extractContactsSpider } from "../spider-leads/src/spider.ts";
export type { PageContent, ContactRecord } from "../spider-leads/src/types.ts";

export { categorizeDomain, parseContacts, CATEGORIES, chatWithTools } from "../spider-leads/src/ai.ts";
export { runAgent } from "../spider-leads/src/agent.ts";
export type { AgentResult } from "../spider-leads/src/agent.ts";
export { buildTools, toolDefs } from "../spider-leads/src/tools.ts";
export { compileJsonPlugin, pluginDataUrls, validateJsonPlugin } from "../spider-leads/src/json-plugin.ts";
export type { JsonPluginManifest, ValidationResult } from "../spider-leads/src/json-plugin.ts";
export { registerRuleSets } from "../spider-leads/src/ai.ts";
export { buildProfile, tailorResume, draftOutreach, scoreFit } from "../spider-leads/src/career.ts";
export type { CareerProfile, JobContext, TailoredPacket, OutreachDraft, FitScore } from "../spider-leads/src/career.ts";
export { classifyEmailType, extractEmails, isValidEmail, domainOf, emailNameHint } from "../spider-leads/src/extract.ts";

export type { Config } from "../spider-leads/src/config.ts";