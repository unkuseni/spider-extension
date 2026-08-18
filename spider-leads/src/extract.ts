// Local (no-AI) extraction: emails, phones, LinkedIn URLs + contact-page URL filtering.

import type { EmailType } from "./types.ts";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// File-extension / placeholder domains that show up as image names or dummy emails.
const BAD_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "yourdomain.com", "yourdomainhere.com",
  "yoursite.com", "domain.com", "domainname.com", "email.com", "test.com", "foo.com",
  "sentry.io", "wixpress.com", "godaddy.com", "sentry.wixpress.com",
  "name.com", "website.com", "mycompany.com", "company.com", "user.com", "yourcompany.com",
  "email.com", "mail.com",
]);
const BAD_TLDS = /\.[a-z]{3,4}$/i; // placeholder catch for .png/.jpg/... handled below
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "css", "js", "map", "ico", "zip", "pdf", "woff", "woff2", "ttf", "eot"]);

export function isValidEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return false;
  if ((e.match(/@/g) ?? []).length !== 1) return false;
  const [local, domain] = e.split("@");
  if (!local || !domain || local.length > 64) return false;
  if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
  const dot = domain.lastIndexOf(".");
  if (dot < 1 || dot === domain.length - 1) return false;
  const tld = domain.slice(dot + 1).toLowerCase();
  if (IMAGE_EXT.has(tld)) return false; // foo@bar.png — image filename
  if (BAD_DOMAINS.has(domain)) return false;
  if (/\d{2,}/.test(tld)) return false; // base64-ish or numeric tld
  return true;
}

export function extractEmails(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (isValidEmail(e)) out.add(e);
  }
  return [...out];
}

const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;

export function extractPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PHONE_RE)) {
    const p = m[0].trim();
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) out.add(p);
  }
  return [...out];
}

const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/g;

export function extractLinkedin(text: string): string[] {
  return [...new Set(text.match(LINKEDIN_RE) ?? [])];
}

// URL path patterns that typically contain people/contact info.
const CONTACT_PATH_RE =
  /\/(?:contact|contacts|team|our-team|meet-the-team|about|about-us|aboutus|staff|people|leadership|leadership-team|founders?|founder-team|board|board-of-directors|management|executive|executives|management-team|careers?|jobs?|directory|employees|who-we-are|impressum|imprint|kontakt|uber-uns)\b/i;

export function isContactUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return false;
    return CONTACT_PATH_RE.test(path);
  } catch {
    return false;
  }
}

/** Keep contact-ish URLs; if nothing matches, return all (bounded) so extraction never comes back empty. */
export function filterContactUrls(urls: string[], max: number): string[] {
  const matched = urls.filter((u) => isContactUrl(u));
  const pool = matched.length > 0 ? matched : urls;
  return [...new Set(pool)].slice(0, max);
}

/** Ensure a domain or bare host becomes an absolute http(s) URL. */
export function toRoot(input: string): string {
  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    return u.protocol + "//" + u.hostname;
  }
  return "https://" + input;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function emailNameHint(email: string): string | null {
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  const parts = local.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}
// ---------------------------------------------------------------------------
// Email type classification: corporate | business | student | personal
// ---------------------------------------------------------------------------

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.co.in",
  "outlook.com", "outlook.co.uk", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.net", "gmx.de", "mail.com", "yandex.com", "yandex.ru", "qq.com",
  "163.com", "126.com", "foxmail.com", "naver.com", "daum.net", "tutanota.com",
  "hey.com", "fastmail.com", "web.de", "t-online.de", "orange.fr", "free.fr",
  "libero.it", "alice.it", "virgilio.it", "sina.com", "sohu.com", "rediffmail.com",
]);

// Role-based / generic business mailboxes (info@, sales@, …).
const ROLE_LOCAL_PARTS = new Set([
  "info", "sales", "support", "contact", "hello", "help", "admin", "office",
  "enquiries", "enquiry", "inquiries", "inquiry", "careers", "jobs", "hr",
  "billing", "accounts", "marketing", "press", "media", "team", "general",
  "mail", "email", "reception", "bookings", "reservations", "service",
  "partners", "feedback", "privacy", "legal", "webmaster", "postmaster",
  "abuse", "welcome", "connect", "ask", "start", "talk", "hello", "hi",
]);

/** student: .edu (US), .ac.XX (UK/EU/etc), *.edu.XX */
function isStudentDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  if (lower.endsWith(".edu")) return true;
  if (/\.ac\.[a-z]{2}$/.test(lower)) return true;
  if (/\.edu\.[a-z]{2}$/.test(lower)) return true;
  return false;
}

/**
 * Classify an email address:
 *  - student   → university / education-domain addresses (.edu, .ac.uk, …)
 *  - personal  → free personal mail providers (gmail, outlook, yahoo, iCloud, …)
 *  - business  → role-based mailboxes at a company domain (info@, sales@, …)
 *  - corporate → person addresses at a company domain (jane@acme.com)
 */
export function classifyEmailType(email: string): EmailType {
  const clean = (email ?? "").toLowerCase().trim();
  const at = clean.indexOf("@");
  if (at <= 0 || at === clean.length - 1) return "unknown";
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (isStudentDomain(domain)) return "student";
  const domain2 = domain.split(".").slice(-2).join(".");
  if (PERSONAL_DOMAINS.has(domain) || PERSONAL_DOMAINS.has(domain2)) return "personal";
  if (ROLE_LOCAL_PARTS.has(local)) return "business";
  return "corporate";
}