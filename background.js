import { storageGet, storageSet } from './lib/storage.js';

/**
 * Spider Extension — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Handle keyboard shortcut commands
 *  - Open the side panel on request
 *  - Proxy scrape/crawl calls between popup/sidepanel and the Spider Cloud API
 *  - Manage streaming crawl connections
 */

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Open options page on first install so the user sets their API key
    chrome.runtime.openOptionsPage();
  }
});

// ---------------------------------------------------------------------------
// Side panel management
// ---------------------------------------------------------------------------

/**
 * Enable the side panel to open on any tab (we preset the URL via the
 * manifest side_panel.default_path, so this is just allowing the gesture).
 */
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

/**
 * Open the full panel UI for a tab.
 * Chrome: uses the native side panel (chrome.sidePanel).
 * Firefox: no sidePanel API — opens sidepanel.html in a regular tab instead.
 */
async function openPanelUi(tab) {
  if (tab && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }
  // Firefox/Safari fallback: the panel page works standalone in a tab.
  // Reuse an existing panel tab when one is open.
  const url = chrome.runtime.getURL('sidepanel/sidepanel.html');
  try {
    const existing = (await chrome.tabs.query({ url }))[0];
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      return;
    }
  } catch { /* query may fail on some browsers — fall through */ }
  await chrome.tabs.create({ url, active: true });
}

// ---------------------------------------------------------------------------
// Commands (keyboard shortcuts)
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  switch (command) {
    case 'scrape-current-page':
      // Quick-scrape the current tab — send result to the panel
      await openPanelUi(tab);
      chrome.runtime.sendMessage({
        action: 'quickScrape',
        url: tab.url,
        title: tab.title,
      }).catch(() => {});
      break;

    case 'open-side-panel':
      await openPanelUi(tab);
      break;
  }
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use async helper so we can await inside
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message || String(err) });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {

    // ---------------------------------------------------------------
    // Side panel
    // ---------------------------------------------------------------
    case 'openSidePanel': {
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (tab) await openPanelUi(tab);
      return { ok: true };
    }

    case 'openSidePanelLeads': {
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (tab) {
        await openPanelUi(tab);
        await new Promise(r => setTimeout(r, 300));
        chrome.runtime.sendMessage({ action: 'focusLeads' }).catch(() => {});
      }
      return { ok: true };
    }

    // ---------------------------------------------------------------
    // API key
    // ---------------------------------------------------------------
    case 'getApiKey': {
      const result = await storageGet(['spider_api_key']);
      return { apiKey: result.spider_api_key || null };
    }
    case 'setApiKey': {
      await storageSet({ spider_api_key: message.apiKey });
      return { ok: true };
    }

    // ---------------------------------------------------------------
    // Preferences
    // ---------------------------------------------------------------
    case 'getPrefs': {
      const result = await storageGet(['spider_prefs']);
      return { prefs: result.spider_prefs || {} };
    }
    case 'setPrefs': {
      const existing = (await storageGet(['spider_prefs'])).spider_prefs || {};
      await storageSet({ spider_prefs: { ...existing, ...message.prefs } });
      return { ok: true };
    }

    // ---------------------------------------------------------------
    // AI keys (BYOK)
    // ---------------------------------------------------------------
    case 'getAiKeys': {
      const result = await storageGet(['spider_ai_keys']);
      return { aiKeys: result.spider_ai_keys || {} };
    }
    case 'setAiKeys': {
      const existing = (await storageGet(['spider_ai_keys'])).spider_ai_keys || {};
      await storageSet({ spider_ai_keys: { ...existing, ...message.aiKeys } });
      return { ok: true };
    }

    // ---------------------------------------------------------------
    // Quick actions that need the side panel open
    // ---------------------------------------------------------------
    case 'quickScrape':
    case 'quickCrawl':
    case 'quickSearch': {
      // Forward to the panel if it's open, or open it first
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (tab) {
        await openPanelUi(tab);
        // Give the panel a moment to initialize
        await new Promise(r => setTimeout(r, 300));
        chrome.runtime.sendMessage({
          action: message.action,
          url: message.url,
          title: message.title,
          query: message.query,
          mode: message.mode,
          format: message.format,
          limit: message.limit,
          depth: message.depth,
          respectRobots: message.respectRobots,
        }).catch(() => {});
      }
      return { ok: true };
    }

    default:
      return { error: `Unknown action: ${message.action}` };
  }
}