// AI Studio employee scraper + scraper-directory catalog — client + integration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg, tempDbPath, cleanupDb } from "./helpers/ctx.mjs";

let mock, cfg, tmp, db;

before(async () => {
  mock = await startMock();
  cfg = await testCfg(mock.url);
  tmp = tempDbPath();
  cfg.tursoUrl = "file:" + tmp.db;
  cfg.aiStudio = true;
  const { ensureDb } = await import("../spider-leads/src/pipeline.ts");
  db = await ensureDb(cfg);
});

after(async () => {
  try { await db.close(); } catch { /* ignore */ }
  await mock.close();
  cleanupDb(tmp.dir);
});

test("aiStudioExtract: returns page objects with extracted_data (prompt→JSON)", async () => {
  const { aiStudioExtract } = await import("../spider-leads/src/spider.ts");
  const pages = await aiStudioExtract(cfg, "crawl", "https://acme.com", "Extract every team member", {
    limit: 3,
    metadata: true,
    schema: { name: "employees", schema: { type: "object" } },
  });
  assert.ok(pages.length >= 2, "multiple pages from /ai/crawl");
  const data = pages[0]?.extractedData;
  assert.ok(data && Array.isArray(data.employees), "employees array in extracted_data");
  const dana = data.employees.find((e) => e.name === "Dana Fox");
  assert.ok(dana, "Dana Fox in extraction");
  assert.equal(dana.email, null);
  assert.ok(typeof pages[0].content === "string" && pages[0].content.length > 0);
  assert.ok(Array.isArray(pages[0].links));
});

test("listScraperDirectory: catalog returns configs and honors domain filter", async () => {
  const { listScraperDirectory } = await import("../spider-leads/src/spider.ts");
  const all = await listScraperDirectory({ limit: 50, base: mock.url });
  assert.ok(all.length >= 3);
  assert.ok(all.some((c) => c.domain === "zillow.com"));
  const filtered = await listScraperDirectory({ domain: "github.com", base: mock.url });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].domain, "github.com");
});

test("findEmployees (AI Studio): people stored + leads scored + guesses available", async () => {
  const { findEmployees, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const { listLeads, peopleForDomain } = await import("../spider-leads/src/db.ts");
  const opts = defaultRunOptions(cfg);
  opts.limit = 3;
  opts.verify = false;
  opts.guessEmails = false;
  const summary = await findEmployees(db, cfg, ["acme.com"], opts);

  assert.ok(summary.peopleFound >= 1, "people discovered");
  const rows = await listLeads(db, { limit: 30 });
  assert.ok(rows.length >= 3, "leads stored from employee extraction");
  const sarah = rows.find((r) => r.email === "sarah.chen@acme.com");
  assert.ok(sarah, "sarah stored");
  assert.equal(sarah.department, "engineering");
  assert.ok(sarah.lead_score > 0 && sarah.lead_tier);

  const people = await peopleForDomain(db, "acme.com");
  const dana = people.find((p) => p.name === "Dana Fox");
  assert.ok(dana, "Dana Fox (no email) in people table");
  assert.equal(dana.title, "Product Manager");

  // Second run with guessing enabled finds Dana's email via the pattern.
  const opts2 = defaultRunOptions(cfg);
  opts2.limit = 3;
  opts2.verify = true;
  opts2.guessEmails = true;
  opts2.perPerson = 3;
  const summary2 = await findEmployees(db, cfg, ["acme.com"], opts2);
  assert.ok(summary2.guessedEmailsFound >= 1, "guessed at least one email: " + summary2.guessedEmailsFound);
  const danaLead = (await listLeads(db, { limit: 50 })).find((r) => r.person_name === "Dana Fox");
  assert.ok(danaLead, "Dana Fox has a guessed lead");
  assert.equal(danaLead.email_source, "guessed");
});

test("findEmployees (fallback, no AI Studio): standard extraction still works", async () => {
  const cfg2 = await testCfg(mock.url);
  const t2 = tempDbPath();
  cfg2.tursoUrl = "file:" + t2.db;
  cfg2.aiStudio = false;
  const { ensureDb, findEmployees, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const { listLeads } = await import("../spider-leads/src/db.ts");
  const db2 = await ensureDb(cfg2);
  try {
    const opts = defaultRunOptions(cfg2);
    opts.limit = 3;
    opts.extract = "local";
    opts.verify = false;
    const summary = await findEmployees(db2, cfg2, ["acme.com"], opts);
    assert.ok(summary.peopleFound >= 1);
    const rows = await listLeads(db2, { limit: 10 });
    assert.ok(rows.length >= 3);
  } finally {
    try { await db2.close(); } catch { /* ignore */ }
    cleanupDb(t2.dir);
  }
});
