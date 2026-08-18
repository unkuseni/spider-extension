/**
 * Cross-browser storage wrapper.
 *
 * Safari does not implement chrome.storage.sync. We use it when available
 * (Chrome/Firefox sync settings across devices) and transparently fall back
 * to storage.local otherwise.
 */

function hasSync() {
  return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.sync;
}

// Keys are stored unprefixed: when storage.sync exists it holds these keys;
// otherwise storage.local does (separate namespaces, no collision with other
// local-only keys like plugins/career profile/allowlist).
function localGet(keys) {
  return chrome.storage.local.get(keys);
}

function localSet(obj) {
  return chrome.storage.local.set(obj);
}

function syncGet(keys) {
  return chrome.storage.sync.get(keys);
}

function syncSet(obj) {
  return chrome.storage.sync.set(obj);
}

/** get(keys) → Promise<object> — keys: string | string[] | null */
export function storageGet(keys) {
  return hasSync() ? syncGet(keys) : localGet(keys);
}

/** set(obj) → Promise<void> */
export function storageSet(obj) {
  return hasSync() ? syncSet(obj) : localSet(obj);
}
