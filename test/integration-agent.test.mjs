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

after(async () => {
  try { await db.close(); } catch { /* ignore */ }
  await mock.close();
  cleanupDb(tmp.dir);
});

test("agent: tool-calling loop completes with correct turn count and stores leads", async () => {
  const { runAgent } = await import("../spider-leads/src/agent.ts");
  const result = await runAgent(db, cfg, "find companies and verify their emails", { maxTurns: 10, limit: 3 });
  // mock script: search_web → extract_contacts → store_leads → verify_email → final = 5 rounds
  assert.equal(result.turns, 5, "turn count must match actual chat rounds");
  assert.equal(result.errors.length, 0);
  assert.equal(result.stored, 2);
  assert.equal(result.verified, 1);
  assert.ok(result.final.length > 20);
  const names = result.toolCalls.map((t) => t.tool);
  assert.ok(names.includes("search_web") && names.includes("verify_email"));
});

test("agent: turn budget is enforced", async () => {
  const { runAgent } = await import("../spider-leads/src/agent.ts");
  const result = await runAgent(db, cfg, "keep going", { maxTurns: 2, limit: 3 });
  assert.ok(result.turns <= 2);
  assert.match(result.final, /budget/);
});

test("agent: buildTools exposes employee-discovery and email-inference tools", async () => {
  const { buildTools } = await import("../spider-leads/src/tools.ts");
  const tools = buildTools(cfg, db, { limit: 3 });
  assert.ok(tools.find_employees, "find_employees tool is available");
  assert.ok(tools.guess_emails, "guess_emails tool is available");
  // Core tools referenced by the mock's tool-calling script are still present.
  assert.ok(tools.search_web && tools.extract_contacts && tools.store_leads && tools.verify_email);
});