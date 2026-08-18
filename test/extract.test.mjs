import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyEmailType, isValidEmail, extractEmails } from "../spider-leads/src/extract.ts";

test("classifyEmailType: corporate / business / student / personal", () => {
  assert.equal(classifyEmailType("sarah@acme.com"), "corporate");
  assert.equal(classifyEmailType("info@acme.com"), "business");
  assert.equal(classifyEmailType("sales@acme.com"), "business");
  assert.equal(classifyEmailType("m.lee@stanford.edu"), "student");
  assert.equal(classifyEmailType("admissions@ox.ac.uk"), "student");
  assert.equal(classifyEmailType("jane@gmail.com"), "personal");
  assert.equal(classifyEmailType("a@proton.me"), "personal");
  assert.equal(classifyEmailType("nonsense"), "unknown");
});

test("isValidEmail rejects placeholders and image files", () => {
  assert.ok(isValidEmail("jane@acme.com"));
  assert.ok(!isValidEmail("jane@example.com"));
  assert.ok(!isValidEmail("logo@2x.png"));
  assert.ok(!isValidEmail("jane@yourdomain.com"));
});

test("extractEmails dedupes and filters", () => {
  const found = extractEmails("Contact sarah@acme.com or SARAH@acme.com; junk img@logo.png and x@example.com");
  assert.deepEqual(found, ["sarah@acme.com"]);
});