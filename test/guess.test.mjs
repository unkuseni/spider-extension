// Unit tests for employee email inference heuristics (spider-leads/src/guess.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { learnPatterns, rankPatterns, candidatesForPerson, guessLabel } from "../spider-leads/src/guess.ts";

test("learnPatterns: counts a known address's pattern", () => {
  const learned = learnPatterns([{ name: "Sarah Chen", email: "sarah.chen@acme.com" }]);
  assert.equal(learned.total, 1);
  assert.equal(learned.counts["first.last"], 1);
});

test("learnPatterns: ignores emails that don't match a known pattern", () => {
  const learned = learnPatterns([{ name: "Sarah Chen", email: "info@acme.com" }]);
  assert.equal(learned.total, 0);
  assert.deepEqual(learned.counts, {});
});

test("rankPatterns: the learned pattern ranks first with a higher score than the generic prior", () => {
  const learned = learnPatterns([{ name: "Sarah Chen", email: "sarah.chen@acme.com" }]);
  const ranked = rankPatterns(learned);
  assert.equal(ranked[0].pattern, "first.last", "learned first.last is the top-ranked pattern");
  assert.ok(ranked[0].score > ranked[1].score, "learned pattern has a strictly higher score than the next");
  // first.last prior is 0.5; learned should boost it above the raw prior.
  assert.ok(ranked[0].score > 0.5, "learned score exceeds the generic prior");
});

test("candidatesForPerson: full ordered list, unique, first.last first for a learned domain", () => {
  const learned = learnPatterns([{ name: "Sarah Chen", email: "sarah.chen@acme.com" }]);
  const cands = candidatesForPerson(
    { name: "Dana Fox", title: "Product Manager", source: "page" },
    "acme.com",
    learned
  );
  assert.equal(cands.length, 10, "all ten pattern candidates are returned (caller slices per-person)");
  const emails = cands.map((c) => c.email);
  assert.equal(new Set(emails).size, 10, "candidate emails are unique");
  // The learned first.last convention wins the top spot.
  assert.equal(cands[0].email, "dana.fox@acme.com");
  assert.equal(cands[0].pattern, "first.last");
  assert.ok(cands[0].score >= 0.6, "learned pattern score is confident");
  // The plain first-name candidate appears late-ish in the ranking.
  const danaOnly = emails.indexOf("dana@acme.com");
  assert.ok(danaOnly >= 4, "dana@acme.com is in the second half of the ordering");
  assert.ok(emails.includes("dana_fox@acme.com"), "underscore variant is present");
  // Mainland-Europe/Nordic conventions are covered (learnable by priority rank).
  assert.ok(emails.includes("foxdana@acme.com"), "lastfirst variant (foxdana) is present");
  assert.ok(emails.includes("fox@acme.com"), "surname-only variant (fox) is present");
});

test("localPartFor: lastfirst + last patterns map correctly", async () => {
  const { localPartFor, PATTERN_LABELS } = await import("../spider-leads/src/people.ts");
  assert.equal(localPartFor("Dana Fox", "lastfirst"), "foxdana");
  assert.equal(localPartFor("Dana Fox", "last"), "fox");
  assert.ok(PATTERN_LABELS.includes("lastfirst"), "lastfirst is a known pattern label");
  assert.ok(PATTERN_LABELS.includes("last"), "last is a known pattern label");
});

test("candidatesForPerson: returns [] for unnameable / too-short input", () => {
  const learned = learnPatterns([]);
  assert.deepEqual(candidatesForPerson({ name: "", source: "page" }, "acme.com", learned), []);
  assert.deepEqual(candidatesForPerson({ name: "Sarah", source: "page" }, "acme.com", learned), []);
  assert.deepEqual(candidatesForPerson({ name: "abc", source: "page" }, "acme.com", learned), []);
});

test("guessLabel: score thresholds map to high / medium / low", () => {
  assert.equal(guessLabel(0.85), "high");
  assert.equal(guessLabel(0.75), "high");
  assert.equal(guessLabel(0.6), "medium");
  assert.equal(guessLabel(0.5), "medium");
  assert.equal(guessLabel(0.4), "low");
  assert.equal(guessLabel(0.0), "low");
});
