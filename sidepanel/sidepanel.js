/**
 * Spider Extension — Side Panel Script
 *
 * Full-featured panel: scrape, crawl, search, and AI extraction (BYOK).
 * Receives quick actions from the popup and keyboard shortcuts.
 */

import { scrapePage, crawlSite, searchWeb, getApiKey, getPreferences } from '../lib/spider-api.js';
import { getAiConfigs, aiExtractPreset, EXTRACTION_PRESETS } from '../lib/ai-client.js';
import { copyToClipboard, downloadFile, formatBytes, formatDuration, sanitizeFilename } from '../lib/utils.js';
import {
  hunt as pipelineHunt, huntSearch as pipelineSearch, verifyStored as pipelineVerify,
  listLeads, dbStats, runAgent,
} from '../vendor/leads-core.js';
import { buildLeadsConfig, getLeadsDb, getLeadsSettings, missingLeadsConfig } from '../lib/leads.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allResults = [];           // Accumulated results from current session
let currentTabUrl = '';
let currentTabTitle = '';
let crawlAbortController = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentTab();
  await loadPreferences();
  bindEvents();
  listenForMessages();
  refreshLeadsConfigState();
});

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentTabUrl = tab.url || '';
      currentTabTitle = tab.title || '';
      document.getElementById('scrapeUrl').value = currentTabUrl;
      document.getElementById('crawlUrl').value = extractRoot(currentTabUrl);
    }
  } catch { /* ignore */ }
}

function extractRoot(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch { return url; }
}

async function loadPreferences() {
  const prefs = await getPreferences();
  if (prefs.defaultMode) {
    document.getElementById('scrapeMode').value = prefs.defaultMode;
    document.getElementById('crawlMode').value = prefs.defaultMode;
  }
  if (prefs.defaultFormat) {
    document.getElementById('scrapeFormat').value = prefs.defaultFormat;
    document.getElementById('crawlFormat').value = prefs.defaultFormat;
  }
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

  // Scrape
  document.getElementById('scrapeBtn').addEventListener('click', doScrape);

  // Crawl
  document.getElementById('crawlBtn').addEventListener('click', doCrawl);
  document.getElementById('crawlStopBtn').addEventListener('click', stopCrawl);

  // Search
  document.getElementById('searchBtn').addEventListener('click', doSearch);

  // AI
  document.getElementById('aiExtractBtn').addEventListener('click', doAiExtract);
  document.getElementById('aiContentSource').addEventListener('change', onAiSourceChange);
  document.getElementById('aiPreset').addEventListener('change', onAiPresetChange);
  document.getElementById('openOptionsFromAi').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Leads
  document.getElementById('leadsHuntBtn').addEventListener('click', doLeadsHunt);
  document.getElementById('agentBtn').addEventListener('click', doRunAgent);
  document.getElementById('leadsSearchBtn').addEventListener('click', doLeadsSearch);
  document.getElementById('leadsVerifyBtn').addEventListener('click', doLeadsVerify);
  document.getElementById('leadsStatsBtn').addEventListener('click', doLeadsStats);
  document.getElementById('leadsExportBtn').addEventListener('click', doLeadsExport);
  document.getElementById('openOptionsFromLeads').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Header
  document.getElementById('clearBtn').addEventListener('click', clearResults);
  document.getElementById('optionsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Results actions
  document.getElementById('copyAllBtn').addEventListener('click', copyAllResults);
  document.getElementById('downloadBtn').addEventListener('click', downloadAllResults);

  // Enter key in URL fields
  ['scrapeUrl', 'searchQuery'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (id === 'scrapeUrl') doScrape();
        else doSearch();
      }
    });
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
}

function onAiSourceChange() {
  const source = document.getElementById('aiContentSource').value;
  document.getElementById('aiManualGroup').style.display = source === 'manual' ? 'block' : 'none';
}

function onAiPresetChange() {
  const preset = document.getElementById('aiPreset').value;
  document.getElementById('aiCustomGroup').style.display = preset === 'custom' ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// Listen for messages from background / popup
// ---------------------------------------------------------------------------

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
      case 'quickScrape':
        document.getElementById('scrapeUrl').value = message.url;
        switchTab('scrape');
        doScrape();
        break;

      case 'quickCrawl':
        document.getElementById('crawlUrl').value = message.url;
        switchTab('crawl');
        doCrawl();
        break;

      case 'quickSearch':
        document.getElementById('searchQuery').value = message.query || '';
        switchTab('search');
        doSearch();
        break;

      case 'focusLeads':
        switchTab('leads');
        refreshLeadsConfigState();
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------

async function doScrape() {
  const url = document.getElementById('scrapeUrl').value.trim();
  if (!url) return showStatus('Enter a URL', 'error');

  const mode = document.getElementById('scrapeMode').value;
  const format = document.getElementById('scrapeFormat').value;
  const btn = document.getElementById('scrapeBtn');

  btn.disabled = true;
  btn.textContent = '⏳ Scraping…';

  try {
    const result = await scrapePage({ url, mode, format, readability: true, return_page_timing: true });
    const pages = Array.isArray(result) ? result : (result.content ? [result] : []);
    if (pages.length === 0 && result.url) pages.push(result);

    for (const page of pages) {
      addResultCard(page, format);
    }
    showStatus(`Scraped ${pages.length} page(s)`, 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Scrape Page';
  }
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------

async function doCrawl() {
  const url = document.getElementById('crawlUrl').value.trim();
  if (!url) return showStatus('Enter a starting URL', 'error');
  try { new URL(url); } catch { return showStatus('Invalid URL', 'error'); }

  const mode = document.getElementById('crawlMode').value;
  const format = document.getElementById('crawlFormat').value;
  const limit = parseInt(document.getElementById('crawlLimit').value) || 10;
  const depth = parseInt(document.getElementById('crawlDepth').value) || 3;
  const respectRobots = document.getElementById('crawlRobots').checked;

  const crawlBtn = document.getElementById('crawlBtn');
  const stopBtn = document.getElementById('crawlStopBtn');
  const progressBar = document.getElementById('progressBar');
  const progressFill = progressBar.querySelector('.progress-fill');

  crawlBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  progressBar.classList.remove('hidden');

  crawlAbortController = new AbortController();
  let count = 0;

  try {
    const stream = crawlSite({ url, mode, format, limit, depth, respectRobots, readability: true });

    for await (const page of stream) {
      if (crawlAbortController.signal.aborted) break;
      count++;
      addResultCard(page, format);
      progressFill.style.width = `${Math.min((count / limit) * 100, 100)}%`;
      document.getElementById('pageCounter').textContent = `${count}/${limit}`;
      document.getElementById('pageCounter').classList.remove('hidden');
      showStatus(`Crawling… ${count} page(s)`, 'info');
    }

    showStatus(`Crawl complete: ${count} page(s)`, 'success');
  } catch (err) {
    if (!crawlAbortController.signal.aborted) {
      showStatus(err.message, 'error');
    }
  } finally {
    crawlBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    progressBar.classList.add('hidden');
    progressFill.style.width = '0%';
    crawlAbortController = null;
  }
}

function stopCrawl() {
  if (crawlAbortController) {
    crawlAbortController.abort();
    showStatus('Crawl stopped', 'info');
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function doSearch() {
  const query = document.getElementById('searchQuery').value.trim();
  if (!query) return showStatus('Enter a search query', 'error');

  const limit = parseInt(document.getElementById('searchLimit').value) || 10;
  const mode = document.getElementById('searchMode').value;
  const btn = document.getElementById('searchBtn');

  btn.disabled = true;
  btn.textContent = '⏳ Searching…';

  try {
    const result = await searchWeb({ query, limit, mode, format: 'markdown' });
    const pages = result.content || result.results || [];
    if (!Array.isArray(pages)) {
      addResultCard(result, 'markdown');
    } else {
      for (const page of pages) {
        addResultCard(page, 'markdown');
      }
    }
    showStatus(`Search complete`, 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Search';
  }
}

// ---------------------------------------------------------------------------
// AI Extraction (BYOK)
// ---------------------------------------------------------------------------

async function doAiExtract() {
  const provider = document.getElementById('aiProvider').value;
  const preset = document.getElementById('aiPreset').value;
  const source = document.getElementById('aiContentSource').value;
  const btn = document.getElementById('aiExtractBtn');

  // Get content
  let content = '';
  switch (source) {
    case 'last-result':
      if (allResults.length === 0) {
        return showStatus('No results yet. Scrape or crawl a page first.', 'error');
      }
      content = allResults.map(r => r.content || r.html || r.text || '').join('\n\n---\n\n');
      break;
    case 'clipboard':
      try {
        content = await navigator.clipboard.readText();
      } catch {
        return showStatus('Cannot read clipboard. Paste content manually.', 'error');
      }
      if (!content.trim()) return showStatus('Clipboard is empty.', 'error');
      break;
    case 'manual':
      content = document.getElementById('aiManualContent').value.trim();
      if (!content) return showStatus('Paste content in the text area.', 'error');
      break;
  }

  // Truncate very long content
  if (content.length > 50000) {
    content = content.slice(0, 50000) + '\n\n[Content truncated at 50K characters]';
  }

  // Custom prompt
  let customPrompt = null;
  if (preset === 'custom') {
    customPrompt = document.getElementById('aiCustomPrompt').value.trim();
    if (!customPrompt) return showStatus('Enter a custom prompt.', 'error');
  }

  btn.disabled = true;
  btn.textContent = '⏳ Processing with AI…';
  showStatus(`Sending to ${provider} (${EXTRACTION_PRESETS[preset]?.label || preset})…`, 'info');

  try {
    const result = await aiExtractPreset({ provider, preset, content, customPrompt });
    // Add AI result card
    const container = document.getElementById('resultsContainer');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const card = document.createElement('div');
    card.className = 'ai-result-card';
    card.innerHTML = `
      <div class="ai-result-header">
        🤖 ${EXTRACTION_PRESETS[preset]?.label || preset} · via ${provider.toUpperCase()}
      </div>
      <div class="ai-result-content">${escapeHtml(result)}</div>
      <div class="result-actions" style="margin-top:8px">
        <button class="btn btn-sm btn-outline copy-card-btn">📋 Copy</button>
      </div>
    `;
    card.querySelector('.copy-card-btn').addEventListener('click', async () => {
      const ok = await copyToClipboard(result);
      showStatus(ok ? 'Copied!' : 'Copy failed', ok ? 'success' : 'error');
    });
    container.prepend(card);

    // Store for later use
    allResults.push({ content: result, url: `AI: ${preset}`, status: 'ai' });

    showStatus('AI extraction complete ✓', 'success');
  } catch (err) {
    showStatus(`AI error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Run AI Extraction';
  }
}

// ---------------------------------------------------------------------------
// Result cards
// ---------------------------------------------------------------------------

function addResultCard(page, format) {
  const container = document.getElementById('resultsContainer');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const url = page.url || page.get_url?.() || currentTabUrl || '';
  const status = page.status_code || page.status || 200;
  const content = page.content || page.html || page.text || page.markdown || '';
  const costStr = page.costs ? ` · ${formatBytes(page.costs?.total || 0)} credits` : '';
  const timingStr = page.timing ? ` · ${formatDuration(page.timing?.total || page.timing)}` : '';

  const card = document.createElement('div');
  card.className = 'result-card';
  card.innerHTML = `
    <div class="result-url">${escapeHtml(url)}</div>
    <div class="result-meta">
      <span style="color:${status < 400 ? 'var(--success)' : 'var(--danger)'}">● ${status}</span>
      <span>${formatBytes((content || '').length)}</span>
      ${costStr ? `<span>${costStr}</span>` : ''}
      ${timingStr ? `<span>${timingStr}</span>` : ''}
    </div>
    <div class="result-content">${escapeHtml(content.slice(0, 10000))}${content.length > 10000 ? '\n\n… (truncated)' : ''}</div>
    <div class="result-actions">
      <button class="btn btn-sm btn-outline copy-card-btn">📋 Copy</button>
      <button class="btn btn-sm btn-outline save-card-btn">💾 Save</button>
    </div>
  `;

  // Copy button
  card.querySelector('.copy-card-btn').addEventListener('click', async () => {
    const ok = await copyToClipboard(content);
    showStatus(ok ? 'Copied!' : 'Copy failed', ok ? 'success' : 'error');
  });

  // Save button
  card.querySelector('.save-card-btn').addEventListener('click', () => {
    const fname = sanitizeFilename(url.replace(/^https?:\/\//, '').replace(/\/$/, '')) || 'page';
    const ext = format === 'html' || format === 'raw' ? 'html' : format === 'text' ? 'txt' : 'md';
    downloadFile(content, `${fname}.${ext}`, 'text/plain');
  });

  container.appendChild(card);
  container.scrollTop = container.scrollHeight;

  // Store
  allResults.push({ url, content, status });

  // Update counter
  document.getElementById('pageCounter').textContent = allResults.length;
  document.getElementById('pageCounter').classList.remove('hidden');
}


// ---------------------------------------------------------------------------
// Lead Finder
// ---------------------------------------------------------------------------

let leadsConfig = null;

async function refreshLeadsConfigState() {
  leadsConfig = await buildLeadsConfig();
  const missing = missingLeadsConfig(leadsConfig);
  const warn = document.getElementById('leadsConfigWarn');
  const settings = await getLeadsSettings();
  document.getElementById('leadsVerify').checked = settings.verifyOnHunt !== false;
  document.getElementById('leadsExtract').value = settings.extractMode || 'auto';
  document.getElementById('leadsLimit').value = settings.crawlLimit || 10;

  if (missing.length === 0) {
    warn.classList.add('hidden');
  } else {
    warn.innerHTML =
      '⚠️ Missing: <b>' + escapeHtml(missing.join(', ')) + '</b> — ' +
      'open <a href="#" id="leadsWarnOptions">Settings →</a> to configure.';
    warn.classList.remove('hidden');
    warn.querySelector('#leadsWarnOptions').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

function leadsOpts() {
  const verify = document.getElementById('leadsVerify').checked;
  return {
    limit: parseInt(document.getElementById('leadsLimit').value) || 10,
    depth: 2,
    mode: 'smart',
    extract: document.getElementById('leadsExtract').value,
    verify,
    dryRun: false,
    concurrency: 4,
    urlFilter: document.getElementById('leadsFilter').value.trim() || undefined,
  };
}

function renderLeadsSummary(s) {
  const el = document.getElementById('leadsSummary');
  el.classList.remove('hidden');
  const rows = [
    ['Pages crawled', s.pagesCrawled],
    ['Leads found', s.leadsFound + '  (new ' + s.leadsNew + ', updated ' + s.leadsUpdated + ')'],
    ['Verified', s.leadsVerified],
    ['Invalid', s.leadsInvalid],
  ];
  el.innerHTML = '<b>Run: ' + escapeHtml(s.target) + ' (' + s.source + ')</b>\n' +
    rows.map(([k, v]) => escapeHtml(k + ': ' + v)).join('\n');
}

function renderLeads(rows) {
  const empty = document.getElementById('leadsEmpty');
  const wrap = document.getElementById('leadsTableWrap');
  empty.classList.add('hidden');
  if (!rows || rows.length === 0) {
    wrap.innerHTML = '<p class="muted" style="padding:8px 0">No leads found.</p>';
    return;
  }
  const esc = escapeHtml;
  const badge = (st) => '<span class="status-badge ' + esc(st) + '">' + esc(st) + '</span>';
  const typeChip = (t) => t ? '<span class="status-badge ' + esc(t) + '">' + esc(t) + '</span>' : '';
  const head = ['Email', 'Name', 'Title', 'Company', 'Type', 'Category', 'Interests', 'Status', 'Verified'];
  const html = '<table class="leads-table"><thead><tr>' +
    head.map((c) => '<th>' + c + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map((r) => {
      const verified = r.email_valid === 1 ? '✓' : r.email_valid === 0 ? '✗' : '';
      let interests = '';
      try {
        const list = JSON.parse(r.interests || '[]');
        interests = list.slice(0, 2).map((i) => '<span class="category-chip">' + esc(i.topic) + '</span>').join(' ');
      } catch { /* ignore */ }
      return '<tr>' +
        '<td class="email-cell" title="Click to copy">' + esc(r.email || '') + '</td>' +
        '<td>' + esc(r.person_name || '') + '</td>' +
        '<td class="muted">' + esc(r.title || '') + '</td>' +
        '<td>' + esc(r.company || '') + '</td>' +
        '<td>' + typeChip(r.email_type) + '</td>' +
        '<td>' + (r.category ? '<span class="category-chip">' + esc(r.category) + '</span>' : '') + '</td>' +
        '<td class="muted">' + interests + '</td>' +
        '<td>' + badge(r.status || 'new') + '</td>' +
        '<td>' + verified + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('.email-cell').forEach((cell) => {
    cell.addEventListener('click', async () => {
      const ok = await copyToClipboard(cell.textContent.trim());
      showStatus(ok ? 'Email copied!' : 'Copy failed', ok ? 'success' : 'error');
    });
  });
  showStatus(rows.length + ' lead(s) shown', 'success');
}

async function doLeadsHunt() {
  const targets = document.getElementById('leadsTargets').value
    .split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  if (targets.length === 0) return showStatus('Enter at least one target domain', 'error');
  await runLeadsAction(async (db, cfg) => {
    const summary = await pipelineHunt(db, cfg, targets, leadsOpts());
    renderLeadsSummary(summary);
    renderLeads(await listLeads(db, { limit: 50 }));
  }, 'Hunting…');
}

async function doLeadsSearch() {
  const query = document.getElementById('leadsTargets').value.trim();
  if (!query) return showStatus('Enter a search query in the targets field', 'error');
  await runLeadsAction(async (db, cfg) => {
    const summary = await pipelineSearch(db, cfg, query, leadsOpts());
    renderLeadsSummary(summary);
    renderLeads(await listLeads(db, { limit: 50 }));
  }, 'Searching…');
}

async function doRunAgent() {
  const objective = document.getElementById('agentPrompt').value.trim();
  if (!objective) return showStatus('Enter an objective for the agent', 'error');
  await runLeadsAction(async (db, cfg) => {
    const btn = document.getElementById('agentBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Agent working…';
    try {
      const result = await runAgent(db, cfg, objective, { maxTurns: 15, limit: 8 });
      const calls = result.toolCalls.map((t) => t.tool + '×' + t.count).join(', ');
      const el = document.getElementById('leadsSummary');
      el.classList.remove('hidden');
      el.style.whiteSpace = 'pre-wrap';
      el.innerHTML = '<b>🤖 Agent: ' + escapeHtml(objective) + '</b>\n' +
        escapeHtml('turns ' + result.turns + ' | tools: ' + (calls || 'none')) + '\n' +
        escapeHtml('stored ' + result.stored + ' (updated ' + result.updated + ') | verified ' +
          result.verified + ' | invalid ' + result.invalid + ' | errors ' + result.errors.length) + '\n\n' +
        '<b>Summary:</b> ' + escapeHtml(result.final);
      showStatus('Agent run complete', 'success');
      renderLeads(await listLeads(db, { limit: 50 }));
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Run AI Agent';
    }
  }, 'Agent running…');
}

async function doLeadsVerify() {
  await runLeadsAction(async (db, cfg) => {
    const res = await pipelineVerify(db, cfg, { limit: 500, concurrency: 4 });
    renderLeadsSummary({ target: 'verify', source: 'plunk', pagesCrawled: 0, leadsFound: res.checked,
      leadsNew: 0, leadsUpdated: 0, leadsVerified: res.verified, leadsInvalid: res.invalid, errors: [] });
    renderLeads(await listLeads(db, { limit: 50 }));
  }, 'Verifying…');
}

async function doLeadsStats() {
  try {
    const db = await getLeadsDb();
    const cfg = await buildLeadsConfig();
    if (missingLeadsConfig(cfg).length > 0) {
      await refreshLeadsConfigState();
      return showStatus('Configure Turso/Plunk/AI first (see warning above)', 'error');
    }
    const stats = await dbStats(db);
    const statusLine = 'Total ' + stats.totals.total + ' | valid ' + (stats.totals.valid ?? 0) +
      ' | invalid ' + (stats.totals.invalid ?? 0) + ' | unverified ' + (stats.totals.unverified ?? 0);
    const byStatus = (stats.byStatus || []).map((r) => r.status + ':' + r.n).join('  ');
    const byCategory = (stats.byCategory || []).map((r) => r.category + ':' + r.n).join('  ');
    renderLeadsSummary({ target: 'stats', source: 'turso', pagesCrawled: 0, leadsFound: 0,
      leadsNew: 0, leadsUpdated: 0, leadsVerified: 0, leadsInvalid: 0, errors: [] });
    document.getElementById('leadsSummary').innerHTML =
      '<b>' + escapeHtml(statusLine) + '</b>\n' +
      escapeHtml(byStatus) + '\n' + escapeHtml(byCategory);
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function doLeadsExport() {
  try {
    const db = await getLeadsDb();
    const rows = await listLeads(db, { limit: 100000 });
    const cols = ['email', 'person_name', 'title', 'phone', 'company', 'domain', 'email_type', 'category', 'tier', 'interests', 'status', 'source_url', 'created_at'];
    const csv = [cols.join(',')].concat(rows.map((r) => cols.map((k) => {
      const v = String(r[k] ?? '');
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','))).join('\n');
    downloadFile(csv, 'leads-' + Date.now() + '.csv', 'text/csv');
    showStatus('Exported ' + rows.length + ' lead(s)', 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  }
}

async function runLeadsAction(fn, busyText) {
  if (!leadsConfig) await refreshLeadsConfigState();
  const missing = missingLeadsConfig(leadsConfig);
  if (missing.length > 0) {
    return showStatus('Missing: ' + missing.join(', ') + ' — open Settings', 'error');
  }
  const btns = ['leadsHuntBtn', 'leadsSearchBtn', 'leadsVerifyBtn'];
  btns.forEach((id) => { document.getElementById(id).disabled = true; });
  showStatus(busyText + ' (this can take a minute)…', 'info');
  try {
    const db = await getLeadsDb();
    const cfg = await buildLeadsConfig();
    await fn(db, cfg);
  } catch (err) {
    showStatus('Lead Finder error: ' + err.message, 'error');
    console.error(err);
  } finally {
    btns.forEach((id) => { document.getElementById(id).disabled = false; });
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(message, type) {
  const el = document.getElementById('statusText');
  el.textContent = message;
  el.className = `status-text ${type}`;
  el.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

function clearResults() {
  allResults = [];
  const container = document.getElementById('resultsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🕷️</div>
      <p>Scrape a page, start a crawl, or search to see results here.</p>
    </div>
  `;
  document.getElementById('pageCounter').classList.add('hidden');
  showStatus('Cleared', 'info');
}

async function copyAllResults() {
  const text = allResults.map(r => {
    const header = r.url ? `## ${r.url}\n` : '';
    return `${header}${r.content || ''}`;
  }).join('\n\n---\n\n');
  const ok = await copyToClipboard(text);
  showStatus(ok ? 'All copied!' : 'Copy failed', ok ? 'success' : 'error');
}

function downloadAllResults() {
  const text = allResults.map(r => {
    const header = r.url ? `## ${r.url}\n` : '';
    return `${header}${r.content || ''}`;
  }).join('\n\n---\n\n');
  downloadFile(text, `spider-export-${Date.now()}.md`, 'text/markdown');
}