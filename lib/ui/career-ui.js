// Career Assist UI module (extracted from sidepanel.js)
import { buildProfile, tailorResume, draftOutreach, scoreFit } from '../../vendor/leads-core.js';
import { parseResumeFile } from '../resume-parse.js';
import { buildLeadsConfig } from '../leads.js';

export function initCareerUi(ui) {
  const { showStatus, escapeHtml, copyToClipboard, downloadFile } = ui;
  // ---------------------------------------------------------------------------
  // Career Assist (profile → tailor → drafts) — human sends everything
  // ---------------------------------------------------------------------------

  let careerProfile = null;
  const CAREER_PROFILE_KEY = 'career_profile';

  function careerCfg() {
    return buildLeadsConfig(); // async
  }

  async function loadSavedProfile() {
    try {
      const result = await chrome.storage.local.get([CAREER_PROFILE_KEY]);
      if (result[CAREER_PROFILE_KEY]) {
        careerProfile = result[CAREER_PROFILE_KEY];
        showCareerNote('Profile loaded from previous session (' + (careerProfile.fullName || 'unknown name') + '). Build again to refresh.');
      }
    } catch { /* ignore */ }
  }

  function showCareerNote(msg) {
    showStatus(msg, 'info');
  }

  function careerJob() {
    return {
      title: document.getElementById('jobTitle').value.trim(),
      company: document.getElementById('jobCompany').value.trim(),
      description: document.getElementById('jobDescription').value.trim(),
    };
  }

  function requireProfileAndJob(needJob) {
    if (!careerProfile) return 'Build your profile first (step 1).';
    if (needJob && !careerJob().description) return 'Paste a job description first (step 2).';
    return null;
  }

  function renderCareerCard(title, bodyHtml, actionsHtml) {
    const out = document.getElementById('careerOutput');
    out.innerHTML = '<div class="result-card">' +
      '<div class="result-url" style="margin-bottom:6px">' + title + '</div>' +
      '<div class="career-body">' + bodyHtml + '</div>' +
      (actionsHtml ? '<div class="result-actions" style="margin-top:8px">' + actionsHtml + '</div>' : '') +
      '</div>';
    return out;
  }

  async function doBuildProfile() {
    const cfg = await careerCfg();
    if (!cfg.openaiApiKey) return showStatus('Set an AI key in Settings first (DeepSeek/OpenAI)', 'error');
    const file = document.getElementById('resumeFile').files && document.getElementById('resumeFile').files[0];
    const pasted = document.getElementById('resumePaste').value.trim();
    let text = pasted;
    let format = 'text';
    if (file) {
      showStatus('Reading ' + file.name + '…', 'info');
      try {
        const parsed = await parseResumeFile(file);
        text = parsed.text;
        format = parsed.format;
        if (!text || text.length < 20) return showStatus('Could not extract text from ' + file.name + ' — try pasting the text.', 'error');
      } catch (err) {
        return showStatus('Failed to read ' + file.name + ': ' + err.message, 'error');
      }
    }
    if (!text) return showStatus('Select a resume file or paste the text', 'error');

    const btn = document.getElementById('buildProfileBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Building profile…';
    try {
      careerProfile = await buildProfile(cfg, text, '');
      await chrome.storage.local.set({ [CAREER_PROFILE_KEY]: careerProfile });
      const p = careerProfile;
      const body = '<b>' + esc(p.fullName || 'Unknown') + '</b>' + (p.title ? ' — ' + esc(p.title) : '') + '<br>' +
        (p.contact?.email ? '📧 ' + esc(p.contact.email) + '<br>' : '') +
        (p.contact?.linkedin ? '🔗 ' + esc(p.contact.linkedin) + '<br>' : '') +
        '🛠 ' + esc((p.skills || []).slice(0, 8).join(', ')) + '<br>' +
        '💼 ' + esc((p.experience || []).map((e) => e.role + ' @ ' + e.company).join('; ')) +
        ' <span class="muted">(from ' + esc(format.toUpperCase()) + ')</span>';
      renderCareerCard('🧑 Profile built', body, '');
      showStatus('Profile built from ' + format + ' resume ✓', 'success');
    } catch (err) {
      showStatus('Profile build failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🧑 Build my profile';
    }
  }

  async function doTailor() {
    const cfg = await careerCfg();
    const err = requireProfileAndJob(true);
    if (err) return showStatus(err, 'error');
    const btn = document.getElementById('tailorBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Tailoring…';
    try {
      const packet = await tailorResume(cfg, careerProfile, careerJob());
      const body = '<pre class="career-pre">' + esc(packet.resumeMarkdown) + '</pre>' +
        (packet.coverLetter ? '<hr><b>Cover letter</b><pre class="career-pre">' + esc(packet.coverLetter) + '</pre>' : '') +
        (packet.talkingPoints?.length ? '<hr><b>Talking points</b><ul class="career-list">' + packet.talkingPoints.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '');
      renderCareerCard('✂️ Tailored resume + cover letter',
        body,
        '<button class="btn btn-sm btn-outline" id="copyResumeBtn">📋 Copy resume</button> ' +
        '<button class="btn btn-sm btn-outline" id="copyLetterBtn">📋 Copy letter</button> ' +
        '<button class="btn btn-sm btn-outline" id="dlResumeBtn">💾 Download .md</button>');
      document.getElementById('copyResumeBtn').addEventListener('click', async () => {
        const ok = await copyToClipboard(packet.resumeMarkdown);
        showStatus(ok ? 'Resume copied' : 'Copy failed', ok ? 'success' : 'error');
      });
      document.getElementById('copyLetterBtn').addEventListener('click', async () => {
        const ok = await copyToClipboard(packet.coverLetter);
        showStatus(ok ? 'Cover letter copied' : 'Copy failed', ok ? 'success' : 'error');
      });
      document.getElementById('dlResumeBtn').addEventListener('click', () => {
        downloadFile(packet.resumeMarkdown, 'resume-' + (careerJob().company || careerJob().title || 'tailored').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.md', 'text/markdown');
      });
      showStatus('Tailored packet ready — review before sending ✓', 'success');
    } catch (e2) {
      showStatus('Tailor failed: ' + e2.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✂️ Tailor resume + cover letter';
    }
  }

  async function doFitScore() {
    const cfg = await careerCfg();
    const err = requireProfileAndJob(true);
    if (err) return showStatus(err, 'error');
    try {
      const fit = await scoreFit(cfg, careerProfile, careerJob());
      const body = '<div style="font-size:22px;font-weight:700">' + fit.score + '<span class="muted" style="font-size:13px">/100 fit</span></div>' +
        '<b>Strengths</b><ul class="career-list">' + fit.strengths.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
        '<b>Gaps</b><ul class="career-list">' + fit.gaps.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
        '<b>Questions to research</b><ul class="career-list">' + fit.questions.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
      renderCareerCard('📊 Fit score', body, '');
    } catch (e3) {
      showStatus('Fit score failed: ' + e3.message, 'error');
    }
  }

  async function doOutreachDraft(channel) {
    const cfg = await careerCfg();
    const err = requireProfileAndJob(true);
    if (err) return showStatus(err, 'error');
    try {
      const draft = await draftOutreach(cfg, careerProfile, careerJob(), channel);
      const body = draft.subject ? '<b>Subject:</b> ' + esc(draft.subject) + '<hr>' : '';
      const actions = [];
      if (channel === 'email') {
        const contactEmail = careerProfile.contact?.email || '';
        const mailto = 'mailto:' + encodeURIComponent(contactEmail) +
          '?subject=' + encodeURIComponent(draft.subject || 'Application') +
          '&body=' + encodeURIComponent(draft.body);
        actions.push('<a class="btn btn-sm btn-outline" href="' + mailto + '">✉️ Open in my mail app</a>');
      } else {
        actions.push('<button class="btn btn-sm btn-outline" id="openLIRecruiter">🔗 Open LinkedIn</button>');
      }
      actions.push('<button class="btn btn-sm btn-outline" id="copyDraftBtn">📋 Copy message</button>');
      renderCareerCard(channel === 'email' ? '✉️ Email draft (review & send in your mail app)' : '💼 LinkedIn message (review & paste in LinkedIn)',
        body + '<pre class="career-pre">' + esc(draft.body) + '</pre>', actions.join(' '));
      document.getElementById('copyDraftBtn').addEventListener('click', async () => {
        const ok = await copyToClipboard(draft.body);
        showStatus(ok ? 'Draft copied — paste it into LinkedIn/mail yourself' : 'Copy failed', ok ? 'success' : 'error');
      });
      if (channel === 'linkedin') {
        document.getElementById('openLIRecruiter').addEventListener('click', () => {
          const q = encodeURIComponent((careerJob().company || careerJob().title || '') + ' recruiter');
          window.open('https://www.linkedin.com/search/results/people/?keywords=' + q, '_blank');
        });
      }
      showStatus('Draft ready — you send it, we never auto-send', 'success');
    } catch (e4) {
      showStatus('Draft failed: ' + e4.message, 'error');
    }
  }

  function esc(str) {
    return escapeHtml(str);
  }



  document.getElementById('buildProfileBtn').addEventListener('click', doBuildProfile);
  document.getElementById('tailorBtn').addEventListener('click', doTailor);
  document.getElementById('fitBtn').addEventListener('click', doFitScore);
  document.getElementById('emailDraftBtn').addEventListener('click', () => doOutreachDraft('email'));
  document.getElementById('linkedinDraftBtn').addEventListener('click', () => doOutreachDraft('linkedin'));
  return { loadSavedProfile };
}
