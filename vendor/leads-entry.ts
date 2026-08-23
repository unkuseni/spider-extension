// Shared spider-leads pipeline, bundled for the browser extension.
// Built with: npm run build:vendor  →  vendor/leads-core.js

export {
  hunt, huntSearch, verifyStored, ensureDb, defaultRunOptions,
  extractContactsFromSite,
} from "../spider-leads/src/pipeline.ts";
export type { RunOptions, RunSummary } from "../spider-leads/src/pipeline.ts";

export {
  openDb, initSchema, listLeads, dbStats, upsertLead, recordVerification, unverifiedEmails,
  upsertPerson, peopleForDomain, knownEmailsForDomain, listPeople,
  upsertCandidate, markCandidate, candidatesForDomain,
  upsertRelation, relationsForDomain, relatedDomainsFor, leadsRelatedTo, updateLeadScore,
} from "../spider-leads/src/db.ts";
export type { LeadRow, PersonRow, CandidateRow, RelationRow } from "../spider-leads/src/db.ts";

export { verifyEmail } from "../spider-leads/src/plunk.ts";
export type { VerificationResult } from "../spider-leads/src/types.ts";

export { getSiteLinks, scrapePage, crawlPages, searchPages, extractContactsSpider, fetchStructured, fetchPathFromUrl } from "../spider-leads/src/spider.ts";
export type { FetchResult } from "../spider-leads/src/spider.ts";
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

export { enrichDomain, storePersons } from "../spider-leads/src/enrich.ts";
export type { EnrichOptions } from "../spider-leads/src/enrich.ts";
export { candidatesForPerson, learnPatterns, rankPatterns, guessLabel } from "../spider-leads/src/guess.ts";
export { extractNamedPeople, extractGithubOrgs, extractGithubUsers, splitName, patternOf, PATTERN_LABELS } from "../spider-leads/src/people.ts";
export { findGithubPeople } from "../spider-leads/src/github.ts";
export { classifyTitle, scoreLead, icpMatch, gradeLabel } from "../spider-leads/src/leadscore.ts";
export type { LeadClass, ScoreInput } from "../spider-leads/src/leadscore.ts";
export type { Person, EmailCandidate, EmployeeEnrichResult, EmailSource, CandidateStatus, CompanyRelation } from "../spider-leads/src/types.ts";

export type { Config } from "../spider-leads/src/config.ts";