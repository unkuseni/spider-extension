// Catch-all domain detection: the #1 false-positive killer for guessed emails.
// A domain that accepts ANY address makes every pattern-inferred address
// "verify" — so we probe it once (bogus local part) and refuse to trust
// guesses there, persisting candidates as pending instead of garbage leads.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg, tempDbPath, cleanupDb } from "./helpers/ctx.mjs";

let mock, cfg, tmp, db;

before(async () => {
  // catchall.test accepts EVERYTHING (probe + any guess); acme.com is a normal
  // domain that rejects the bogus probe local part.
  mock = await startMock({ catchAllHosts: ["catchall.test"] });
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

test("probeCatchAll: true for a catch-all domain, false for a normal one", async () => {
  const { probeCatchAll } = await import("../spider-leads/src/plunk.ts");
  const isCatchAll = await probeCatchAll(cfg, "catchall.test");
  assert.equal(isCatchAll, true, "catch-all domain accepts the bogus probe address");

  const normal = await probeCatchAll(cfg, "acme.com");
  assert.equal(normal, false, "normal domain rejects the bogus probe address");
});

test("enrichDomain: catch-all domain skips verification and stores no guessed leads", async () => {
  const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
  const res = await enrichDomain(db, cfg, "catchall.test", {
    people: [{ name: "Jane Doe", title: "CTO", source: "page" }],
    verify: true,
    perPerson: 3,
    meta: { company: "catchall.test" },
  });

  assert.equal(res.catchAll, true, "result reports the catch-all domain");
  assert.ok(res.candidatesGenerated >= 1, "candidates were generated before the guard");
  assert.equal(res.emailsFound, 0, "no guessed emails stored — they cannot be trusted");
  assert.equal(res.candidatesVerified, 0, "no candidates were verified (0 Plunk calls wasted)");

  const { listLeads, candidatesForDomain, getDomainMeta } = await import("../spider-leads/src/db.ts");
  const leads = await listLeads(db, { limit: 50 });
  assert.equal(leads.filter((r) => r.domain === "catchall.test").length, 0, "no leads stored at the catch-all domain");

  const cands = await candidatesForDomain(db, "catchall.test", { status: "all" });
  assert.ok(cands.length >= 1, "candidates persist for later use");
  assert.ok(cands.every((c) => c.status === "pending"), "candidates stay pending (not falsely 'valid')");
  assert.ok(
    cands.some((c) => /catch-all/.test(c.detail ?? "")),
    "candidates carry a catch-all explanation"
  );

  const meta = await getDomainMeta(db, "catchall.test");
  assert.equal(meta?.is_catchall, 1, "catch-all state persisted in domain_meta");
});

test("enrichDomain: normal domain still verifies and stores guesses (control)", async () => {
  const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
  const res = await enrichDomain(db, cfg, "acme.com", {
    people: [{ name: "Dana Fox", title: "Product Manager", source: "page" }],
    verify: true,
    perPerson: 3,
    meta: { company: "acme.com" },
  });
  assert.equal(res.catchAll, false, "normal domain is not catch-all");
  assert.ok(res.candidatesVerified >= 1, "candidates verified on a normal domain");
});

test("enrichDomain: second run reads the cached catch-all flag (no re-probe)", async () => {
  const refetch = await import("../spider-leads/src/plunk.ts");
  const res = await refetch.probeCatchAll(cfg, "catchall.test");
  const { enrichDomain } = await import("../spider-leads/src/enrich.ts");
  const second = await enrichDomain(db, cfg, "catchall.test", {
    people: [{ name: "Sam Patel", title: "VP Sales", source: "page" }],
    verify: true,
    perPerson: 2,
    meta: { company: "catchall.test" },
  });
  assert.equal(second.catchAll, true, "cached catch-all state is reused");
  assert.equal(second.candidatesVerified, 0, "still no wasted verification");
  assert.equal(res, true, "probe remains deterministic");
});
