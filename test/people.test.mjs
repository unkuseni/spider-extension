// Unit tests for people discovery helpers (spider-leads/src/people.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitName, localPartFor, patternOf, PATTERN_LABELS,
  extractNamedPeople, extractGithubOrgs, extractGithubUsers,
} from "../spider-leads/src/people.ts";

test("splitName: first/last with simple names", () => {
  // Assert fields rather than exact shape so the optional `middle` presence is irrelevant.
  const sarah = splitName("Sarah Chen");
  assert.equal(sarah?.first, "Sarah");
  assert.equal(sarah?.last, "Chen");
  const priya = splitName("Priya Kapoor");
  assert.equal(priya?.first, "Priya");
  assert.equal(priya?.last, "Kapoor");
});

test("splitName: middle-name handling (includes the middle token)", () => {
  assert.equal(splitName("John A. Smith")?.first, "John");
  assert.equal(splitName("John A. Smith")?.last, "Smith");
  assert.equal(splitName("John A. Smith")?.middle, "A.");
});

test("splitName: strips honorific/suffix tokens", () => {
  const r = splitName("John Smith Jr");
  assert.equal(r?.first, "John");
  assert.equal(r?.last, "Smith");
});

test("splitName: rejects junk / non-names", () => {
  assert.equal(splitName("Sarah"), null);        // single word
  assert.equal(splitName(""), null);             // empty
  assert.equal(splitName("John 123 St"), null);  // digits / address-like
  assert.equal(splitName("hello@acme.com"), null); // email
});

test("localPartFor + patternOf round-trip every PATTERN_LABELS value", () => {
  // We need a name whose parts are all lower-case safe (Dana Fox → dana / fox).
  for (const p of PATTERN_LABELS) {
    const local = localPartFor("Dana Fox", p);
    assert.ok(local, `localPartFor produces a local part for ${p}`);
    // Round-trip: the detected pattern of the generated address must equal the one we used.
    assert.equal(patternOf(local + "@acme.com", "Dana Fox"), p, `patternOf round-trips ${p}`);
  }
});

test("extractNamedPeople: team lines become people (correct names/titles)", () => {
  const md = `# Team
- Dana Fox — Product Manager
- Sam Patel, CEO
- Alex Nguyen (Founder)
# Team
privacy
hello@acme.com
`;
  const people = extractNamedPeople(md);
  assert.equal(people.length, 3, "three named people extracted");
  const byName = new Map(people.map((p) => [p.name, p]));
  assert.equal(byName.get("Dana Fox")?.title, "Product Manager");
  assert.equal(byName.get("Sam Patel")?.title, "CEO");
  assert.equal(byName.get("Alex Nguyen")?.title, "Founder");
  for (const p of people) assert.equal(p.source, "page");
});

test("extractNamedPeople: ignores headers, privacy/single words, and emails-only lines", () => {
  const md = `# Team
Privacy Policy
support@acme.com
- Dana Fox — Product Manager
`;
  const people = extractNamedPeople(md);
  assert.deepEqual(people.map((p) => p.name), ["Dana Fox"]);
});

test("extractGithubOrgs: org/team links are organizations", () => {
  const page = `See https://github.com/acme-inc/team and https://github.com/acme-inc/people`;
  assert.deepEqual(extractGithubOrgs(page), ["acme-inc"]);
  // A repo-style two-segment link (org/user) is not counted as an extra org.
  assert.deepEqual(extractGithubOrgs("https://github.com/acme-inc/someone"), []);
});

test("extractGithubUsers: user links and @mentions are users", () => {
  const page = `https://github.com/acme-inc/team and https://github.com/acme-inc/someone and @dana`;
  const users = extractGithubUsers(page);
  assert.ok(users.includes("someone"), "two-segment link user extracted");
  assert.ok(users.includes("dana"), "@mention extracted");
  assert.ok(users.includes("team"), "org team page counts as a handle");
});
