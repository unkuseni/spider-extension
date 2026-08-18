import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeDom, makeEl } from "./helpers/stubs.mjs";
import { readPage, fillForm, clickEl, copyText } from "../lib/assist-page.js";

const controls = () => [
  makeEl({ name: "email", placeholder: "Email address" }),
  makeEl({ name: "full_name", placeholder: "Full name" }),
  makeEl({ tagName: "TEXTAREA", name: "summary", placeholder: "Tell us about yourself" }),
  makeEl({ name: "visa_status", placeholder: "Visa status" }),
  makeEl({ name: "disabled_field", placeholder: "Disabled thing", disabled: true }),
  makeEl({ name: "unknown_thing", placeholder: "Unrelated field" }),
];

test("fillForm fills matching fields and skips sensitive/disabled", async () => {
  fakeDom({ controls: controls(), url: "https://boards.example.com/jobs/1" });
  const res = JSON.parse(await fillForm({ fullName: "Sarah Chen", email: "s@a.com", summary: "10 years infra" }));
  assert.ok(res.filled.some((f) => f.key === "email"));
  assert.ok(res.filled.some((f) => f.key === "fullName"));
  assert.ok(res.filled.some((f) => f.key === "summary"));
  assert.ok(res.skippedSensitive.some((x) => /visa/i.test(x)));
  assert.ok(res.skippedSensitive.some((x) => /disabled/i.test(x)));
  assert.ok(res.unmatched.some((x) => /unrelated/i.test(x)));
});

test("clickEl refuses submit/send elements", async () => {
  fakeDom();
  globalThis.document.querySelector = () => makeEl({ tagName: "BUTTON", innerText: "Submit application", extra: { click: () => { throw new Error("must not click"); } } });
  const res = JSON.parse(await clickEl("button"));
  assert.ok(res.blocked);
});

test("readPage returns a structured snapshot", async () => {
  fakeDom({ controls: controls(), title: "Acme Jobs", bodyText: "Senior Engineer role." });
  const snap = JSON.parse(await readPage());
  assert.equal(snap.title, "Acme Jobs");
  assert.equal(snap.forms.length, 1);
  assert.ok(snap.text.includes("Senior Engineer"));
});

test("copyText uses the clipboard API", async () => {
  fakeDom();
  let copied = "";
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => { copied = t; } } }, configurable: true });
  const res = JSON.parse(await copyText("draft text"));
  assert.ok(res.ok);
  assert.equal(copied, "draft text");
});