// Full Spider Cloud API coverage — screenshot, transform, unblocker, unlimited, common params.
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

test("screenshotPage: returns base64-encoded image", async () => {
  const { screenshotPage } = await import("../spider-leads/src/spider.ts");
  const res = await screenshotPage(cfg, "https://example.com/", { format: "png", fullPage: true });
  assert.equal(res.status, 200);
  assert.equal(res.format, "png");
  assert.ok(res.image.length > 50, "base64 image data present");
});

test("transformHtml: HTML → markdown", async () => {
  const { transformHtml } = await import("../spider-leads/src/spider.ts");
  const result = await transformHtml(cfg, "<h1>Hello</h1><p>World</p>", { returnFormat: "markdown" });
  assert.ok(result.includes("Hello"), "content preserved");
});

test("unblockPage: fetches a bot-protected page", async () => {
  const { unblockPage } = await import("../spider-leads/src/spider.ts");
  const page = await unblockPage(cfg, "https://example.com/team", { format: "markdown" });
  assert.ok(page.markdown.length > 0, "content returned");
  assert.equal(page.status, 200);
});

test("crawlUnlimited: same response shape as /crawl", async () => {
  const { crawlUnlimited } = await import("../spider-leads/src/spider.ts");
  const pages = await crawlUnlimited(cfg, "https://acme.com", { limit: 2 });
  assert.ok(pages.length >= 1, "pages returned");
  assert.ok(pages[0].url.includes("acme.com"));
});

test("linksUnlimited: returns link list", async () => {
  const { linksUnlimited } = await import("../spider-leads/src/spider.ts");
  const links = await linksUnlimited(cfg, "https://acme.com", { limit: 5 });
  assert.ok(links.length >= 3);
  assert.ok(links.every((l) => l.startsWith("http")));
});

test("scrapeUnlimited: returns a page", async () => {
  const { scrapeUnlimited } = await import("../spider-leads/src/spider.ts");
  const page = await scrapeUnlimited(cfg, "https://acme.com/");
  assert.ok(page.markdown.length > 0);
});

test("SpiderRequestOptions: common params are threaded into the request body", async () => {
  const { scrapePage } = await import("../spider-leads/src/spider.ts");
  // The mock /scrape echoes premium_proxy + country_code when set; with a
  // per-request override they should appear in the content.
  const page = await scrapePage(cfg, "https://acme.com/", {
    params: { premiumProxy: true, countryCode: "jp", blockAds: true, waitForSelector: "#main" },
  });
  assert.match(page.markdown, /premium_proxy=true/);
  assert.match(page.markdown, /country_code=jp/);
});

test("aiStudioExtract: all 6 routes accept the call (browser + unblocker)", async () => {
  const { aiStudioExtract } = await import("../spider-leads/src/spider.ts");
  for (const route of ["scrape", "crawl", "search", "browser", "links", "unblocker"]) {
    const pages = await aiStudioExtract(cfg, route, "https://acme.com", "test prompt", { limit: 1 });
    assert.ok(Array.isArray(pages), `${route} returned an array`);
  }
});

test("agent tools: take_screenshot, transform_html, unblock_page are exposed", async () => {
  const { buildTools } = await import("../spider-leads/src/tools.ts");
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: "file::memory:" });
  try {
    const tools = buildTools(cfg, db, { limit: 3 });
    assert.ok(tools.take_screenshot, "take_screenshot tool");
    assert.ok(tools.transform_html, "transform_html tool");
    assert.ok(tools.unblock_page, "unblock_page tool");
    const ss = JSON.parse(await tools.take_screenshot.run({ url: "https://example.com" }));
    assert.ok(ss.image_bytes > 0);
  } finally {
    await db.close();
  }
});
