/**
 * Spider Extension — Popup Script
 *
 * Quick actions: scrape current page, start a crawl, or search.
 * For full results, the side panel is opened automatically.
 */

import { getApiKey, getPreferences } from '../lib/spider-api.js';
import { getActiveTab } from '../lib/utils.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentUrl = '';
let currentTitle = '';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentTab();
  await checkApiKey();
  await loadPreferences();
  bindEvents();
});

// ---------------------------------------------------------------------------
// Tab info
// ---------------------------------------------------------------------------

async function loadCurrentTab() {
  try {
    const tab = await getActiveTab();
    currentUrl = tab.url || '';
    currentTitle = tab.title || '';
    const urlEl = document.getElementById('currentUrl');
    urlEl.textContent = currentUrl || 'No page loaded';
    urlEl.title = currentUrl;

    // Pre-fill crawl URL
    const crawlUrlInput = document.getElementById('crawlUrl');
    if (!crawlUrlInput.value && currentUrl) {
      // Extract root domain for crawl
      try {
        const u = new URL(currentUrl);
        crawlUrlInput.value = `${u.protocol}//${u.hostname}`;
      } catch {
        crawlUrlInput.value = currentUrl;
      }
    }
  } catch (err) {
    console.error('Failed to load tab:', err);
  }
}

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

async function checkApiKey() {
  const apiKey = await getApiKey();
  const warning = document.getElementById('apiKeyWarning');
  if (!apiKey) {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

async function loadPreferences() {
  const prefs = await getPreferences();
  if (prefs.defaultMode) document.getElementById('scrapeMode').value = prefs.defaultMode;
  if (prefs.defaultFormat) document.getElementById('scrapeFormat').value = prefs.defaultFormat;
  if (prefs.defaultMode) document.getElementById('crawlMode').value = prefs.defaultMode;
  if (prefs.defaultFormat) document.getElementById('crawlFormat').value = prefs.defaultFormat;
  if (prefs.defaultLimit) document.getElementById('crawlLimit').value = prefs.defaultLimit;
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Scrape button
  document.getElementById('scrapeBtn').addEventListener('click', doScrape);

  // Crawl button
  document.getElementById('crawlBtn').addEventListener('click', doCrawl);

  // Search button
  document.getElementById('searchBtn').addEventListener('click', doSearch);

  // Find Leads → side panel leads tab
  document.getElementById('findLeadsBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openSidePanelLeads' }, (response) => {
      if (response?.error) showStatus(response.error, 'error');
      else {
        showStatus('Lead Finder opened in side panel ✓', 'success');
        window.close();
      }
    });
  });

  // Footer links
  document.getElementById('openSidePanel').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openSidePanel' });
  });

  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('goToOptions')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function doScrape() {
  if (!currentUrl) {
    showStatus('No page to scrape', 'error');
    return;
  }

  const mode = document.getElementById('scrapeMode').value;
  const format = document.getElementById('scrapeFormat').value;
  const btn = document.getElementById('scrapeBtn');

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Scraping…';
  showStatus('Scraping…', 'info');

  // Open side panel and send the scrape request
  chrome.runtime.sendMessage(
    { action: 'quickScrape', url: currentUrl, title: currentTitle, mode, format },
    (response) => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">⚡</span> Scrape Page';
      if (response?.error) {
        showStatus(response.error, 'error');
      } else {
        showStatus('Opened in side panel ✓', 'success');
      }
    }
  );
}

async function doCrawl() {
  const urlEl = document.getElementById('crawlUrl');
  const url = urlEl.value.trim();
  if (!url) {
    showStatus('Enter a starting URL', 'error');
    urlEl.focus();
    return;
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    showStatus('Invalid URL', 'error');
    return;
  }

  const mode = document.getElementById('crawlMode').value;
  const format = document.getElementById('crawlFormat').value;
  const limit = parseInt(document.getElementById('crawlLimit').value) || 10;
  const depth = parseInt(document.getElementById('crawlDepth').value) || 3;
  const respectRobots = document.getElementById('crawlRobots').checked;
  const btn = document.getElementById('crawlBtn');

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Crawling…';
  showStatus('Starting crawl…', 'info');

  chrome.runtime.sendMessage(
    { action: 'quickCrawl', url, title: url, mode, format, limit, depth, respectRobots },
    (response) => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">🕷️</span> Start Crawl';
      if (response?.error) {
        showStatus(response.error, 'error');
      } else {
        showStatus('Crawl started in side panel ✓', 'success');
      }
    }
  );
}

async function doSearch() {
  const query = document.getElementById('searchQuery').value.trim();
  if (!query) {
    showStatus('Enter a search query', 'error');
    return;
  }

  const limit = parseInt(document.getElementById('searchLimit').value) || 10;
  const btn = document.getElementById('searchBtn');

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Searching…';
  showStatus('Searching…', 'info');

  chrome.runtime.sendMessage(
    { action: 'quickSearch', query, limit },
    (response) => {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">🔍</span> Search';
      if (response?.error) {
        showStatus(response.error, 'error');
      } else {
        showStatus('Search results in side panel ✓', 'success');
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function showStatus(message, type) {
  const bar = document.getElementById('statusBar');
  bar.textContent = message;
  bar.className = `status-bar ${type}`;
  bar.classList.remove('hidden');

  if (type === 'success') {
    setTimeout(() => bar.classList.add('hidden'), 3000);
  }
}