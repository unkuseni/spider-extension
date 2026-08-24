// LinkedIn company-page employee discovery (public pages only) — unit + integration.
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

test("extractLinkedinCompany: firmographics + employee cards from public page markdown", async () => {
  const { extractLinkedinCompany } = await import("../spider-leads/src/people.ts");
  const md = `# SaskTel | LinkedIn

## Telecommunications

Regina, Saskatchewan 35,010 followers

Website
[
http://www.sasktel.com
](https://www.linkedin.com/redir/redirect?url=http%3A%2F%2Fwww.sasktel.com&urlhash=abc)

External link for SaskTel
Industry
Telecommunications
Company size
1,001-5,000 employees
Headquarters
Regina, Saskatchewan
Specialties
Telecommunications, ICT, Wireless, and Internet

##
Employees at SaskTel

* [![View profile]()
###
Ian Flegel
](https://ca.linkedin.com/in/ian-flegel-6488b?trk=org-employees)

##

View 3k employees at SaskTel
`;
  const info = extractLinkedinCompany(md);
  assert.equal(info.name, "SaskTel");
  assert.equal(info.industry, "Telecommunications");
  assert.ok(info.size && info.size.includes("1,001-5,000"), "size: " + info.size);
  assert.equal(info.hq, "Regina, Saskatchewan");
  assert.equal(info.website, "http://www.sasktel.com");
  assert.ok(info.employeeCount === 1001, "employee count parsed (range start): " + info.employeeCount);
  assert.ok(info.specialties.includes("Telecommunications"));
  assert.equal(info.employees.length, 1);
  assert.equal(info.employees[0].name, "Ian Flegel");
  assert.ok(info.employees[0].linkedin.includes("ian-flegel-6488b"));
});

test("extractLinkedinCompany: strips designations from employee cards + no double-URL", async () => {
  const { extractLinkedinCompany } = await import("../spider-leads/src/people.ts");
  const md = `# SaskTel | LinkedIn

## Telecommunications

##
Employees at SaskTel

* [![View profile]()
###
Ian Flegel P.Eng, PMP, FOI
](https://ca.linkedin.com/in/ian-flegel-6488b?trk=org-employees)

* [![View profile]()
###
Dana Fox
](https://ca.linkedin.com/in/dana-fox-456?trk=org-employees)
`;
  const info = extractLinkedinCompany(md);
  assert.equal(info.employees.length, 2);
  const ian = info.employees.find((e) => e.linkedin.includes("ian-flegel"));
  assert.ok(ian, "Ian present");
  assert.equal(ian.name, "Ian Flegel", "designations stripped: " + ian.name);
  assert.ok(!ian.linkedin.includes("https://https://"), "no double URL protocol");
  assert.ok(ian.linkedin.startsWith("https://ca.linkedin.com/in/") || ian.linkedin.startsWith("https://linkedin.com/in/"));
});

test("linkedinCompany: stores employees + learns pattern + guesses emails at the website domain", async () => {
  const { linkedinCompany } = await import("../spider-leads/src/pipeline.ts");
  const { peopleForDomain, relationsForDomain } = await import("../spider-leads/src/db.ts");
  // Seed a known email to teach the domain pattern (first.last) for guessing.
  const { upsertLead, recordVerification } = await import("../spider-leads/src/db.ts");
  await upsertLead(db, {
    email: "sarah.chen@sasktel.com", emailType: "corporate", emailSource: "page",
    personName: "Sarah Chen", title: "VP Engineering", phone: null, linkedin: null,
    company: "SaskTel", domain: "sasktel.com", category: "Software", subcategory: null,
    tier: "Enterprise", confidence: 0.9, interests: [], sourceUrl: null, source: "test", raw: null,
  });
  await recordVerification(db, "sarah.chen@sasktel.com", {
    valid: true, isDisposable: false, isAlias: false, isTypo: false,
    isPlusAddressed: false, isPersonalEmail: false, domainExists: true,
    hasWebsite: true, hasMxRecords: true, reasons: [], checkedAt: new Date().toISOString(),
  });

  const res = await linkedinCompany(db, cfg, "sasktel", { verify: true, perPerson: 4 });
  assert.equal(res.company, "SaskTel");
  assert.equal(res.industry, "Software");
  assert.ok(res.employeeCount === 1001, "employee count parsed (range start): " + res.employeeCount);
  assert.equal(res.website, "http://www.sasktel.com");
  assert.equal(res.domain, "sasktel.com");
  assert.ok(res.employeesFound >= 2, "employee cards exposed: " + res.employeesFound);
  assert.ok(res.peopleStored >= 2, "people stored");

  const people = await peopleForDomain(db, "sasktel.com");
  const dana = people.find((p) => p.name === "Dana Fox");
  assert.ok(dana, "Dana Fox stored from LinkedIn card");
  assert.equal(dana.source, "linkedin");

  // Mock verify marks everything valid, so guesses become leads: dana.fox@ (learned) + others.
  assert.ok(res.emailsFound >= 1, "guessed emails found: " + res.emailsFound);
  const guessed = res.emails.find((e) => e.email === "dana.fox@sasktel.com");
  assert.ok(guessed, "dana.fox@sasktel.com inferred with first.last pattern");
});

test("agent exposes linkedin_employees tool", async () => {
  const { buildTools } = await import("../spider-leads/src/tools.ts");
  const { createClient } = await import("@libsql/client");
  const d = createClient({ url: "file::memory:" });
  try {
    const tools = buildTools(cfg, d, { limit: 3 });
    assert.ok(tools.linkedin_employees, "linkedin_employees tool available");
  } finally {
    await d.close();
  }
});
