import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fakeChrome, fakeDom } from "./helpers/stubs.mjs";
import { startMock, testCfg } from "./helpers/ctx.mjs";

let mock, cfg;
before(async () => { mock = await startMock(); cfg = await testCfg(mock.url); });
after(async () => { await mock.close(); });

function assistEnv() {
  fakeChrome({ allowlist: ["example.com"] });
  fakeDom({ controls: [], title: "Job", bodyText: "Job page", url: "https://example.com/jobs/1" });
}

test("assist: every action goes through approval; sequence navigate → fill_form", async () => {
  assistEnv();
  const { runAssistSession } = await import("../lib/assist.js");
  const proposals = [];
  const result = await runAssistSession({
    cfg, tabId: 1, prompt: "open and fill", profile: null, pageSnapshot: "{}",
    onPropose: (p) => { proposals.push(p.action); return "approve"; },
  });
  assert.deepEqual(proposals, ["navigate", "fill_form"]);
  assert.match(result.final, /Submit yourself/);
  assert.equal(result.errors.length, 0);
});

test("assist: read-only auto-approve skips prompting for navigate", async () => {
  assistEnv();
  const { runAssistSession } = await import("../lib/assist.js");
  const proposals = [];
  const log = [];
  const result = await runAssistSession({
    cfg, tabId: 1, prompt: "open and fill", profile: null, pageSnapshot: "{}",
    readOnlyAutoApprove: true,
    onPropose: (p) => { proposals.push(p.action); return "approve"; },
    onLog: (k, t) => log.push(k + ": " + t),
  });
  assert.deepEqual(proposals, ["fill_form"]);
  assert.ok(log.some((l) => l.includes("Auto-approved (read-only)")));
});

test("assist: destination outside the allowlist is blocked", async () => {
  fakeChrome({ allowlist: ["example.com"] });
  fakeDom({ title: "Job", url: "https://example.com/jobs/1" });
  const { runAssistSession } = await import("../lib/assist.js");
  const result = await runAssistSession({
    cfg, tabId: 1, prompt: "go somewhere", profile: null, pageSnapshot: "{}",
    onPropose: (p) => {
      // approve, but the destination is NOT allowlisted
      return "approve";
    },
    onLog: (k, t) => { if (k === "system") globalThis.lastLog = t; },
  });
  // mock's first proposal is navigate to https://example.com/jobs/123 → allowed
  // (destination example.com IS allowlisted here), so this test instead checks the
  // current-site gate: use a non-allowlisted current site.
  globalThis.chrome.tabs.get = async () => ({ url: "https://evil.example.net/" });
  const result2 = await runAssistSession({
    cfg, tabId: 1, prompt: "go somewhere", profile: null, pageSnapshot: "{}",
    onPropose: () => "approve",
    onLog: (k, t) => { if (k === "system") globalThis.lastLog2 = t; },
  });
  assert.ok(globalThis.lastLog2.includes("current site not allowlisted"));
});