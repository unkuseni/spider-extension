// Shared stubs for extension-module tests (chrome.*, fake DOM).
import { EventEmitter } from "node:events";

/** A minimal fake DOM element. */
export function makeEl(over = {}) {
  const events = [];
  return {
    tagName: over.tagName || "INPUT",
    name: over.name || "",
    id: over.id || "",
    type: over.type || "text",
    placeholder: over.placeholder || "",
    required: !!over.required,
    disabled: !!over.disabled,
    readOnly: !!over.readOnly,
    value: over.value || "",
    innerText: over.innerText || "",
    textContent: over.textContent || "",
    className: over.className || "",
    isContentEditable: !!over.isContentEditable,
    action: over.action || "",
    getAttribute: (a) => (over.attrs || {})[a] || null,
    closest: () => (over.labelText ? { innerText: over.labelText, textContent: over.labelText } : null),
    dispatchEvent: (e) => { events.push({ on: (over.name || over.id || "?"), type: e.type }); },
    click: () => { events.push({ on: "CLICK:" + (over.innerText || over.value || "?"), type: "click" }); },
    focus: () => {},
    scrollIntoView: () => {},
    querySelectorAll: () => (over.formFields || []),
    events,
  };
}

/** Install a fake DOM with the given controls + document bits. */
export function fakeDom({ controls = [], title = "Test", bodyText = "", url = "https://example.com/" } = {}) {
  const formEl = makeEl({ tagName: "FORM", formFields: controls });
  globalThis.document = {
    title,
    querySelectorAll: (sel) => (sel === "form" ? [formEl] : sel.includes("input") ? controls : []),
    querySelector: () => null,
    body: { innerText: bodyText, appendChild: () => {}, removeChild: () => {} },
    createElement: () => ({}),
  };
  globalThis.location = { href: url };
  globalThis.Event = class { constructor(type, opts = {}) { this.type = type; this.bubbles = opts.bubbles; } };
}

/** Install a chrome stub with storage + tabs + scripting + permissions. */
export function fakeChrome({ allowlist = undefined, localData = {}, tabs = [] } = {}) {
  const local = { ...localData };
  if (allowlist) local.spider_assist_allowlist = allowlist;
  const tabCalls = [];
  globalThis.chrome = {
    storage: {
      local: {
        _d: { ...local },
        async get(k) { const out = {}; for (const x of Array.isArray(k) ? k : [k]) if (this._d[x] !== undefined) out[x] = this._d[x]; return out; },
        async set(o) { Object.assign(this._d, o); },
      },
      sync: null,
    },
    permissions: { request: async (o) => { tabCalls.push(["permissions.request", o]); return true; } },
    tabs: {
      async create(p) { tabCalls.push(["tabs.create", p.url, p.active]); return { id: 42 }; },
      async update(id, p) { tabCalls.push(["tabs.update", id, p.active !== undefined ? p.active : p.url]); },
      async remove(id) { tabCalls.push(["tabs.remove", id]); },
      async query() { return tabs; },
      async get() { return { url: "https://example.com/jobs/1" }; },
    },
    scripting: {
      async executeScript({ func, args }) { tabCalls.push(["executeScript", func.name]); const result = await func(...(args || [])); return [{ result }]; },
    },
    runtime: { getURL: (p) => "chrome-extension://test/" + p },
    _tabCalls: tabCalls,
  };
  return globalThis.chrome;
}