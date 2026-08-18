// Page-context helpers for the browser assistant.
// IMPORTANT: these functions run inside the target PAGE (serialized by
// chrome.scripting.executeScript) — they must be fully self-contained:
// no imports, no closures over module scope, defensive feature detection.
// They are also unit-testable in Node with a stubbed global document.

const SUBMIT_HINTS = /submit|apply now|send application|send message|send|create account|sign up|register|post a job/i;
const SENSITIVE_HINTS = /gender|race|ethnicity|disability|veteran|salary|compensation|visa|sponsorship|authorization|work auth|ssn|social security|birth|date of birth|national id|passport|id number|card number/i;

const FIELD_KEYWORDS = {
  fullName: ['full name', 'your name', 'applicant name', 'first and last', 'what is your name'],
  firstName: ['first name', 'first'],
  lastName: ['last name', 'last'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'telephone', 'mobile', 'contact number'],
  linkedin: ['linkedin'],
  location: ['location', 'city', 'current city'],
  title: ['job title', 'current title', 'position', 'professional title'],
  company: ['company', 'employer', 'current company'],
  website: ['website', 'portfolio', 'personal site', 'github url'],
  summary: ['summary', 'about you', 'cover letter', 'tell us about', 'message', 'bio', 'introduction', 'anything else'],
  startDate: ['start date', 'earliest start', 'availability'],
};

function doc() {
  return typeof document !== 'undefined' ? document : null;
}

function labelOf(el) {
  const d = doc();
  if (!d) return '';
  const bits = [];
  if (el.id && d.querySelector) {
    const l = d.querySelector('label[for="' + String(el.id).replace(/"/g, '') + '"]');
    if (l) bits.push(l.innerText || l.textContent || '');
  }
  if (el.closest) {
    const wrap = el.closest('label');
    if (wrap) bits.push(wrap.innerText || wrap.textContent || '');
  }
  const aria = el.getAttribute ? el.getAttribute('aria-label') : null;
  if (aria) bits.push(aria);
  if (el.placeholder) bits.push(el.placeholder);
  if (el.name) bits.push(el.name);
  if (el.id) bits.push(el.id);
  return bits.join(' ').toLowerCase();
}

function setVal(el, value) {
  // React-friendly: use the native value setter so controlled inputs update.
  try {
    let proto = null;
    if (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else if (typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) proto = HTMLInputElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } catch {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function controls() {
  const d = doc();
  if (!d || !d.querySelectorAll) return [];
  return [...d.querySelectorAll(
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]), textarea, select'
  )];
}

function matchKey(label) {
  for (const key of Object.keys(FIELD_KEYWORDS)) {
    if (FIELD_KEYWORDS[key].some((w) => label.includes(w))) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------

export function readPage() {
  const d = doc();
  const text = d && d.body && (d.body.innerText || d.body.textContent || '') ? (d.body.innerText || d.body.textContent).slice(0, 6000) : '';
  const forms = (d && d.querySelectorAll ? [...d.querySelectorAll('form')] : []).map((f) => ({
    action: f.action || '',
    fields: [...f.querySelectorAll('input, textarea, select')].slice(0, 40).map((el) => ({
      name: el.name || '',
      id: el.id || '',
      type: el.type || el.tagName.toLowerCase(),
      placeholder: el.placeholder || '',
      label: labelOf(el).slice(0, 120),
      required: el.required === true,
    })),
  }));
  const buttons = (d && d.querySelectorAll
    ? [...d.querySelectorAll('button, input[type=submit]')].slice(0, 40)
    : []).map((b) => (b.innerText || b.value || b.textContent || '').trim()).filter(Boolean).slice(0, 15);
  return JSON.stringify({
    title: d ? d.title || '' : '',
    url: typeof location !== 'undefined' && location ? location.href : '',
    text,
    forms,
    buttons,
  });
}

export function fillForm(fields) {
  const els = controls();
  const filled = [];
  const skippedSensitive = [];
  const unmatched = new Set();
  for (const el of els) {
    const label = labelOf(el);
    if (el.disabled || el.readOnly) {
      skippedSensitive.push((label.slice(0, 60) || el.name || el.id) + ' (disabled)');
      continue;
    }
    if (SENSITIVE_HINTS.test(label)) {
      skippedSensitive.push(label.slice(0, 60) || el.name || el.id);
      continue;
    }
    const key = matchKey(label);
    if (!key) {
      const short = (label || el.name || el.id || '').slice(0, 40);
      if (short) unmatched.add(short);
      continue;
    }
    const value = fields && fields[key];
    if (value === undefined || value === null || value === '') continue;
    setVal(el, String(value));
    filled.push({ key, label: label.slice(0, 60), value: String(value).slice(0, 40) });
  }
  return JSON.stringify({
    ok: true,
    filled,
    skippedSensitive: skippedSensitive.slice(0, 8),
    unmatched: [...unmatched].slice(0, 12),
  });
}

export function setText(payload) {
  const d = doc();
  if (!d || !d.querySelector) return JSON.stringify({ ok: false, error: 'no document' });
  const el = d.querySelector(String((payload && payload.selector) || ''));
  if (!el) return JSON.stringify({ ok: false, error: 'element not found: ' + ((payload && payload.selector) || '') });
  const tag = (el.tagName || '').toUpperCase();
  if (tag !== 'TEXTAREA' && tag !== 'INPUT' && !el.isContentEditable) {
    return JSON.stringify({ ok: false, error: 'target is not a text field' });
  }
  const text = String((payload && payload.text) || '');
  if (el.isContentEditable) {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    setVal(el, text);
  }
  return JSON.stringify({ ok: true, into: (payload && payload.selector) || '' });
}

export function clickEl(selector) {
  const d = doc();
  if (!d || !d.querySelector) return JSON.stringify({ ok: false, error: 'no document' });
  const el = d.querySelector(String(selector || ''));
  if (!el) return JSON.stringify({ ok: false, error: 'element not found: ' + selector });
  const label = ((el.innerText || el.value || el.textContent || '') + ' ' + (el.type || '') + ' ' + (el.className || '')).trim();
  if (SUBMIT_HINTS.test(label)) {
    return JSON.stringify({ ok: false, blocked: 'submit/send action refused — the user must submit manually', label: label.slice(0, 80) });
  }
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  el.click();
  return JSON.stringify({ ok: true, clicked: (el.innerText || el.value || selector || '').slice(0, 60) });
}

export function copyText(text) {
  const d = doc();
  const value = String(text || '');
  try {
    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(
        () => JSON.stringify({ ok: true }),
        () => fallbackCopy(value)
      );
    }
  } catch { /* fall through */ }
  return Promise.resolve(fallbackCopy(value));
}

function fallbackCopy(value) {
  const d = doc();
  if (!d || !d.createElement || !d.body) return JSON.stringify({ ok: false, error: 'no document for clipboard' });
  const ta = d.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  d.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = d.execCommand ? d.execCommand('copy') : false; } catch { ok = false; }
  d.body.removeChild(ta);
  return JSON.stringify({ ok });
}

export function scrollToEl(selector) {
  const d = doc();
  if (!d || !d.querySelector) return JSON.stringify({ ok: false, error: 'no document' });
  const el = d.querySelector(String(selector || ''));
  if (!el) return JSON.stringify({ ok: false, error: 'element not found: ' + selector });
  if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return JSON.stringify({ ok: true });
}