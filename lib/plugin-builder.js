/**
 * AI plugin builder — describe what you want in plain language and the AI
 * generates a JSON plugin manifest (no-code). Uses the configured BYOK AI
 * provider; result is validated before you can install it.
 */

import { aiExtract } from './ai-client.js';
import { validateJsonPlugin } from '../vendor/leads-core.js';

const SCHEMA_GUIDE = [
  'You generate Spider extension plugins from a user request. A plugin is a SINGLE JSON object with this exact schema:',
  '{',
  '  "id": "kebab-case-lowercase",',
  '  "name": "Human readable name",',
  '  "version": "1.0.0",',
  '  "description": "One sentence.",',
  '  "tools": [ // optional: AI agent tools',
  '    {',
  '      "name": "tool_name",',
  '      "description": "What the tool does (the agent reads this)",',
  '      "parameters": { "type": "object", "properties": { "arg": { "type": "string", "description": "..." } }, "required": ["arg"] },',
  '      "action": {',
  '        "type": "builtin", "id": "fetch_url | search_web | fetch_jobs", "params": {}',
  '        // OR:',
  '        "type": "http", "method": "GET", "url": "https://api.example.com/items/{arg}", "headers": {}, "extract": "data.items"',
  '      }',
  '    }',
  '  ],',
  '  "hooks": { // optional: webhooks fired on leads / after runs',
  '    "onLead": { "url": "https://yourapp.com/hook", "method": "POST", "bodyTemplate": "{\"email\":\"{email}\",\"company\":\"{company}\",\"outcome\":\"{outcome}\",\"title\":\"{title}\",\"source\":\"{source}\",\"domain\":\"{domain}\",\"phone\":\"{phone}\",\"linkedin\":\"{linkedin}\",\"category\":\"{category}\",\"interests\":\"{interests}\",\"status\":\"{status}\",\"person_name\":\"{person_name}\",\"source_url\":\"{source_url}\",\"email_type\":\"{email_type}\",\"confidence\":\"{confidence}\",\"tier\":\"{tier}\",\"created_at\":\"{created_at}\",\"updated_at\":\"{updated_at}\",\"verified_at\":\"{verified_at}\",\"email_valid\":\"{email_valid}\",\"is_disposable\":\"{is_disposable}\",\"is_personal_email\":\"{is_personal_email}\",\"has_mx_records\":\"{has_mx_records}\",\"is_typo\":\"{is_typo}\",\"plunk_reasons\":\"{plunk_reasons}\",\"id\":\"{id}\",\"subcategory\":\"{subcategory}\",\"raw_data\":\"{raw_data}\",\"domain\":\"{domain}\"}" }',
  '  },',
  '  "rules": { // optional: keyword → interest/category rules',
  '    "interests": [{ "match": "regex", "topic": "Topic", "confidence": 0.7 }],',
  '    "categories": [{ "match": "regex", "category": "SaaS / Software" }]',
  '  },',
  '  "exporters": [ // optional: export formats',
  '    { "id": "jsonl", "label": "JSON Lines", "format": "jsonl" } // jsonl | json | csv',
  '  ],',
  '  "filters": [ // optional: named URL filters',
  '    { "name": "jobs", "pattern": "/(jobs|careers)/" }',
  '  ]',
  '}',
  '',
  'Rules:',
  '- Reply with ONLY the JSON object — no markdown fences, no commentary.',
  '- "id" must be lowercase kebab-case (a-z0-9-_.), max 64 chars.',
  '- Choose the builtin action that best fits the request; use http actions for custom APIs.',
  '- Keep descriptions short and precise.',
  '- If the request is unclear, make reasonable safe choices (no auth tokens, no destructive calls).',
].join('\n');

/**
 * Generate a plugin manifest from a plain-language description.
 * @returns {Promise<{ok: boolean, manifest?: object, text?: string, error?: string}>}
 */
export async function buildPluginWithAI(provider, description) {
  if (!description.trim()) return { ok: false, error: 'Describe the plugin you want first.' };
  const systemPrompt = SCHEMA_GUIDE;
  const userPrompt = 'User request:\n' + description;
  let text;
  try {
    text = await aiExtract({
      provider,
      systemPrompt,
      userPrompt,
      options: { temperature: 0.2, maxTokens: 3000 },
    });
  } catch (err) {
    return { ok: false, error: 'AI call failed: ' + err.message };
  }
  // The AI may wrap in markdown fences — strip them, then validate.
  const cleaned = text.replace(/^\s*\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`\s*$/, '').trim();
  const check = validateJsonPlugin(cleaned);
  if (!check.ok) return { ok: false, error: check.error + ' — you can still copy the raw text below and fix it.', text: cleaned };
  return { ok: true, manifest: check.manifest, text: cleaned };
}
