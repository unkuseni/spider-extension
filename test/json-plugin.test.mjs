import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJsonPlugin, pluginDataUrls, compileJsonPlugin } from "../spider-leads/src/json-plugin.ts";

test("validate: http:// webhooks rejected, https:// accepted", () => {
  const bad = validateJsonPlugin(JSON.stringify({ id: "x", name: "X", version: "1", hooks: { onLead: { url: "http://evil.example.net/hook" } } }));
  assert.ok(!bad.ok);
  assert.match(bad.error, /non-HTTPS/);
  const good = validateJsonPlugin(JSON.stringify({ id: "x", name: "X", version: "1", hooks: { onLead: { url: "https://app.example.com/hook" } } }));
  assert.ok(good.ok);
});

test("validate: localhost webhooks allowed (dev)", () => {
  const ok = validateJsonPlugin(JSON.stringify({ id: "x", name: "X", version: "1", hooks: { onLead: { url: "http://127.0.0.1:9999/hook" } } }));
  assert.ok(ok.ok);
});

test("pluginDataUrls lists webhooks and http tools", () => {
  const manifest = {
    id: "x", name: "X", version: "1",
    hooks: { onLead: { url: "https://a.example.com/h" } },
    tools: [{ name: "t", description: "d", parameters: {}, action: { type: "http", url: "https://b.example.com/{q}" } }],
  };
  assert.deepEqual(pluginDataUrls(manifest), ["https://a.example.com/h", "https://b.example.com/{q}"]);
});

test("compileJsonPlugin produces working tools/exporters", async () => {
  const plugin = compileJsonPlugin({
    id: "jobs", name: "Jobs", version: "1",
    tools: [{ name: "fetch_jobs", description: "jobs", parameters: { type: "object" }, action: { type: "builtin", id: "fetch_jobs", params: { platform: "greenhouse" } } }],
    exporters: [{ id: "jsonl", label: "JSONL", format: "jsonl" }],
  });
  assert.equal(plugin.tools[0].name, "fetch_jobs");
  const out = await plugin.exporters[0].export([{ a: 1 }]);
  assert.ok(out.content.includes('{"a":1}'));
});