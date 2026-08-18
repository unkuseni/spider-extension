// Assist UI module (extracted from sidepanel.js)
import { runAssistSession } from '../assist.js';
import { addCurrentSite, getAllowlist, hostnameOf, isAssistableTab, readCurrentPage } from '../browser-assist.js';
import { buildLeadsConfig } from '../leads.js';

export function initAssistUi(ui) {
  const { showStatus, escapeHtml } = ui;
  // ---------------------------------------------------------------------------
  // Assist — approval-gated AI browser actions
  // ---------------------------------------------------------------------------

  let assistSession = null;
  let assistDecisionResolve = null;
  let assistStopped = false;

  async function loadAssistReadOnlyPref() {
    try {
      const result = await chrome.storage.local.get(['spider_assist_readonly_auto']);
      document.getElementById('assistReadOnly').checked = result.spider_assist_readonly_auto === true;
    } catch { /* ignore */ }
  }

  async function refreshAssistAllowlist() {
    const list = await getAllowlist();
    const chips = document.getElementById('assistAllowChips');
    chips.textContent = list.join(' · ');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const host = tab?.url ? hostnameOf(tab.url) : '';
      const allowed = host && list.some((h) => host === h || host.endsWith('.' + h));
      document.getElementById('assistAllowSiteBtn').title = allowed
        ? host + ' is allowlisted'
        : 'Allow ' + (host || 'this site');
    } catch { /* ignore */ }
  }

  async function allowCurrentSite() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await addCurrentSite(tab);
      if (res.ok) {
        showStatus('✓ ' + res.host + ' allowlisted' + (res.granted ? '' : ' (permission needed — check the prompt)'), 'success');
        await refreshAssistAllowlist();
      } else {
        showStatus(res.error || 'Could not allow site', 'error');
      }
    } catch (err) {
      showStatus('Allowlist error: ' + err.message, 'error');
    }
  }

  function assistLogLine(kind, text) {
    const log = document.getElementById('assistLog');
    const div = document.createElement('div');
    div.className = 'assist-log-line ' + kind;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function resolveAssistDecision(decision) {
    if (assistDecisionResolve) {
      assistDecisionResolve(decision);
      assistDecisionResolve = null;
      document.getElementById('assistPending').classList.add('hidden');
    }
  }

  function showAssistPending(proposal) {
    const body = document.getElementById('assistPendingBody');
    const parts = [
      '<b>' + escapeHtml(proposal.action) + '</b>',
      proposal.reason ? escapeHtml(proposal.reason) : '',
      proposal.target ? '<code>' + escapeHtml(proposal.target) + '</code>' : '',
      proposal.fields ? '<pre class="career-pre">' + escapeHtml(JSON.stringify(proposal.fields, null, 1)) + '</pre>' : '',
      proposal.text ? '<pre class="career-pre">' + escapeHtml(proposal.text) + '</pre>' : '',
    ].filter(Boolean).join('<br>');
    body.innerHTML = parts;
    document.getElementById('assistPending').classList.remove('hidden');
  }

  function stopAssistSession() {
    assistStopped = true;
    document.getElementById('assistStopBtn').classList.add('hidden');
    resolveAssistDecision('deny');
  }

  async function doAssistSend() {
    const prompt = document.getElementById('assistPrompt').value.trim();
    if (!prompt) return showStatus('Tell the assistant what to do', 'error');
    if (assistSession) return showStatus('A session is already running — stop it first', 'error');

    const cfg = await buildLeadsConfig();
    if (!cfg.openaiApiKey) return showStatus('Set an AI key in Settings first', 'error');

    let tab;
    try {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (err) {
      return showStatus('Cannot read the active tab: ' + err.message, 'error');
    }
    if (!isAssistableTab(tab)) return showStatus('Open a normal web page first (http/https)', 'error');
    const allowed = await isCurrentSiteAllowed(tab);
    if (!allowed) {
      showStatus('This site is not allowlisted — click "＋ allow this site" first', 'error');
      return;
    }

    assistStopped = false;
    document.getElementById('assistLog').innerHTML = '';
    document.getElementById('assistStopBtn').classList.remove('hidden');
    const readOnlyAutoApprove = document.getElementById('assistReadOnly').checked;
    try { await chrome.storage.local.set({ spider_assist_readonly_auto: readOnlyAutoApprove }); } catch { /* ignore */ }
    assistLogLine('system', 'Reading page: ' + tab.url);

    let pageSnapshot = '{}';
    try {
      pageSnapshot = await readCurrentPage(tab.id);
    } catch (err) {
      assistLogLine('error', 'Could not snapshot page: ' + err.message);
    }

    let profile = null;
    try {
      const result = await chrome.storage.local.get(['career_profile']);
      profile = result.career_profile || null;
    } catch { /* ignore */ }

    const session = runAssistSession({
      cfg,
      tabId: tab.id,
      prompt,
      profile,
      pageSnapshot,
      onLog: (kind, text) => assistLogLine(kind, text),
      onPropose: (proposal) => new Promise((resolve) => {
        assistDecisionResolve = resolve;
        showAssistPending(proposal);
      }),
      isStopped: () => assistStopped,
      readOnlyAutoApprove,
    });

    assistSession = session;
    try {
      const result = await session;
      assistLogLine('assistant', result.final);
      if (result.errors.length) assistLogLine('error', result.errors.length + ' error(s) — see log');
    } catch (err) {
      assistLogLine('error', 'Session failed: ' + err.message);
    } finally {
      assistSession = null;
      document.getElementById('assistStopBtn').classList.add('hidden');
      document.getElementById('assistPending').classList.add('hidden');
    }
  }


  document.getElementById('assistSendBtn').addEventListener('click', doAssistSend);
  document.getElementById('assistStopBtn').addEventListener('click', stopAssistSession);
  document.getElementById('assistApproveBtn').addEventListener('click', () => resolveAssistDecision('approve'));
  document.getElementById('assistDenyBtn').addEventListener('click', () => resolveAssistDecision('deny'));
  document.getElementById('assistAllowSiteBtn').addEventListener('click', allowCurrentSite);
  document.getElementById('assistPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAssistSend(); });
  return { refreshAllowlist: refreshAssistAllowlist, loadReadOnlyPref: loadAssistReadOnlyPref };
}
