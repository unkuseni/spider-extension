// Integration: hunt stores scored/classified leads + company relationships;
// related-lead queries and score recomputation work end-to-end.
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

test("hunt: leads are classified (department/seniority/decision-maker) and graded", async () => {
  const { hunt, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const opts = defaultRunOptions(cfg);
  opts.limit = 6;
  opts.extract = "local";
  opts.verify = false;
  await hunt(db, cfg, ["acme.com"], opts);

  const { listLeads } = await import("../spider-leads/src/db.ts");
  const rows = await listLeads(db, { limit: 20 });
  assert.ok(rows.length >= 3);

  const sarah = rows.find((r) => r.email === "sarah.chen@acme.com");
  assert.ok(sarah, "sarah stored");
  assert.equal(sarah.department, "engineering");
  assert.equal(sarah.seniority, "exec");
  assert.equal(sarah.decision_maker, 1);
  assert.ok(sarah.lead_score > 0 && sarah.lead_score <= 100, "score in range: " + sarah.lead_score);
  assert.ok(["A", "B", "C", "D"].includes(sarah.lead_tier), "grade set: " + sarah.lead_tier);

  const james = rows.find((r) => r.email === "james.ruiz@acme.com");
  assert.ok(james);
  assert.equal(james.department, "sales");
  assert.equal(james.seniority, "head"); // "Head of Sales"
  assert.equal(james.decision_maker, 1);
});

test("hunt: company relationships are extracted and persisted", async () => {
  const { relationsForDomain, leadsRelatedTo, listLeads } = await import("../spider-leads/src/db.ts");
  const rels = await relationsForDomain(db, "acme.com");
  assert.ok(rels.length >= 2, "at least 2 relations: " + rels.length);
  const client = rels.find((r) => r.type === "Client");
  assert.ok(client, "Client relation present");
  assert.equal(client.target, "Globex Inc");
  assert.equal(client.target_domain, "globex.io");

  // Hunt globex so it has leads; then acme's partner graph finds them.
  const { hunt, defaultRunOptions } = await import("../spider-leads/src/pipeline.ts");
  const opts = defaultRunOptions(cfg);
  opts.limit = 6;
  opts.extract = "local";
  opts.verify = false;
  await hunt(db, cfg, ["globex.io"], opts);

  const related = await leadsRelatedTo(db, "acme.com", { limit: 50 });
  assert.ok(related.length >= 1, "leads at related (client) company found");
  assert.ok(related.every((r) => r.domain === "globex.io"));
});

test("score command path: recompute + ICP changes grades", async () => {
  const { listLeads, updateLeadScore } = await import("../spider-leads/src/db.ts");
  const { classifyTitle, icpMatch, scoreLead } = await import("../spider-leads/src/leadscore.ts");
  const rows = await listLeads(db, { limit: 10 });
  const target = rows.find((r) => r.email === "sarah.chen@acme.com");
  assert.ok(target);

  let interests = [];
  try { interests = JSON.parse(target.interests || "[]").map((i) => i.topic); } catch { /* ignore */ }
  const icp = icpMatch(target.category, interests, ["SaaS / Software"], ["AI"]);
  const cls = classifyTitle(target.title);
  const { score, grade } = scoreLead({
    emailValid: target.email_valid, emailScore: target.email_score, emailSource: target.email_source,
    companyTier: target.tier, companyConfidence: target.confidence, icpMatch: icp, title: target.title,
  });
  await updateLeadScore(db, target.email, {
    department: cls.department, seniority: cls.seniority,
    decisionMaker: cls.decisionMaker, leadScore: score, leadTier: grade, icpMatch: icp,
  });
  const after = (await listLeads(db, { limit: 10 })).find((r) => r.email === target.email);
  assert.equal(after.lead_score, score);
  assert.equal(after.lead_tier, grade);
  assert.equal(after.icp_match, icp ? 1 : null);
});
