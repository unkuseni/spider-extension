/**
 * Approval-gated AI browser assistant loop.
 *
 * The model proposes browser actions (browser_action tool); every proposal is
 * shown to the user, who approves or denies it. Only approved actions execute
 * on the current tab. The model never has a submit/send action, and the
 * execution layer refuses submit-like clicks regardless.
 */

import { chatWithTools } from '../vendor/leads-core.js';
import { executeAction, isCurrentSiteAllowed, isUrlAllowed } from './browser-assist.js';

const BROWSER_ACTION_TOOL = {
  type: 'function',
  function: {
    name: 'browser_action',
    description:
      'Perform one action on the current tab. The user approves every action before it runs. ' +
      'Action types: navigate (target=URL), open_tab (target=URL), close_tab (tabId), activate_tab (tabId), ' +
      'list_tabs, read_page (inspect page), fill_form (fields map profile keys ' +
      'fullName/firstName/lastName/email/phone/linkedin/location/title/company/website/summary/startDate), ' +
      'set_text (target=selector, text), click (target=selector — non-submit elements only), ' +
      'scroll_to (target=selector), copy_text (text — copies to clipboard).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'open_tab', 'close_tab', 'activate_tab', 'list_tabs', 'read_page', 'fill_form', 'set_text', 'click', 'scroll_to', 'copy_text'],
        },
        target: { type: 'string', description: 'URL (navigate/open_tab) or CSS selector (others)' },
        tabId: { type: 'integer', description: 'For close_tab / activate_tab' },
        fields: { type: 'object', description: 'For fill_form: profile field values' },
        text: { type: 'string', description: 'For set_text / copy_text' },
        reason: { type: 'string', description: 'Why this action, in one sentence' },
      },
      required: ['action', 'reason'],
    },
  },
};

const SYSTEM_PROMPT =
  'You are a browser assistant that helps the user apply for jobs and fill forms on the CURRENT tab.\n' +
  'Rules:\n' +
  '- Propose ONE action at a time with a clear reason. The user approves each action; if they deny, adapt your plan.\n' +
  '- You CANNOT submit applications, send messages, log in, or handle credentials — those actions do not exist; the user does them manually.\n' +
  '- Never auto-fill visa/salary/demographic/SSN fields — the filler skips those automatically.\n' +
  '- Inspect the page with read_page before filling; only fill fields that exist.\n' +
  '- When done, summarize what you did and exactly what remains for the user (e.g. "review the form and click Submit yourself").\n' +
  'You receive the current page snapshot and, if available, the user profile.\n' +
  'Profile keys you can use in fill_form.fields: fullName, firstName, lastName, email, phone, linkedin, location, title, company, website, summary, startDate.';

export function buildAssistMessages(prompt, pageSnapshot, profile) {
  const sys = SYSTEM_PROMPT +
    '\n\nCURRENT PAGE SNAPSHOT:\n' + String(pageSnapshot || '{}').slice(0, 8000) +
    (profile ? '\n\nUSER PROFILE (use only these real facts):\n' + JSON.stringify(profile).slice(0, 6000) : '');
  return [
    { role: 'system', content: sys },
    { role: 'user', content: String(prompt || '').slice(0, 2000) },
  ];
}

/**
 * Run one approval-gated session.
 *
 * @param {object} opts
 * @param {object} opts.cfg          session config (AI key etc.)
 * @param {number} opts.tabId        the tab to assist on
 * @param {string} opts.prompt       user instruction
 * @param {object|null} opts.profile career profile (optional)
 * @param {string} opts.pageSnapshot JSON snapshot of the page
 * @param {function} opts.onLog      (kind, text) => void  — 'assistant' | 'system' | 'error'
 * @param {function} opts.onPropose  async (proposal) => 'approve' | 'deny'
 * @param {function} opts.isStopped  () => boolean
 * @param {boolean} opts.autoApprove test hook
 * @param {boolean} opts.readOnlyAutoApprove auto-approve harmless read-only actions
 *                  (navigate, read_page, scroll_to, list_tabs)
 */
const READ_ONLY_ACTIONS = new Set(['navigate', 'read_page', 'scroll_to', 'list_tabs']);

export async function runAssistSession(opts) {
  const { cfg, tabId, prompt, profile, pageSnapshot, onLog = () => {}, onPropose, isStopped = () => false, autoApprove = false, readOnlyAutoApprove = false } = opts;
  const messages = buildAssistMessages(prompt, pageSnapshot, profile);
  const errors = [];
  let final = '';
  let turns = 0;
  const maxTurns = 12;

  for (; turns < maxTurns; turns++) {
    if (isStopped()) { final = '(stopped by user)'; break; }
    let resp;
    try {
      resp = await chatWithTools(cfg, messages, [BROWSER_ACTION_TOOL]);
    } catch (err) {
      errors.push(err.message);
      onLog('error', 'AI call failed: ' + err.message);
      final = 'Stopped after an AI error: ' + err.message;
      break;
    }
    if (!resp.toolCalls.length) {
      final = resp.content || '(no summary)';
      break;
    }
    for (const call of resp.toolCalls) {
      if (isStopped()) { final = '(stopped by user)'; break; }
      const args = call.args && typeof call.args === 'object' ? call.args : {};
      const reason = String(args.reason || '');

      let decision = 'deny';
      if (autoApprove || (readOnlyAutoApprove && READ_ONLY_ACTIONS.has(args.action))) {
        decision = 'approve';
        if (readOnlyAutoApprove && READ_ONLY_ACTIONS.has(args.action) && !autoApprove) {
          onLog('system', 'Auto-approved (read-only): ' + (args.action || '?'));
        }
      } else if (typeof onPropose === 'function') {
        onLog('propose', (args.action || '?') + ' — ' + reason + (args.target ? ' [' + args.target + ']' : ''));
        decision = await onPropose({ action: args.action, target: args.target, tabId: args.tabId, fields: args.fields, text: args.text, reason });
      }

      let result;
      if (decision === 'deny') {
        result = JSON.stringify({ ok: false, userDenied: true, reason: 'user denied the action' });
        onLog('system', 'Action denied by user');
      } else {
        if (!(await isCurrentSiteAllowed({ url: await currentTabUrl(tabId) }))) {
          result = JSON.stringify({ ok: false, error: 'site is not in the allowlist — add it in the panel first' });
          onLog('system', 'Blocked: current site not allowlisted');
        } else if ((args.action === 'navigate' || args.action === 'open_tab') && !(await isUrlAllowed(String(args.target || args.url || '')))) {
          result = JSON.stringify({ ok: false, error: 'destination is not in the allowlist — add it first' });
          onLog('system', 'Blocked: destination not allowlisted');
        } else {
          try {
            result = await executeAction(tabId, args);
            onLog('system', 'Executed: ' + String(result).slice(0, 200));
          } catch (err) {
            result = JSON.stringify({ ok: false, error: err.message });
            onLog('error', 'Execution failed: ' + err.message);
          }
        }
      }

      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(args) } }],
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  return { final, turns: turns + 1, errors };
}

async function currentTabUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || '';
  } catch {
    return '';
  }
}