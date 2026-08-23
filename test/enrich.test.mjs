// Integration test for employee email enrichment (spider-leads/src/enrich.ts).
// Uses the mock API's deterministic verify-pattern mode + GitHub roster.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg, tempDbPath, cleanupDb } from "./helpers/ctx.mjs";

let mock, cfg, tmp, db;

before(async () => {
  // Deterministic verification: at acme.com, only first.last-shaped addresses verify as valid.
  mock = await startMock({ verifyPattern: "first.last", verifyHosts: ["acme.com"] });
  cfg = await testCfg(mock.url);
  tmp = tempDbPath();
  cfg.tursoUrl = "file:" + tmp.db;
  const { ensureDb } = await import("../spider-leads/src/pipeline.ts");
  db = await ensureDb(cfg);
});

after(async () => {
  try { await db.close(); } catch { /* ignore */ }
  await mock.close();
  cleanupDb(tmp.dir);
});

function validVerification(email) {
  return {
    valid: true, isDisposable: false, isAlias: false, isTypo: false,
    isPlusAddressed: false, isPersonalEmail: false, domainExists: true,
    hasWebsite: true, hasMxRecords: true, reasons: ["Email appears to be valid"],
    checkedAt: new Date().toISOString(),
  };
}

test("enrichDomain: learns first.last, guesses a verified lead, records candidates", async () => {
  const { upsertLead, recordVerification, listLeads, peopleForDomain, candidatesForDomain } =
    await import("../spider-leads/src/db.ts");
  // Seed a known, verified address so the domain's address convention (first.last) is learned.
  await upsertLead(db, {
    email: "sarah.chen@acme.com", emailType: "corporate", emailSource: "page",
    personName: "Sarah Chen", title: "VP Engineering", phone: null, linkedin: null,
    company: "acme.com", domain: "acme.com", category: null, subcategory: null, tier: null,
    confidence: null, interests: [], sourceUrl: null, source: "test", raw: null,
  });
  await recordVerification(db, "sarah.chen@acme.com", validVerification("sarah.chen@acme.com"));

  const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
  const res = await enrichDomain(db, cfg, "acme.com", {
    people: [{ name: "Dana Fox", title: "Product Manager", source: "page" }],
    verify: true,
    perPerson: 3,
    meta: { company: "acme.com" },
  });

  assert.ok(res.candidatesGenerated >= 2, "at least two candidate addresses generated");
  assert.ok(res.emailsFound >= 1, "at least one guessed email found");
  assert.ok(res.candidatesVerified === res.candidatesGenerated, "every candidate was verified");
  // The result carries the found emails with their pattern + score.
  assert.ok(Array.isArray(res.emails), "enrich result includes an emails array");
  assert.ok(
    res.emails.some((e) => e.email === "dana.fox@acme.com" && e.pattern === "first.last"),
    "emails array lists the guessed dana.fox@acme.com with pattern first.last"
  );
  // dana.fox + d.fox (both first.last/f.last shaped) verify valid; danafox@acme.com is rejected.
  assert.ok(res.invalid >= 1, "a non-matching candidate is recorded as invalid in the result");
  assert.equal(res.errors.length, 0, "no verification errors");

  const leads = await listLeads(db, { limit: 50 });
  const dana = leads.find((r) => r.email === "dana.fox@acme.com");
  assert.ok(dana, "dana.fox@acme.com stored as a lead");
  assert.equal(dana.email_source, "guessed");
  assert.equal(dana.email_pattern, "first.last");
  assert.equal(dana.status, "verified");
  assert.ok(typeof dana.email_score === "number" && dana.email_score >= 0.6, "confident score");

  const validCands = await candidatesForDomain(db, "acme.com", { status: "valid" });
  assert.ok(validCands.some((c) => c.email === "dana.fox@acme.com"), "dana.fox candidate marked valid");
  const invalidCands = await candidatesForDomain(db, "acme.com", { status: "invalid" });
  assert.ok(invalidCands.some((c) => c.email === "danafox@acme.com"), "danafox candidate marked invalid");

  const people = await peopleForDomain(db, "acme.com");
  assert.ok(people.some((p) => p.name === "Dana Fox"), "Dana Fox stored in the people table");
});

test("enrichDomain: no re-guessing of already-stored candidates on a second run", async () => {
  const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
  const { listLeads } = await import("../spider-leads/src/db.ts");

  const before = await listLeads(db, { limit: 50 });
  const guessedBefore = before.filter((r) => r.email_source === "guessed").length;

  // Same perPerson as the first run. The top candidates after learning are the
  // already-stored dana.fox + d.fox leads, and the invalid danafox is now recorded,
  // so nothing new is generated (confirmed + rejected addresses are not re-guessed).
  const res = await enrichDomain(db, cfg, "acme.com", {
    people: [],
    verify: true,
    perPerson: 3,
    meta: { company: "acme.com" },
  });

  assert.equal(res.candidatesGenerated, 0, "no new candidates regenerated");
  assert.equal(res.emailsFound, 0, "no new guessed emails");

  const after = await listLeads(db, { limit: 50 });
  const guessedAfter = after.filter((r) => r.email_source === "guessed").length;
  assert.equal(guessedAfter, guessedBefore, "no new guessed leads on the second run");
});

test("enrichDomain: GitHub members stored as people; public emails become leads (source github)", async () => {
  const t3 = tempDbPath();
  const cfg3 = await testCfg(mock.url);
  cfg3.tursoUrl = "file:" + t3.db;
  const { ensureDb } = await import("../spider-leads/src/pipeline.ts");
  const db3 = await ensureDb(cfg3);
  try {
    const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
    const res = await enrichDomain(db3, cfg3, "acme.com", {
      githubOrgs: ["acme-inc"],
      githubApiBase: mock.url,
      verify: false,
      meta: { company: "acme.com" },
    });

    const { peopleForDomain, listLeads } = await import("../spider-leads/src/db.ts");
    const people = await peopleForDomain(db3, "acme.com");
    const names = people.map((p) => p.name);
    assert.ok(names.includes("Dana Fox"), "Dana Fox stored from GitHub members");
    assert.ok(names.includes("Sam Patel"), "Sam Patel stored from GitHub members");

    const leads = await listLeads(db3, { limit: 50 });
    const dana = leads.find((r) => r.email === "dana.fox@acme.com");
    assert.ok(dana, "dana.fox@acme.com stored as a lead");
    assert.equal(dana.email_source, "github", "public GitHub email sourced as 'github'");
    assert.ok(res.emailsFound >= 1, "public GitHub email counted as found");
    // Verify off → no plunk calls, but the GitHub email address is still persisted.
    assert.equal(leads.filter((r) => r.email === "dana.fox@acme.com").length, 1);
  } finally {
    try { await db3.close(); } catch { /* ignore */ }
    cleanupDb(t3.dir);
  }
});
