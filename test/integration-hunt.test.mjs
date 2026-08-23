import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg, tempDbPath, cleanupDb } from "./helpers/ctx.mjs";

let mock, cfg, tmp;
let db;

before(async () => {
  mock = await startMock();
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

test("hunt: extracts, categorizes, types, and stores leads", async () => {
  const { hunt, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const opts = defaultRunOptions(cfg);
  opts.limit = 6;
  opts.extract = "local";
  opts.verify = false;
  const summary = await hunt(db, cfg, ["acme.com"], opts);
  assert.equal(summary.leadsFound, 3);
  assert.equal(summary.leadsNew, 3);
  assert.equal(summary.errors.length, 0);
  assert.ok(summary.pagesCrawled >= 4);

  const { listLeads } = await import("../spider-leads/src/db.ts");
  const rows = await listLeads(db, { limit: 10 });
  assert.equal(rows.length, 3);
  const sarah = rows.find((r) => r.email === "sarah.chen@acme.com");
  assert.ok(sarah);
  assert.equal(sarah.email_type, "corporate");
  assert.equal(sarah.category, "SaaS / Software");
  assert.ok(sarah.interests && sarah.interests.includes("AI / Machine Learning"));
  const hello = rows.find((r) => r.email === "hello@acme.com");
  assert.equal(hello.email_type, "business");
});

test("search: same pipeline over web results", async () => {
  const { huntSearch, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const opts = defaultRunOptions(cfg);
  opts.limit = 3;
  opts.extract = "local";
  opts.verify = false;
  const summary = await huntSearch(db, cfg, "b2b saas companies", opts);
  // 3 mock result pages, 3 contacts each
  assert.equal(summary.leadsFound, 9);
  assert.equal(summary.errors.length, 0);
  // acme's 3 leads already exist from the hunt → deduped as "updated",
  // so the DB gains 6 new leads (globex + initech), total = 9.
  const { dbStats } = await import("../spider-leads/src/db.ts");
  const stats = await dbStats(db);
  assert.equal(stats.totals.total, 9);
});

test("hunt with guessEmails: a person without a published email yields a guessed lead", async () => {
  // Isolated mock/db so the deterministic verify-pattern mode doesn't touch the shared fixtures.
  const mock2 = await startMock({ verifyPattern: "first.last", verifyHosts: ["acme.com"] });
  const cfg2 = await testCfg(mock2.url);
  const t2 = tempDbPath();
  cfg2.tursoUrl = "file:" + t2.db;
  const { ensureDb } = await import("../spider-leads/src/pipeline.ts");
  const db2 = await ensureDb(cfg2);
  try {
    const { upsertLead, recordVerification, listLeads } = await import("../spider-leads/src/db.ts");
    // Seed one verified address so the domain's first.last convention is learned before guessing.
    await upsertLead(db2, {
      email: "sarah.chen@acme.com", emailType: "corporate", emailSource: "page",
      personName: "Sarah Chen", title: "VP Engineering", phone: null, linkedin: null,
      company: "acme.com", domain: "acme.com", category: null, subcategory: null, tier: null,
      confidence: null, interests: [], sourceUrl: null, source: "test", raw: null,
    });
    await recordVerification(db2, "sarah.chen@acme.com", {
      valid: true, isDisposable: false, isAlias: false, isTypo: false,
      isPlusAddressed: false, isPersonalEmail: false, domainExists: true,
      hasWebsite: true, hasMxRecords: true, reasons: [], checkedAt: new Date().toISOString(),
    });

    const { hunt, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
    const opts = defaultRunOptions(cfg2);
    opts.limit = 6;
    opts.extract = "local";
    opts.verify = false;
    opts.guessEmails = true;
    opts.perPerson = 3;
    const summary = await hunt(db2, cfg2, ["acme.com"], opts);

    assert.ok(summary.guessedEmailsFound >= 1, "hunt guessed at least one email");
    assert.ok(summary.peopleFound >= 1, "hunt discovered at least one named person");

    const rows = await listLeads(db2, { limit: 50 });
    const dana = rows.find((r) => r.email === "dana.fox@acme.com");
    assert.ok(dana, "dana.fox@acme.com guessed during the hunt");
    assert.equal(dana.email_source, "guessed");
    assert.equal(dana.email_pattern, "first.last");
    assert.equal(dana.status, "verified");
  } finally {
    try { await db2.close(); } catch { /* ignore */ }
    await mock2.close();
    cleanupDb(t2.dir);
  }
});