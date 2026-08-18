import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeChrome, fakeDom, makeEl } from "./helpers/stubs.mjs";
import { executeAction, addCurrentSite, isUrlAllowed, getAllowlist } from "../lib/browser-assist.js";

test("tab actions dispatch to chrome.tabs", async () => {
  const ch = fakeChrome();
  const opened = JSON.parse(await executeAction(1, { action: "open_tab", target: "https://example.com/jobs/9" }));
  assert.ok(opened.ok);
  assert.equal(opened.openedTabId, 42);
  const listed = JSON.parse(await executeAction(1, { action: "list_tabs" }));
  assert.ok(listed.ok);
  assert.deepEqual(ch._tabCalls.filter((c) => c[0] === "tabs.create"), [["tabs.create", "https://example.com/jobs/9", false]]);
});

test("navigate validates the URL", async () => {
  fakeChrome();
  const bad = JSON.parse(await executeAction(1, { action: "navigate", target: "javascript:alert(1)" }));
  assert.ok(!bad.ok);
});

test("allowlist: defaults, add site, URL checks", async () => {
  fakeChrome();
  assert.deepEqual(await getAllowlist(), ["linkedin.com", "greenhouse.io", "lever.co", "ashbyhq.com", "indeed.com", "workday.com"]);
  await addCurrentSite({ url: "https://boards.acme.co/jobs/1" });
  assert.ok(await isUrlAllowed("https://boards.acme.co/jobs/2"));
  assert.ok(!(await isUrlAllowed("https://evil.example.net/")));
});

test("executeAction fill_form runs the page helper", async () => {
  fakeChrome();
  fakeDom({ controls: [makeEl({ name: "email", placeholder: "Email address" })] });
  const res = JSON.parse(await executeAction(1, { action: "fill_form", fields: { email: "s@a.com" } }));
  assert.ok(res.ok);
  assert.equal(res.filled.length, 1);
});