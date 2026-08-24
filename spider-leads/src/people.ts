// People discovery helpers: parse named humans (with titles/LinkedIn/GitHub)
// out of team/leadership/about page text, and split names for email guessing.
// Browser-safe (no node imports) — used by the CLI and the extension bundle.

import type { Person } from "./types.ts";

const GITHUB_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?/g;

/** Extract GitHub org/user slugs from text. Returns unique handles. */
export function extractGithubHandles(text: string): { org: string | null; user: string | null; url: string }[] {
  const out: { org: string | null; user: string | null; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(GITHUB_RE)) {
    const org = m[1];
    const user = m[2] ?? null;
    const url = m[0];
    if (seen.has(org + "/" + (user ?? ""))) continue;
    seen.add(org + "/" + (user ?? ""));
    out.push({
      // A link like github.com/org/team or github.com/org (single segment) is an org.
      org: !user || user === "team" || user === "people" ? org : null,
      user,
      url,
    });
  }
  return out;
}

/** GitHub organization names found on a page (github.com/<org>/ links). */
export function extractGithubOrgs(text: string): string[] {
  const handles = extractGithubHandles(text);
  const orgs = new Set<string>();
  for (const h of handles) {
    if (h.org) orgs.add(h.org);
  }
  return [...orgs];
}

/** GitHub user handles found on a page (github.com/<user> links or @user mentions). */
export function extractGithubUsers(text: string): string[] {
  const handles = extractGithubHandles(text);
  const users = new Set<string>();
  for (const h of handles) if (h.user) users.add(h.user);
  for (const m of text.matchAll(/(?:^|\s)@([A-Za-z0-9_-]{2,30})(?=\s|$)/g)) {
    if (!/^\d+$/.test(m[1])) users.add(m[1]);
  }
  return [...users];
}

const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/g;

/**
 * Parse a public LinkedIn company page (markdown from /scrape) into firmographic
 * data + the employees exposed in the "Employees at <Company>" section.
 * LinkedIn only makes a handful of employee cards public per page, but each one
 * gives a name + profile URL — exactly what pattern-based email guessing needs.
 */
export function extractLinkedinCompany(markdown: string): {
  name: string | null;
  industry: string | null;
  size: string | null;
  hq: string | null;
  website: string | null;
  specialties: string[];
  employeeCount: number | null;
  employees: Person[];
} {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/```+/g, "").trim();
  const m = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;

  const name = m(/^#\s*(.+?)(?:\s*\|\s*LinkedIn)?\s*$/m) || null;
  const industry = m(/^##\s*(.+?)$/m) || null;
  const size = m(/Company size\s*\n?\s*([^\n]+)/i) ?? null;
  const hq = m(/Headquarters\s*\n\s*([^\n]+)/i) ?? null;
  // LinkedIn wraps the site link in a /redir/redirect?url=<encoded> — decode it.
  let website: string | null = null;
  const redir = text.match(/Website\s*\n\s*\[\s*[^\]]*\]\s*\((https:\/\/www\.linkedin\.com\/redir\/redirect\?url=[^)\s]+)\)/i)
    ?? text.match(/Website\s*\n\s*\[?\s*https?:\/\/[^\s)\]]+/i);
  if (redir) {
    const raw = redir[0];
    const urlParam = raw.match(/url=([^&\s)]+)/i)?.[1];
    if (urlParam) {
      try { website = decodeURIComponent(urlParam); } catch { website = urlParam; }
    } else {
      website = raw.match(/(https?:\/\/[^\s)\]]+)/)?.[1] ?? null;
    }
  }
  // "1,001-5,000 employees" → 1001 (range start = lower bound). "2,789 employees" → 2789.
  const sizeStr = size ?? "";
  const firstCount = sizeStr.match(/^(\d[\d,]*)/)?.[1];
  const employeeCount = Number(firstCount?.replace(/[^\d]/g, "")) || null;
  const specialties = (text.match(/Specialties\s*\n?\s*([^\n]+)/i)?.[1] ?? "")
    .split(/,|\band\b/).map((s) => s.trim()).filter(Boolean).slice(0, 12);

  // Employees: "Employees at <Company>" cards — a linkedin.com/in/<slug> link
  // with the profile name on the line before or after it.
  const employees: Person[] = [];
  const seen = new Set<string>();
  const lineByLine = text.split(/\r?\n/);
  const looksLikeName = (s: string) => /^[A-Z][A-Za-zÀ-ÿ'.-]+(\s+[A-Z][A-Za-zÀ-ÿ'.-]+){1,3}$/.test(s);
  /** Strip professional designations (P.Eng, PMP, CPA…) from a LinkedIn card name. */
  const cleanName = (raw: string) =>
    raw
      .replace(/,\s*(?:P\.?\s?Eng|PMP|FOI|CPA|MBA|CFA|PhD|Ph\.?\s?D|LLM|RN|JD)\b.*$/i, "")
      .replace(/\b(?:P\.?\s?Eng|PMP|FOI|CPA|MBA|CFA|PhD|Ph\.?\s?D)\b\.?$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  for (let i = 0; i < lineByLine.length; i++) {
    const profileMatch = lineByLine[i].match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/([A-Za-z0-9_-]+)/);
    if (!profileMatch) continue;
    let nameVal = "";
    // The name usually follows the URL ("](…)\n###\nIan Flegel"), sometimes precedes it.
    for (const cand of [
      lineByLine.slice(i + 1, i + 4).join(" "),
      lineByLine.slice(Math.max(0, i - 4), i).reverse().join(" "),
    ]) {
      const m = cand.match(/[A-Z][A-Za-zÀ-ÿ'.-]+(\s+[A-Z][A-Za-zÀ-ÿ'.-]+){1,3}/);
      if (m && looksLikeName(m[0]) && !/^\d|^View|^See|^https?:/i.test(m[0])) { nameVal = cleanName(m[0]); break; }
    }
    if (!nameVal || seen.has(nameVal.toLowerCase())) continue;
    seen.add(nameVal.toLowerCase());
    employees.push({
      name: nameVal,
      linkedin: /^https?:\/\//.test(profileMatch[0]) ? profileMatch[0] : "https://" + profileMatch[0],
      source: "linkedin",
      notes: "public LinkedIn company page employee card",
    });
  }
  return { name, industry, size, hq, website, specialties, employeeCount, employees };
}

/**
 * Regex-only people extraction (fallback when no AI key): finds lines that look
 * like "Name — Title", "Name, Title", "Name (Title)", or bullet items
 * "Name — Title" on team/leadership pages. Best-effort — the AI extractor is
 * far better; this fills the gap for local mode.
 */
export function extractNamedPeople(markdown: string): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  const lines = markdown.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•·]\s*/, "").trim());
  for (const line of lines) {
    const name = parseNameTitle(line);
    if (!name) continue;
    const key = name.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const linkedin = line.match(LINKEDIN_RE)?.[0];
    const github = line.match(GITHUB_RE)?.[0];
    out.push({
      name: name.name,
      title: name.title,
      linkedin,
      github,
      source: "page",
      sourceUrl: undefined, // caller fills the page URL
    });
  }
  return out;
}

/** Try to interpret a single line as "Name [— , (] Title". */
export function parseNameTitle(line: string): { name: string; title?: string } | null {
  if (!line || line.length > 140) return null;
  // Skip obvious non-person lines (headers, links, prices, emails-only…).
  if (/^(https?:|www\.|tel:|mailto:|@|#|\||\*)/i.test(line)) return null;
  if (/\b(privacy|terms|copyright|all rights|menu|home|about us|login|sign)/i.test(line)) return null;
  if (/(\$\d|\b\d{3,4}[-.)]\s?\d{3,4}\b)/.test(line) && !/[—–,-]/.test(line)) return null;

  // split on —  –  ·  |  , (parens)  :  or " - " (but not hyphenated names)
  const parts = line.split(/\s+[—–·|]\s+|\s+-\s+|,\s+|\s+\(|\s+:\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const maybeName = parts[0];
  const rest = parts[1].replace(/\)$/, "").trim();
  // Name must look like "First Last" (optionally with middle) — 2-4 words, letters only-ish.
  const nameParts = maybeName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || nameParts.length > 4) return null;
  for (const p of nameParts) {
    if (!/^[A-Za-zÀ-ÿ'.-]{1,30}$/.test(p)) return null;
  }
  if (nameParts.some((p) => p.length <= 1 && /^[A-Z]$/.test(p))) {
    // allow single-letter middles
  }
  const name = nameParts.map((p) => /^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
  // A trailing token that is itself an email is not a title ("Name — a@b.com"),
  // and neither is a bare phone number ("John Smith, 555-1234").
  const looksLikeEmail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(rest);
  const looksLikePhone = /^\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{0,4}$/.test(rest) && /[\d\s().-]{7,}/.test(rest);
  const title = !looksLikeEmail && !looksLikePhone && rest.length > 0 && rest.length <= 60 ? rest : undefined;
  if (!title && !looksLikeEmail) return null;
  return { name, title };
}

// ---------------------------------------------------------------------------
// Name utilities (shared by email guessing)
// ---------------------------------------------------------------------------

export interface NameParts {
  first: string;
  last: string;
  middle?: string;
}

/** Split a full name into first/last (and optional middle), handling suffixes. */
export function splitName(fullName: string): NameParts | null {
  const cleaned = (fullName ?? "")
    .replace(/\b(jr|sr|ii|iii|iv|md|phd|esq)\b\.?$/i, "")
    .replace(/[()]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const bad = words.filter((w) => /[0-9@/]/.test(w) || w.startsWith("@") || w.includes("http"));
  if (bad.length > 0 || words.length < 2) return null;
  // Last word may be a company/team word — keep it simple: last word = last name.
  const last = words[words.length - 1];
  const first = words[0];
  if (!/^[A-Za-zÀ-ÿ'.-]+$/.test(first) || !/^[A-Za-zÀ-ÿ'.-]+$/.test(last)) return null;
  const middle = words.length > 2 ? words.slice(1, -1).join(" ") : undefined;
  return { first, last, middle };
}

/** ASCII-folds a name (é → e, ü → u…) so email local-parts match practice. */
export function asciiName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
}

function dots(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}

export function initials(first: string, last: string): string {
  return (first[0] ?? "") + (last[0] ?? "");
}

/** Raw local-part for a single person. */
export function localPartFor(name: string, pattern: string): string | null {
  const parts = splitName(name);
  if (!parts) return null;
  const f = parts.first.toLowerCase();
  const l = parts.last.toLowerCase();
  const fi = f[0];
  const li = l[0];
  switch (pattern) {
    case "first.last": return dots(f + " " + l);
    case "first_last": return f + "_" + l;
    case "firstlast": return f + l;
    case "f.last": return fi + "." + l;
    case "flast": return fi + l;
    case "firstl": return f + li;
    case "f.lastname": return fi + "." + l;
    case "last.first": return dots(l + " " + f);
    case "lastfirst": return l + f;
    case "last": return l;
    case "first": return f;
    default: return null;
  }
}

/** All pattern labels we can generate (most common first). lastfirst + last are
 *  common in mainland Europe / Nordics, where single-surname addresses and
 *  lastname-firstname conventions are widespread. */
export const PATTERN_LABELS = [
  "first.last", "first_last", "firstlast", "f.last", "flast", "firstl", "last.first", "lastfirst", "last", "first",
] as const;

/** Detect which pattern a known address uses (for learning a domain's convention). */
export function patternOf(email: string, name: string): string | null {
  const local = email.split("@")[0].toLowerCase();
  for (const p of PATTERN_LABELS) {
    if (localPartFor(name, p) === local) return p;
  }
  return null;
}
