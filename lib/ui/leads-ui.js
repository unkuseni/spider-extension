// Lead Finder UI module (extracted from sidepanel.js)
import {
  hunt as pipelineHunt, huntSearch as pipelineSearch, verifyStored as pipelineVerify,
  listLeads, dbStats, runAgent,
} from '../../vendor/leads-core.js';
import { buildLeadsConfig, getLeadsDb, getLeadsSettings, missingLeadsConfig } from '../../lib/leads.js';
import { getInstalledPluginMeta, loadActivePlugins } from '../../lib/plugins.js';

export function initLeadsUi(ui) {
  const { showStatus, escapeHtml, copyToClipboard, downloadFile } = ui;
  // ---------------------------------------------------------------------------
  // Lead Finder
  // ---------------------------------------------------------------------------

  let leadsConfig = null;
  let leadsPlugins = [];

  async function refreshLeadsConfigState() {
    leadsConfig = await buildLeadsConfig();
    leadsPlugins = await loadActivePlugins(leadsConfig);
    const meta = await getInstalledPluginMeta();
    const badge = document.getElementById('pluginsBadge');
    if (badge) {
      const active = meta.filter((m) => m.enabled).length;
      badge.textContent = '🧩 ' + active + ' plugin' + (active === 1 ? '' : 's');
      badge.title = meta.map((m) => m.name + (m.enabled ? '' : ' (off)')).join('\n') || 'No plugins';
    }
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
      plugins: leadsPlugins,
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

  async function openPluginsSettings() {
    chrome.runtime.openOptionsPage();
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
        const result = await runAgent(db, cfg, objective, {
          maxTurns: 15,
          limit: 8,
          extraTools: leadsPlugins.flatMap((p) => p.tools || []),
        });
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



  document.getElementById('leadsHuntBtn').addEventListener('click', doLeadsHunt);
  document.getElementById('agentBtn').addEventListener('click', doRunAgent);
  document.getElementById('pluginsBadge').addEventListener('click', openPluginsSettings);
  document.getElementById('leadsSearchBtn').addEventListener('click', doLeadsSearch);
  document.getElementById('leadsVerifyBtn').addEventListener('click', doLeadsVerify);
  document.getElementById('leadsStatsBtn').addEventListener('click', doLeadsStats);
  document.getElementById('leadsExportBtn').addEventListener('click', doLeadsExport);
  document.getElementById('openOptionsFromLeads').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  return { refreshConfigState: refreshLeadsConfigState };
}
