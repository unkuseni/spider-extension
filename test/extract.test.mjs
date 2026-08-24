import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEmailType, isValidEmail, extractEmails, isDisposableDomain,
  extractTwitter, extractFacebook, extractSchedulerLinks, extractSocial,
  isContactUrl,
} from "../spider-leads/src/extract.ts";

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

test("isValidEmail + isDisposableDomain reject throwaway mailboxes before verification", () => {
  assert.ok(isDisposableDomain("mailinator.com"));
  assert.ok(isDisposableDomain("Temp-Mail.org"));
  assert.ok(isDisposableDomain("yopmail.com"));
  assert.ok(!isDisposableDomain("acme.com"));
  assert.ok(!isValidEmail("jane@mailinator.com"), "disposable emails never become leads");
  assert.ok(!isValidEmail("bob@guerrillamail.com"));
  assert.ok(isValidEmail("jane@acme.com"), "normal domains remain valid");
});

test("extractEmails dedupes and filters", () => {
  const found = extractEmails("Contact sarah@acme.com or SARAH@acme.com; junk img@logo.png and x@example.com");
  assert.deepEqual(found, ["sarah@acme.com"]);
});

test("extractTwitter: URLs and bare @handles (skips status slugs)", () => {
  const text = "Follow @acme_careers on https://twitter.com/acme_inc and https://x.com/sarahchen — not /status/123.";
  const found = extractTwitter(text);
  assert.ok(found.includes("https://twitter.com/acme_inc"), "twitter URL captured");
  assert.ok(found.includes("https://x.com/sarahchen"), "x URL captured");
  assert.ok(found.includes("https://twitter.com/acme_careers"), "bare @handle becomes a URL");
  assert.ok(!found.some((u) => u.includes("/status/")), "status slugs are not handles");
});

test("extractFacebook: page URLs captured, app/sharer paths skipped", () => {
  const text = "See https://www.facebook.com/acmehq and https://facebook.com/acmeteam; not https://facebook.com/sharer.php.";
  const found = extractFacebook(text);
  assert.ok(found.includes("https://www.facebook.com/acmehq"));
  assert.ok(found.includes("https://facebook.com/acmeteam"));
  assert.ok(!found.some((u) => u.includes("sharer")), "sharer URLs are not pages");
});

test("extractSchedulerLinks: Calendly/Cal.com and friends, deduped and trimmed", () => {
  const text = "Book a call: https://calendly.com/janesmith/intro?utm=x and https://cal.com/acme-demo, also https://calendly.com/janesmith/intro.";
  const found = extractSchedulerLinks(text);
  assert.ok(found.includes("https://calendly.com/janesmith/intro"), "calendly link captured without query");
  assert.ok(found.includes("https://cal.com/acme-demo"), "cal.com link captured");
  assert.equal(new Set(found).size, found.length, "no duplicates");
});

test("extractSocial: groups all channels", () => {
  const text = "LinkedIn: https://linkedin.com/in/sarah-chen · X: @sarahchen · Call: https://calendly.com/sarahchen/intro";
  const s = extractSocial(text);
  assert.deepEqual(s.linkedin, ["https://linkedin.com/in/sarah-chen"]);
  assert.ok(s.twitter.includes("https://twitter.com/sarahchen"));
  assert.deepEqual(s.scheduler, ["https://calendly.com/sarahchen/intro"]);
});

test("isContactUrl: multilingual + outreach-centric paths", () => {
  assert.ok(isContactUrl("https://acme.com/contact-us"));
  assert.ok(isContactUrl("https://acme.com/get-in-touch"));
  assert.ok(isContactUrl("https://acme.com/equipe"), "French team page");
  assert.ok(isContactUrl("https://acme.com/impressum"), "German legal contact page");
  assert.ok(isContactUrl("https://acme.com/about"));
  assert.ok(isContactUrl("https://acme.com/sales"), "sales page is outreach-relevant");
  assert.ok(isContactUrl("https://acme.com/press"), "press page is outreach-relevant");
  assert.ok(!isContactUrl("https://acme.com/products"));
  assert.ok(!isContactUrl("https://acme.com/pricing"));
});

test("parseContactsLocal: named people carry scheduler + Twitter signals into the roster", async () => {
  const { parseContactsLocal } = await import("../spider-leads/src/ai.ts");
  const contacts = parseContactsLocal([{
    url: "https://acme.com/team",
    markdown: "- Jane Doe — CTO — https://calendly.com/janedoe/intro — @janedoe\n- John Roe — CFO",
    status: 200,
  }]);
  const jane = contacts.find((c) => c.person_name === "Jane Doe");
  assert.ok(jane, "Jane Doe extracted from the team page");
  assert.equal(jane.scheduler, "https://calendly.com/janedoe/intro", "scheduling link captured");
  assert.ok(jane.twitter?.includes("janedoe"), "twitter handle captured");
});