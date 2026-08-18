// Shared types for spider-leads (erasable-syntax TS — runs directly under Node 24 type stripping)

export type ExtractMode = "auto" | "local" | "spider";
export type RequestMode = "smart" | "http" | "browser";
export type LeadStatus = "new" | "verified" | "invalid" | "error";
export type EmailType = "corporate" | "business" | "student" | "personal" | "unknown";

export interface Interest {
  topic: string;
  confidence: number;
}

export interface PageContent {
  url: string;
  markdown: string;
  status: number;
}

export interface ContactRecord {
  email?: string;
  person_name?: string;
  title?: string;
  phone?: string;
  linkedin?: string;
}

export interface Categorization {
  category: string;
  subcategory: string;
  tier: string;
  confidence: number;
  reason: string;
  method: "ai" | "rules";
  interests: Interest[];
}

export interface VerificationResult {
  valid: boolean;
  isDisposable: boolean;
  isAlias: boolean;
  isTypo: boolean;
  isPlusAddressed: boolean;
  isPersonalEmail: boolean;
  domainExists: boolean;
  hasWebsite: boolean;
  hasMxRecords: boolean;
  reasons: string[];
  checkedAt: string;
}

export interface Lead {
  email: string | null;
  emailType: EmailType | null;
  personName: string | null;
  title: string | null;
  phone: string | null;
  linkedin: string | null;
  company: string | null;
  domain: string | null;
  category: string | null;
  subcategory: string | null;
  tier: string | null;
  confidence: number | null;
  interests: Interest[];
  sourceUrl: string | null;
  source: string; // hunt | search
  raw: unknown;
}

export interface RunSummary {
  id: string;
  target: string;
  source: string;
  pagesCrawled: number;
  leadsFound: number;
  leadsNew: number;
  leadsUpdated: number;
  leadsVerified: number;
  leadsInvalid: number;
  errors: string[];
}