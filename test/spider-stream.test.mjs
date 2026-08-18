import { test } from "node:test";
import assert from "node:assert/strict";

// Drive crawlSite's streaming path with a fake Response whose body yields
// deliberately nasty chunks: content containing "},{" inside strings, escaped
// quotes/backslashes, a leading "[" and a trailing "]", plus chunk boundaries
// mid-object, mid-string, and mid-escape.

function fakeResponse(chunks) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, body: stream };
}

test("streaming parser preserves tricky content and splits correctly", async () => {
  const BS = String.fromCharCode(92); // backslash
  const a = { url: "https://x/a", content: "text },{ more", status: 200 };
  const b = { url: "https://x/b", content: "say " + BS + '"' + "hi" + BS + '"' + " and " + BS + " path", status: 200 };
  const c = { url: "https://x/c", content: "[1]: note ends]", status: 200 };
  const json = JSON.stringify([a, b, c]);

  // awkward chunk boundaries: mid-object, mid-string, inside "},{", near the end
  const cuts = [15, 40, json.indexOf("text },{") + 3, json.length - 6].sort((x, y) => x - y);
  const chunks = [];
  let prev = 0;
  for (const cut of cuts) { if (cut > prev) { chunks.push(json.slice(prev, cut)); prev = cut; } }
  chunks.push(json.slice(prev));

  globalThis.fetch = async () => fakeResponse(chunks);
  globalThis.chrome = { storage: { sync: { get: async () => ({ spider_api_key: "test" }) } } };

  const mod = await import("../lib/spider-api.js");
  const pages = [];
  for await (const page of mod.crawlSite({ url: "https://x", limit: 3 })) pages.push(page);

  assert.equal(pages.length, 3);
  assert.equal(pages[0].content, "text },{ more");
  assert.equal(pages[1].content, b.content);
  assert.equal(pages[2].content, "[1]: note ends]");
});