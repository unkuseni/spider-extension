import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg, tempDbPath, cleanupDb } from "./helpers/ctx.mjs";

let mock, cfg, tmp, db;
before(async () => {
  mock = await startMock();
  cfg = await testCfg(mock.url);
  tmp = tempDbPath();
  cfg.tursoUrl = "file:" + tmp.db;
  const { ensureDb } = await import("../spider-leads/src/pipeline.ts");
  db = await ensureDb(cfg);
});
after(async () => { try { await db.close(); } catch {} await mock.close(); cleanupDb(tmp.dir); });

test("verifyStored marks emails verified via Plunk mock", async () => {
  const { upsertLead } = await import("../spider-leads/src/db.ts");
  await upsertLead(db, {
    email: "jane@acme.com", emailType: "corporate", personName: "Jane", title: null, phone: null, linkedin: null,
    company: "acme.com", domain: "acme.com", category: null, subcategory: null, tier: null, confidence: null,
    interests: [], sourceUrl: null, source: "test", raw: null,
  });
  const { verifyStored } = await import("../spider-leads/src/pipeline.ts");
  const res = await verifyStored(db, cfg, { limit: 10, concurrency: 2 });
  assert.equal(res.checked, 1);
  assert.equal(res.verified, 1);
  const rows = await (await import("../spider-leads/src/db.ts")).listLeads(db, { limit: 5 });
  assert.equal(rows[0].status, "verified");
  assert.equal(rows[0].email_valid, 1);
});