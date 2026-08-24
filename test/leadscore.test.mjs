// Lead scoring + role classification (Hunter.io-style grading) — unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTitle, icpMatch, scoreLead, gradeLabel } from "../spider-leads/src/leadscore.ts";

test("classifyTitle: seniority buckets", () => {
  assert.deepEqual(classifyTitle("CTO"), { department: "other", seniority: "exec", decisionMaker: true });
  assert.deepEqual(classifyTitle("Founder"), { department: "other", seniority: "exec", decisionMaker: true });
  assert.equal(classifyTitle("VP Engineering").seniority, "exec");
  assert.equal(classifyTitle("Head of Sales").seniority, "head");
  assert.equal(classifyTitle("Director of Marketing").seniority, "director");
  assert.equal(classifyTitle("Support Manager").seniority, "manager");
  assert.equal(classifyTitle("Software Engineer").seniority, "ic");
  assert.equal(classifyTitle("Something obscure").seniority, "unknown");
  assert.equal(classifyTitle(null).seniority, "unknown");
});

test("classifyTitle: departments + decision makers", () => {
  assert.equal(classifyTitle("Software Engineer").department, "engineering");
  assert.equal(classifyTitle("Account Executive").department, "sales");
  assert.equal(classifyTitle("Head of Sales").department, "sales");
  assert.equal(classifyTitle("Growth Marketing Manager").department, "marketing");
  assert.equal(classifyTitle("Product Manager").department, "product");
  assert.equal(classifyTitle("CFO").department, "other");
  assert.equal(classifyTitle("VP Engineering").decisionMaker, true);
  assert.equal(classifyTitle("Head of Sales").decisionMaker, true);
  assert.equal(classifyTitle("Director of Marketing").decisionMaker, true);
  assert.equal(classifyTitle("Software Engineer").decisionMaker, false);
  assert.equal(classifyTitle("Salesperson").decisionMaker, false);
});

test("scoreLead: verified executive at an enterprise is a top lead", () => {
  const { score, grade } = scoreLead({
    emailValid: 1, emailSource: "page", title: "CTO",
    companyTier: "Enterprise", companyConfidence: 0.9, icpMatch: true,
  });
  assert.ok(score >= 90, `expected >=90, got ${score}`);
  assert.equal(grade, "A");
});

test("scoreLead: guessed emails score below verified, and grade reflects confidence", () => {
  const verified = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise" });
  const guessedHigh = scoreLead({ emailValid: 1, emailSource: "guessed", emailScore: 0.9, title: "Founder", companyTier: "Enterprise" });
  const guessedLow = scoreLead({ emailValid: 1, emailSource: "guessed", emailScore: 0.1, title: "Founder", companyTier: "Enterprise" });
  assert.ok(guessedHigh.score < verified.score, "verified published > verified guessed");
  assert.ok(guessedLow.score < guessedHigh.score, "higher guess confidence scores higher");
  assert.ok(guessedLow.score < 60, "low-confidence guess is a cold lead");
});

test("scoreLead: invalid emails are dead leads", () => {
  const { score, grade } = scoreLead({ emailValid: 0, emailSource: "page", title: "CEO", companyTier: "Enterprise" });
  assert.equal(score, 0);
  assert.equal(grade, "D");
});

test("scoreLead: disposable mailboxes collapse to D regardless of title/tier", () => {
  const { score, grade } = scoreLead({
    emailValid: 1, emailSource: "page", title: "CEO", companyTier: "Enterprise",
    icpMatch: true, isDisposable: true,
  });
  assert.equal(score, 0, "disposable = dead lead for outreach");
  assert.equal(grade, "D");
});

test("scoreLead: no-MX / non-existent domains are heavily penalized", () => {
  const normal = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise" });
  const noMx = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise", hasMxRecords: false });
  const noDomain = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise", domainExists: false });
  assert.ok(noMx.score < normal.score, "no-MX domain scores below a deliverable one");
  assert.ok(noDomain.score < normal.score, "non-existent domain scores below a deliverable one");
  assert.ok(noMx.score < 60, "undeliverable domain drops the lead to cold");
});

test("scoreLead: personal-mailbox leads lose a little (lower B2B value)", () => {
  const normal = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise" });
  const personal = scoreLead({ emailValid: 1, emailSource: "page", title: "Founder", companyTier: "Enterprise", isPersonalEmail: true });
  assert.ok(personal.score < normal.score, "personal mailboxes score below corporate ones");
});

test("scoreLead: unverified published email sits between guessed and verified", () => {
  const unverified = scoreLead({ emailValid: null, emailSource: "page", title: "Founder" });
  const guessed = scoreLead({ emailValid: 1, emailSource: "guessed", emailScore: 0.3, title: "Founder" });
  assert.ok(unverified.score > guessed.score);
});

test("scoreLead: ICP match nudges the score", () => {
  const withIcp = scoreLead({ emailValid: 1, emailSource: "page", title: "CTO", icpMatch: true });
  const without = scoreLead({ emailValid: 1, emailSource: "page", title: "CTO", icpMatch: false });
  assert.ok(withIcp.score > without.score);
});

test("icpMatch: null when no ICP rules, boolean otherwise", () => {
  assert.equal(icpMatch("SaaS / Software", ["AI / Machine Learning"], [], []), null);
  assert.equal(icpMatch("SaaS / Software", [], ["SaaS / Software"], []), true);
  assert.equal(icpMatch("E-commerce / Retail", [], ["SaaS / Software"], []), false);
  assert.equal(icpMatch("Other", ["AI / Machine Learning"], [], ["AI"]), true);
  assert.equal(icpMatch("Other", ["Cloud / DevOps"], [], ["AI"]), false);
});

test("gradeLabel: buckets", () => {
  assert.equal(gradeLabel("A"), "Hot");
  assert.equal(gradeLabel("B"), "Warm");
  assert.equal(gradeLabel("C"), "Cool");
  assert.equal(gradeLabel("D"), "Cold");
});

test("classifyTitle: sales/dept specificity (Sales Engineer stays engineering, AE stays sales)", () => {
  assert.equal(classifyTitle("Sales Engineer").department, "engineering");
  assert.equal(classifyTitle("Account Executive").department, "sales");
});
