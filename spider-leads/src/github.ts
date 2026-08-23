// GitHub org people discovery — a public, free source of employee names for
// developer/tech companies. Uses api.github.com (unauthenticated: 60 req/h;
// set GITHUB_TOKEN for 5000/h). We only read public data: org members, their
// public profile name + public email, and roles.
// Browser-safe (no node imports) — fetch only.

import type { Person } from "./types.ts";
import { log } from "./log.ts";

const API = "https://api.github.com";

async function ghGet<T>(path: string, base: string, token?: string): Promise<T | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "spider-leads",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = "Bearer " + token;
  const resp = await fetch(base.replace(/\/$/, "") + path, { headers });
  if (resp.status === 404) return null;
  if (resp.status === 403 || resp.status === 429) {
    // Rate limited — the Link header is not parsed; just give up quietly.
    log.warn("GitHub API rate limit reached — skipping GitHub people discovery.");
    return null;
  }
  if (!resp.ok) {
    log.debug("GitHub API " + path + " failed (" + resp.status + ")");
    return null;
  }
  return (await resp.json()) as T;
}

interface GhUser {
  login: string;
  name?: string | null;
  email?: string | null;
  html_url?: string;
  blog?: string | null;
  bio?: string | null;
  company?: string | null;
}

/**
 * Fetch public members of a GitHub organization.
 * @param org  organization login (e.g. "vercel")
 * @param token optional GITHUB_TOKEN for higher rate limits
 * @param limit max members (default 100)
 */
export async function findGithubPeople(
  org: string,
  opts: { token?: string; limit?: number; base?: string } = {}
): Promise<Person[]> {
  const limit = opts.limit ?? 100;
  const base = opts.base ?? API;
  const members = await ghGet<GhUser[]>(`/orgs/${encodeURIComponent(org)}/members?per_page=${Math.min(limit, 100)}`, base, opts.token);
  if (!members || !Array.isArray(members)) return [];

  // Profile fetches are one request each and unauthenticated rate limits are
  // tight — cap them and stop early when lookups keep failing (rate limited).
  const profileCap = Math.min(limit, 25);
  const out: Person[] = [];
  const seen = new Set<string>();
  let consecutiveMisses = 0;
  for (const m of members.slice(0, limit)) {
    if (out.length >= profileCap) break;
    const login = String(m.login ?? "");
    if (!login || seen.has(login)) continue;
    seen.add(login);
    const profile = await ghGet<GhUser>(`/users/${encodeURIComponent(login)}`, base, opts.token);
    if (!profile) {
      consecutiveMisses++;
      if (consecutiveMisses >= 3) break; // likely rate limited — stop burning requests
      continue;
    }
    consecutiveMisses = 0;
    const name = (profile.name ?? m.name ?? "").trim();
    const email = (profile.email ?? m.email ?? "").trim();
    if (!name && !email) continue;
    out.push({
      name: name || login, // fall back to login when no display name
      title: undefined, // GitHub does not expose titles for members
      email: email || undefined,
      github: "https://github.com/" + login,
      source: "github",
      notes: profile.bio ? profile.bio.slice(0, 200) : undefined,
    });
  }
  return out;
}
