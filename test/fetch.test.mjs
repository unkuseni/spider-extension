// Fetch API (curated per-site scraper configs) + premium-proxy passthrough.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMock, testCfg } from "./helpers/ctx.mjs";

let mock, cfg;

before(async () => {
  mock = await startMock();
  cfg = await testCfg(mock.url);
});

after(async () => {
  await mock.close();
});

test("fetchPathFromUrl: domain + path extraction", async () => {
  const { fetchPathFromUrl } = await import("../spider-leads/src/spider.ts");
  const a = fetchPathFromUrl("https://www.zillow.com/homes/");
  assert.deepEqual(a, { domain: "zillow.com", path: "/homes" });
  const b = fetchPathFromUrl("https://zillow.com");
  assert.deepEqual(b, { domain: "zillow.com", path: "/" });
  const c = fetchPathFromUrl("zillow.com/homes/for-sale");
  assert.deepEqual(c, { domain: "zillow.com", path: "/homes/for-sale" });
  assert.throws(() => fetchPathFromUrl("not a url"));
});

test("fetchStructured: structured items, metadata, and links from the mock", async () => {
  const { fetchStructured } = await import("../spider-leads/src/spider.ts");
  const res = await fetchStructured(cfg, "https://zillow.com/homes/");
  assert.equal(res.status, 200);
  assert.ok(res.metadata && res.metadata.title);
  assert.ok(Array.isArray(res.css_extracted) && res.css_extracted.length >= 3,
    "structured items returned");
  assert.equal(res.css_extracted[0].price, "$1,250,000");
  assert.ok(Array.isArray(res.links) && res.links.length >= 3);
});

test("premium proxy + country code are sent on scrape requests", async () => {
  const { scrapePage } = await import("../spider-leads/src/spider.ts");
  cfg.spiderProxy = true;
  cfg.spiderCountry = "de";
  try {
    const page = await scrapePage(cfg, "https://acme.com/", { mode: "smart" });
    assert.match(page.markdown, /proxy echo: premium_proxy=true country_code=de/,
      "premium_proxy and country_code reached the API");
  } finally {
    cfg.spiderProxy = false;
    cfg.spiderCountry = "";
  }
});

test("premium proxy + country code are also passed on /fetch requests", async () => {
  const { fetchStructured } = await import("../spider-leads/src/spider.ts");
  cfg.spiderProxy = true;
  cfg.spiderCountry = "us";
  try {
    const res = await fetchStructured(cfg, "https://zillow.com/homes/");
    assert.match(String(res.content), /proxy echo: premium_proxy=true country_code=us/);
  } finally {
    cfg.spiderProxy = false;
    cfg.spiderCountry = "";
  }
});

test("agent exposes fetch_structured and it returns items", async () => {
  const { buildTools } = await import("../spider-leads/src/tools.ts");
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: "file::memory:" });
  try {
    const tools = buildTools(cfg, db, { limit: 3 });
    assert.ok(tools.fetch_structured, "fetch_structured tool is available");
    const out = JSON.parse(await tools.fetch_structured.run({ url: "https://zillow.com/homes/" }));
    assert.ok(Array.isArray(out.items) && out.items.length >= 3);
  } finally {
    await db.close();
  }
});
