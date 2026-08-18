/**
 * Browser assist execution layer — approval-gated actions on the current tab.
 *
 * Safety rails enforced HERE (not just in prompts):
 *  - submit/send-like clicks are refused by clickEl (defense in depth)
 *  - sensitive fields (visa, salary, demographics, SSN…) are never auto-filled
 *  - actions only run on allowlisted sites (optional host permission requested
 *    with the user's explicit click)
 */

import { readPage, fillForm, setText, clickEl, scrollToEl, copyText } from './assist-page.js';

const ALLOWLIST_KEY = 'spider_assist_allowlist';

// Sites enabled by default (job platforms). More can be added per-site.
const DEFAULT_ALLOW = ['linkedin.com', 'greenhouse.io', 'lever.co', 'ashbyhq.com', 'indeed.com', 'workday.com'];

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export async function getAllowlist() {
  const result = await chrome.storage.local.get([ALLOWLIST_KEY]);
  return result[ALLOWLIST_KEY] || DEFAULT_ALLOW.slice();
}

export async function setAllowlist(hosts) {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: [...new Set(hosts)] });
}

export function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function hostAllowed(host, allowlist) {
  return allowlist.some((h) => host === h || host.endsWith('.' + h));
}

export async function isCurrentSiteAllowed(tab) {
  if (!tab?.url) return false;
  return isUrlAllowed(tab.url);
}

/** True when a URL's host is in the allowlist (used for navigation targets too). */
export async function isUrlAllowed(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  return hostAllowed(host, await getAllowlist());
}

/**
 * Add the current site to the allowlist; requests the optional host permission.
 * Must be called from a user gesture (e.g. a button click).
 */
export async function addCurrentSite(tab) {
  if (!tab?.url) return { ok: false, error: 'No tab URL' };
  const host = hostnameOf(tab.url);
  if (!host) return { ok: false, error: 'Cannot determine site' };
  const list = await getAllowlist();
  if (!hostAllowed(host, list)) {
    list.push(host);
    await setAllowlist(list);
  }
  let granted = true;
  try {
    if (chrome.permissions && typeof chrome.permissions.request === 'function') {
      granted = await chrome.permissions.request({ origins: ['https://*.' + host + '/*'] });
    }
  } catch {
    granted = true; // local/unsupported — treat as granted
  }
  return { ok: true, host, granted };
}

// ---------------------------------------------------------------------------
// Execution (page helpers run via chrome.scripting.executeScript)
// ---------------------------------------------------------------------------

async function runInPage(tabId, fn, args) {
  if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
    return JSON.stringify({ ok: false, error: 'page scripting is not supported in this browser' });
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: fn,
    args: args || [],
  });
  const first = results && results[0];
  return first && first.result !== undefined ? first.result : JSON.stringify({ ok: false, error: 'no result from page' });
}

/** Execute one approved action on a tab. Returns a JSON string for the AI. */
export async function executeAction(tabId, action) {
  const a = action || {};
  switch (a.action) {
    case 'navigate': {
      const url = String(a.target || a.url || '');
      if (!/^https?:\/\//i.test(url)) return JSON.stringify({ ok: false, error: 'navigate needs an http(s) URL' });
      await chrome.tabs.update(tabId, { url });
      return JSON.stringify({ ok: true, navigated: url });
    }
    case 'read_page':
      return runInPage(tabId, readPage, []);
    case 'fill_form': {
      const fields = a.fields && typeof a.fields === 'object' ? a.fields : {};
      return runInPage(tabId, fillForm, [fields]);
    }
    case 'set_text':
      return runInPage(tabId, setText, [{ selector: String(a.target || ''), text: String(a.text ?? '') }]);
    case 'click':
      return runInPage(tabId, clickEl, [String(a.target || '')]);
    case 'scroll_to':
      return runInPage(tabId, scrollToEl, [String(a.target || '')]);
    case 'copy_text':
      return runInPage(tabId, copyText, [String(a.text ?? '')]);
    case 'open_tab': {
      const url = String(a.target || a.url || '');
      if (!/^https?:\/\//i.test(url)) return JSON.stringify({ ok: false, error: 'open_tab needs an http(s) URL' });
      const created = await chrome.tabs.create({ url, active: false });
      return JSON.stringify({ ok: true, openedTabId: created.id, url });
    }
    case 'activate_tab': {
      const id = Number(a.tabId);
      if (!id) return JSON.stringify({ ok: false, error: 'activate_tab needs tabId' });
      await chrome.tabs.update(id, { active: true });
      return JSON.stringify({ ok: true, activatedTabId: id });
    }
    case 'close_tab': {
      const id = Number(a.tabId);
      if (!id) return JSON.stringify({ ok: false, error: 'close_tab needs tabId' });
      await chrome.tabs.remove(id);
      return JSON.stringify({ ok: true, closedTabId: id });
    }
    case 'list_tabs': {
      const tabs = await chrome.tabs.query({});
      const summary = (tabs || []).slice(0, 20).map((t) => ({
        id: t.id,
        active: !!t.active,
        title: (t.title || '').slice(0, 80),
        url: (t.url || '').slice(0, 120),
      }));
      return JSON.stringify({ ok: true, count: summary.length, tabs: summary });
    }
    default:
      return JSON.stringify({ ok: false, error: 'unknown action: ' + a.action });
  }
}

/** Snapshot the current tab (title/url/text/forms) for the AI. */
export async function readCurrentPage(tabId) {
  try {
    return await runInPage(tabId, readPage, []);
  } catch (err) {
    return JSON.stringify({ error: 'cannot read page: ' + err.message });
  }
}

export function isAssistableTab(tab) {
  return !!tab && !!tab.url && /^https?:\/\//.test(tab.url);
}