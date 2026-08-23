// Employee email inference: build candidate addresses from a person's name,
// rank them by a domain's learned convention, and score plausibility.
// Browser-safe (no node imports).

import type { EmailCandidate, Person } from "./types.ts";
import { asciiName, localPartFor, PATTERN_LABELS, patternOf, splitName } from "./people.ts";
import { isValidEmail } from "./extract.ts";

/** How strongly a known (published/verified) email at the same domain nudges a pattern. */
const LEARNED_PATTERN_BOOST = 0.35;
/** Generic pattern prior (first.last is the most common convention worldwide ≈ 65%). */
const PATTERN_PRIOR: Record<string, number> = {
  "first.last": 0.5,
  "firstlast": 0.18,
  "f.last": 0.1,
  "flast": 0.08,
  "first": 0.06,
  "first_last": 0.04,
  "firstl": 0.02,
  "last.first": 0.02,
};

export interface LearnedPatterns {
  counts: Record<string, number>;
  total: number;
}

/** Learn a domain's email convention from known addresses (published + verified). */
export function learnPatterns(persons: { name: string; email: string }[]): LearnedPatterns {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const p of persons) {
    const pat = patternOf(p.email, p.name);
    if (!pat) continue;
    counts[pat] = (counts[pat] ?? 0) + 1;
    total++;
  }
  return { counts, total };
}

/** Generate candidate addresses for one person at a domain, ordered by score. */
export function candidatesForPerson(
  person: Person,
  domain: string,
  learned: LearnedPatterns
): EmailCandidate[] {
  const name = person.name;
  const parts = splitName(name);
  if (!parts) return [];
  const base = asciiName(name);
  if (base.length < 4) return [];

  const ordered = rankPatterns(learned);
  const out: EmailCandidate[] = [];
  const seen = new Set<string>();
  for (const { pattern, score } of ordered) {
    const local = localPartFor(name, pattern);
    if (!local) continue;
    const email = local + "@" + domain;
    if (!isValidEmail(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      personName: name,
      domain,
      pattern,
      score: clamp(score),
      reason:
        score >= 0.6
          ? "matches the domain's known convention (" + pattern + ")"
          : "common " + pattern + " pattern",
    });
  }
  return out;
}

/** Patterns ordered by learned count (desc), then generic prior. */
export function rankPatterns(learned: LearnedPatterns): { pattern: string; score: number }[] {
  const max = Math.max(1, learned.total);
  return [...new Set([...Object.keys(learned.counts), ...PATTERN_LABELS])]
    .map((pattern) => {
      const learnedScore = (learned.counts[pattern] ?? 0) / max;
      const prior = PATTERN_PRIOR[pattern] ?? 0.01;
      return { pattern, score: clamp(prior + learnedScore * LEARNED_PATTERN_BOOST) };
    })
    .sort((a, b) => b.score - a.score);
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/** A pretty confidence label for a guessed email (for UIs). */
export function guessLabel(score: number): string {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}
