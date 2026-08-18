import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeChrome } from "./helpers/stubs.mjs";
import { storageGet, storageSet } from "../lib/storage.js";

test("storage falls back to local when sync is missing (Safari)", async () => {
  fakeChrome();
  await storageSet({ spider_api_key: "sk-test" });
  const got = await storageGet(["spider_api_key"]);
  assert.equal(got.spider_api_key, "sk-test");
});

test("storage prefers sync when available (Chrome/Firefox)", async () => {
  fakeChrome();
  chrome.storage.sync = {
    _d: {},
    async get(k) { const out = {}; for (const x of Array.isArray(k) ? k : [k]) if (this._d[x] !== undefined) out[x] = this._d[x]; return out; },
    async set(o) { Object.assign(this._d, o); },
  };
  await storageSet({ spider_api_key: "sk-sync" });
  assert.equal((await storageGet(["spider_api_key"])).spider_api_key, "sk-sync");
});