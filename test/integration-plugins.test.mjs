import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compileJsonPlugin, validateJsonPlugin } from "../spider-leads/src/json-plugin.ts";

function echoServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, () => resolve({ srv, url: "http://127.0.0.1:" + srv.address().port }));
  });
}

test("plugin http tool: placeholders, POST body, response extraction", async () => {
  const received = [];
  const { srv, url } = await echoServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { items: [1, 2, 3] } }));
    });
  });
  try {
    const plugin = compileJsonPlugin({
      id: "http-test", name: "HTTP Test", version: "1.0.0",
      tools: [{
        name: "lookup",
        description: "lookup",
        parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
        action: { type: "http", method: "POST", url: url + "/items/{q}", body: { query: "{q}" }, extract: "data.items" },
      }],
    });
    const out = JSON.parse(await plugin.tools[0].run({ q: "abc" }));
    assert.deepEqual(out, [1, 2, 3]);
    assert.equal(received[0].method, "POST");
    assert.ok(received[0].url.endsWith("/items/abc"));
    assert.deepEqual(JSON.parse(received[0].body), { query: "abc" });
  } finally {
    srv.close();
  }
});

test("plugin webhook hook: onLead posts the lead", async () => {
  const got = [];
  const { srv, url } = await echoServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { got.push(JSON.parse(body)); res.writeHead(200); res.end("ok"); });
  });
  try {
    const plugin = compileJsonPlugin({
      id: "hook-test", name: "Hook Test", version: "1.0.0",
      hooks: { onLead: { url: url + "/hook", bodyTemplate: '{"email":"{email}","company":"{company}"}' } },
    });
    await plugin.hooks.onLead({ lead: { email: "jane@acme.com", company: "acme.com" }, outcome: "new" });
    assert.equal(got.length, 1);
    assert.deepEqual(got[0], { email: "jane@acme.com", company: "acme.com" });
  } finally {
    srv.close();
  }
});

test("plugin validation: https-only external URLs", () => {
  const bad = validateJsonPlugin(JSON.stringify({ id: "x", name: "X", version: "1", hooks: { onLead: { url: "http://evil.example.net/hook" } } }));
  assert.ok(!bad.ok);
  const local = validateJsonPlugin(JSON.stringify({ id: "x", name: "X", version: "1", hooks: { onLead: { url: "http://localhost:9999/hook" } } }));
  assert.ok(local.ok);
});