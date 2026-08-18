import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg } from "./helpers/ctx.mjs";

let mock, cfg;
before(async () => { mock = await startMock(); cfg = await testCfg(mock.url); });
after(async () => { await mock.close(); });

test("career: buildProfile → tailor → outreach → fit", async () => {
  const career = await import("../spider-leads/src/career.ts");
  const profile = await career.buildProfile(cfg, "Sarah Chen — VP Engineering at Acme Inc. Skills: TypeScript, Kubernetes.", "");
  assert.equal(profile.fullName, "Sarah Chen");
  assert.ok(profile.skills.includes("TypeScript"));

  const job = { title: "Senior Platform Engineer", company: "Globex", description: "Build AI infrastructure on Kubernetes." };
  const packet = await career.tailorResume(cfg, profile, job);
  assert.ok(packet.resumeMarkdown.startsWith("# Sarah Chen"));
  assert.ok(packet.coverLetter.length > 20);
  assert.ok(packet.talkingPoints.length >= 1);
  assert.ok(packet.keywords.length >= 1);

  const email = await career.draftOutreach(cfg, profile, job, "email");
  assert.match(email.subject, /Sarah Chen/);
  assert.ok(email.body.length > 20);
  const li = await career.draftOutreach(cfg, profile, job, "linkedin");
  assert.equal(li.subject, undefined);
  assert.ok(li.body.length > 20);

  const fit = await career.scoreFit(cfg, profile, job);
  assert.equal(fit.score, 82);
  assert.ok(fit.strengths.length >= 1);
});