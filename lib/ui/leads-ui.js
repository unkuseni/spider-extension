// Lead Finder UI module (extracted from sidepanel.js)
import {
  hunt as pipelineHunt, huntSearch as pipelineSearch, verifyStored as pipelineVerify,
  listLeads, dbStats, runAgent, enrichDomain,
  scoreLead, classifyTitle, icpMatch, updateLeadScore,
  findEmployees, listScraperDirectory,
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
    document.getElementById('leadsGuess').checked = settings.guessEmails === true;
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
    const guess = document.getElementById('leadsGuess').checked;
    return {
      limit: parseInt(document.getElementById('leadsLimit').value) || 10,
      depth: 2,
      mode: 'smart',
      extract: document.getElementById('leadsExtract').value,
      verify,
      guessEmails: guess,
      perPerson: 3,
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
    if (s.peopleFound) rows.push(['People discovered', s.peopleFound]);
    if (s.guessesMade) {
      rows.push(['Email guesses', s.guessesMade + ' verified → ' + (s.guessedEmailsFound || 0) + ' found, ' + (s.guessedInvalid || 0) + ' invalid']);
    }
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
    const srcChip = (s) => {
      const label = { page: 'Found', guessed: '🔮 Guessed', github: 'GitHub', agent: 'Agent', user: 'User' }[s] || s || '';
      const title = s === 'guessed' ? 'Inferred from the domain email pattern + verified' : s === 'github' ? 'Public GitHub profile email' : 'Published on the site';
      return label ? '<span class="status-badge source-' + esc(s) + '" title="' + esc(title) + '">' + esc(label) + '</span>' : '';
    };
    const gradeChip = (g) => g ? '<span class="grade-chip grade-' + esc(String(g).toLowerCase()) + '">' + esc(g) + '</span>' : '';
    const head = ['Email', 'Name', 'Title', 'Company', 'Type', 'Category', 'Source', 'Score', 'Grade', 'Status', 'Verified'];
    const html = '<table class="leads-table"><thead><tr>' +
      head.map((c) => '<th>' + c + '</th>').join('') +
      '</tr></thead><tbody>' +
      rows.map((r) => {
        let interests = '';
        try {
          const list = JSON.parse(r.interests || '[]');
          interests = list.slice(0, 2).map((i) => '<span class="category-chip">' + esc(i.topic) + '</span>').join(' ');
        } catch { /* ignore */ }
        const guessTip = r.email_pattern ? ' pattern ' + esc(r.email_pattern) + ' · score ' + (r.email_score ?? '') : '';
        const verified = r.email_valid === 1 ? '✓' : r.email_valid === 0 ? '✗' : '';
        return '<tr>' +
          '<td class="email-cell" title="Click to copy' + guessTip + '">' + esc(r.email || '') + '</td>' +
          '<td>' + esc(r.person_name || '') + '</td>' +
          '<td class="muted">' + esc(r.title || '') + '</td>' +
          '<td>' + esc(r.company || '') + '</td>' +
          '<td>' + typeChip(r.email_type) + '</td>' +
          '<td>' + (r.category ? '<span class="category-chip">' + esc(r.category) + '</span>' : '') + '</td>' +
          '<td>' + srcChip(r.email_source) + '</td>' +
          '<td class="' + (r.lead_score == null ? 'muted' : '') + '" style="text-align:right">' + (r.lead_score ?? '') + '</td>' +
          '<td>' + gradeChip(r.lead_tier) + '</td>' +
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

  // 👥 Employees: extract a company's people (AI Studio prompt→JSON when enabled).
  async function doLeadsEmployees() {
    const targets = document.getElementById('leadsTargets').value
      .split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
    if (targets.length === 0) return showStatus('Enter at least one target domain', 'error');
    await runLeadsAction(async (db, cfg) => {
      const summary = await findEmployees(db, cfg, targets, leadsOpts());
      renderLeadsSummary(summary);
      renderLeads(await listLeads(db, { limit: 50 }));
      if (!cfg.aiStudio) showStatus('Employees: standard extraction used (enable AI Studio in Options for prompt→JSON extraction)', 'info');
    }, 'Extracting employees…');
  }

  // 📚 Scrapers: browse Spider's curated scraper configs (needs no keys — no config gating).
  async function doLeadsScrapers() {
    try {
      const configs = await listScraperDirectory({ limit: 25 });
      const el = document.getElementById('leadsSummary');
      el.classList.remove('hidden');
      el.innerHTML = '<b>📚 Scraper configs</b>\n' +
        configs.map((c) => escapeHtml(
          c.domain + ' ' + (c.path_pattern || '') + ' [' + (c.confidence_score || 0).toFixed(2) + '] ' + (c.display_name || c.description || '')
        )).join('\n');
      showStatus('Loaded ' + configs.length + ' scraper config(s)', 'success');
    } catch (err) {
      showStatus('Scrapers error: ' + err.message, 'error');
    }
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

  // ⚡ Score: recompute per-lead score/grade (department, seniority, decision-maker, ICP) for every stored lead.
  async function doLeadsScore() {
    await runLeadsAction(async (db, cfg) => {
      const rows = await listLeads(db, { limit: 100000 });
      let updated = 0, skipped = 0;
      for (const r of rows) {
        if (!r.email) { skipped++; continue; }
        let topics = [];
        try {
          const parsed = JSON.parse(r.interests || '[]');
          topics = Array.isArray(parsed) ? parsed.map((i) => typeof i === 'string' ? i : (i?.topic ?? '')) : [];
        } catch { /* ignore */ }
        const cls = classifyTitle(r.title);
        const icp = icpMatch(r.category, topics, cfg.icpCategories, cfg.icpInterests);
        const { score, grade } = scoreLead({
          emailValid: r.email_valid,
          emailScore: r.email_score,
          emailSource: r.email_source,
          companyTier: r.tier,
          companyConfidence: r.confidence,
          icpMatch: icp,
          title: r.title,
        });
        await updateLeadScore(db, r.email, {
          department: cls.department, seniority: cls.seniority,
          decisionMaker: cls.decisionMaker, leadScore: score, leadTier: grade, icpMatch: icp,
        });
        updated++;
      }
      const el = document.getElementById('leadsSummary');
      el.classList.remove('hidden');
      el.innerHTML = '⚡ Scored ' + updated + ' lead(s)' + (skipped ? ' (' + skipped + ' skipped — no email)' : '');
      showStatus('⚡ Scored ' + updated + ' lead(s)', 'success');
      renderLeads(await listLeads(db, { limit: 50 }));
    }, 'Scoring…');
  }

  // 🔮 Enrich: infer + verify employee emails for companies already in the DB.
  async function doLeadsEnrich() {
    await runLeadsAction(async (db, cfg) => {
      const rows = await listLeads(db, { limit: 100000 });
      const domains = [...new Set(rows.map((r) => r.domain).filter(Boolean))];
      if (domains.length === 0) return showStatus('No leads yet — hunt or search first', 'error');
      const settings = await getLeadsSettings();
      const perPerson = settings.guessPerPerson || 3;
      let total = { people: 0, candidates: 0, found: 0, invalid: 0, errors: [] };
      for (const domain of domains) {
        showStatus('🔮 Enriching ' + domain + '…', 'info');
        const res = await enrichDomain(db, cfg, domain, {
          verify: !!cfg.plunkApiKey,
          perPerson,
          meta: { company: domain },
        });
        total.people += res.people;
        total.candidates += res.candidatesGenerated;
        total.found += res.emailsFound;
        total.invalid += res.invalid;
        total.errors.push(...res.errors);
      }
      renderLeadsSummary({ target: domains.join(', '), source: 'enrich', pagesCrawled: 0,
        leadsFound: total.people, leadsNew: total.found, leadsUpdated: 0,
        leadsVerified: total.found, leadsInvalid: total.invalid, errors: [] });
      document.getElementById('leadsSummary').innerHTML =
        '<b>🔮 Enrich: ' + escapeHtml(domains.join(', ')) + '</b>\n' +
        escapeHtml('people: ' + total.people + ' | candidates: ' + total.candidates +
          ' | emails found: ' + total.found + ' | invalid: ' + total.invalid) + '\n' +
        (total.errors.length ? escapeHtml('errors: ' + total.errors.length) : '');
      renderLeads(await listLeads(db, { limit: 50 }));
      if (!cfg.plunkApiKey) showStatus('No Plunk key — candidates were saved but not verified', 'info');
    }, 'Enriching emails…');
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
    const btns = ['leadsHuntBtn', 'leadsSearchBtn', 'leadsVerifyBtn', 'leadsEnrichBtn', 'leadsScoreBtn', 'leadsEmployeesBtn'];
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
  document.getElementById('leadsEnrichBtn').addEventListener('click', doLeadsEnrich);
  document.getElementById('leadsStatsBtn').addEventListener('click', doLeadsStats);
  document.getElementById('leadsExportBtn').addEventListener('click', doLeadsExport);
  document.getElementById('leadsScoreBtn').addEventListener('click', doLeadsScore);
  document.getElementById('leadsEmployeesBtn').addEventListener('click', doLeadsEmployees);
  document.getElementById('leadsScrapersBtn').addEventListener('click', doLeadsScrapers);
  document.getElementById('openOptionsFromLeads').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  return { refreshConfigState: refreshLeadsConfigState };
}
