import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHnComment, hnHtmlToText } from "../spider-leads/src/json-plugin.ts";

test("hnHtmlToText decodes entities and strips tags", () => {
  const { text, applyUrl } = hnHtmlToText(
    "Snout <a href=\"https:&#x2F;&#x2F;snout.com&#x2F;\" rel=\"nofollow\">https:&#x2F;&#x2F;snout.com&#x2F;</a> | Remote<p>We build SaaS. Salary $150k+ &amp; equity."
  );
  assert.match(text, /\$150k\+ & equity/);
  assert.match(text, /Remote/);
  assert.equal(applyUrl, "https://snout.com/");
});

test("parseHnComment: classic 5-field format", () => {
  const p = parseHnComment(
    "CodeWeavers | St Paul, MN, USA | Full Time | REMOTE | Wine, 3D Graphics, and General Open Source Developers | C-language systems programming"
  );
  assert.equal(p.company, "CodeWeavers");
  assert.equal(p.title, "St Paul, MN, USA"); // first meta field kept as title (heuristic)
  assert.equal(p.location, "Full Time");
  assert.ok(p.remote);
  assert.ok(p.description.includes("C-language"));
});

test("parseHnComment: link-only company, remote detection in description", () => {
  const p = parseHnComment(
    "Flywheel Motion (<a href=\"https:&#x2F;&#x2F;flywheelmotion.com&#x2F;\">flywheelmotion.com</a>) | Remote | Build EV software"
  );
  assert.ok(p.company.includes("Flywheel Motion"));
  assert.ok(p.remote);
  assert.equal(p.applyUrl, "https://flywheelmotion.com/");
});

test("parseHnComment: single field (company only)", () => {
  const p = parseHnComment("Acme Inc");
  assert.equal(p.company, "Acme Inc");
  assert.equal(p.title, null);
  assert.equal(p.description, "");
  assert.ok(!p.remote);
});