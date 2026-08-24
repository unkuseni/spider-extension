var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/promise-limit/index.js
var require_promise_limit = __commonJS({
  "node_modules/promise-limit/index.js"(exports, module) {
    function limiter(count) {
      var outstanding = 0;
      var jobs = [];
      function remove() {
        outstanding--;
        if (outstanding < count) {
          dequeue();
        }
      }
      function dequeue() {
        var job = jobs.shift();
        semaphore.queue = jobs.length;
        if (job) {
          run(job.fn).then(job.resolve).catch(job.reject);
        }
      }
      function queue(fn) {
        return new Promise(function(resolve, reject) {
          jobs.push({ fn, resolve, reject });
          semaphore.queue = jobs.length;
        });
      }
      function run(fn) {
        outstanding++;
        try {
          return Promise.resolve(fn()).then(function(result) {
            remove();
            return result;
          }, function(error) {
            remove();
            throw error;
          });
        } catch (err) {
          remove();
          return Promise.reject(err);
        }
      }
      var semaphore = function(fn) {
        if (outstanding >= count) {
          return queue(fn);
        } else {
          return run(fn);
        }
      };
      return semaphore;
    }
    function map(items, mapper) {
      var failed = false;
      var limit = this;
      return Promise.all(items.map(function() {
        var args = arguments;
        return limit(function() {
          if (!failed) {
            return mapper.apply(void 0, args).catch(function(e) {
              failed = true;
              throw e;
            });
          }
        });
      }));
    }
    function addExtras(fn) {
      fn.queue = 0;
      fn.map = map;
      return fn;
    }
    module.exports = function(count) {
      if (count) {
        return addExtras(limiter(count));
      } else {
        return addExtras(function(fn) {
          return fn();
        });
      }
    };
  }
});

// spider-leads/src/config.ts
function requireSpiderKey(cfg) {
  if (!cfg.spiderApiKey) {
    throw new Error(
      "SPIDER_API_KEY is not set. Get one at https://spider.cloud/api-keys and add it to your .env file."
    );
  }
}

// spider-leads/src/log.ts
var hasTTY = typeof process !== "undefined" && !!process.stdout && !!process.stdout.isTTY;
var noColorEnv = typeof process !== "undefined" && process.env ? !!process.env.NO_COLOR : false;
var NO_COLOR = !hasTTY || noColorEnv;
var c = (code, s) => NO_COLOR ? s : `\x1B[${code}m${s}\x1B[0m`;
var log = {
  verbose: false,
  info(msg) {
    console.log(c("36", "\u2139") + " " + msg);
  },
  step(msg) {
    console.log(c("35", "\u2192") + " " + c("1", msg));
  },
  ok(msg) {
    console.log(c("32", "\u2713") + " " + msg);
  },
  warn(msg) {
    console.log(c("33", "\u26A0") + " " + msg);
  },
  error(msg) {
    console.error(c("31", "\u2717") + " " + msg);
  },
  debug(msg) {
    if (log.verbose) console.log(c("90", "  " + msg));
  },
  raw(msg) {
    console.log(msg);
  }
};

// spider-leads/src/spider.ts
var SpiderError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function proxyFields(cfg) {
  const out = {};
  if (cfg.spiderProxy) out.premium_proxy = true;
  if (cfg.spiderCountry && /^[a-z]{2}$/i.test(cfg.spiderCountry)) out.country_code = cfg.spiderCountry.toLowerCase();
  return out;
}
async function apiPost(cfg, path, body, attempts = 3) {
  const merged = { ...proxyFields(cfg), ...body };
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let resp;
    try {
      resp = await fetch(cfg.spiderApiBase + path, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.spiderApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(merged)
      });
    } catch (err) {
      lastErr = err;
      log.debug(`spider ${path} network error (attempt ${attempt}): ${String(err)}`);
      await sleep(800 * attempt);
      continue;
    }
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = new SpiderError(resp.status, `HTTP ${resp.status}`);
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? Number(retryAfter) * 1e3 : 800 * attempt;
      log.debug(`spider ${path} ${resp.status} \u2014 retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let msg = text.slice(0, 300);
      let creditHint = "";
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || msg;
        if (resp.status === 402 || String(j.code ?? "").includes("credit")) {
          creditHint = " \u2014 add credits at https://spider.cloud/credits/new (failed pages cost $0, but requests need balance; the scraper catalog & /data/scraper-directory are free)";
        }
      } catch {
      }
      throw new SpiderError(resp.status, `${path} failed (${resp.status}): ${msg}${creditHint}`);
    }
    return await resp.json();
  }
  throw new SpiderError(0, `${path} failed after ${attempts} attempts: ${String(lastErr)}`);
}
function pageFrom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url ?? "");
  const content = String(raw.content ?? raw.markdown ?? raw.text ?? raw.html ?? "");
  const status = Number(raw.status ?? raw.status_code ?? 0);
  if (!url) return null;
  return { url, markdown: content, status };
}
async function getSiteLinks(cfg, url, opts = {}) {
  const data = await apiPost(cfg, "/links", {
    url,
    limit: opts.limit ?? cfg.crawlLimit * 5,
    request: opts.mode ?? "smart"
  });
  const list = Array.isArray(data) ? data : data.links ?? data.urls ?? [];
  return list.map((l) => typeof l === "string" ? l : l.url ?? l.href ?? l.link ?? "").filter((u) => /^https?:\/\//.test(u));
}
async function crawlPages(cfg, url, opts = {}) {
  const data = await apiPost(cfg, "/crawl", {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    depth: opts.depth ?? cfg.crawlDepth,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown"
  });
  const arr = Array.isArray(data) ? data : [data];
  return arr.map(pageFrom).filter((p) => p !== null);
}
async function scrapePage(cfg, url, opts = {}) {
  const data = await apiPost(cfg, "/scrape", {
    url,
    limit: 1,
    request: opts.mode ?? "smart",
    return_format: opts.format ?? "markdown"
  });
  const page = pageFrom(Array.isArray(data) ? data[0] : data);
  if (!page) throw new SpiderError(0, `/scrape returned no content for ${url}`);
  return page;
}
async function searchPages(cfg, query, opts = {}) {
  const data = await apiPost(cfg, "/search", {
    search: query,
    limit: opts.limit ?? 10,
    request: opts.mode ?? "smart",
    return_format: "markdown",
    fetch_page_content: true
  });
  const arr = Array.isArray(data) ? data : Array.isArray(data.content) ? data.content : Array.isArray(data.results) ? data.results : [];
  return arr.map((r) => pageFrom(r)).filter((p) => p !== null && p.markdown.length > 0);
}
async function extractContactsSpider(cfg, url, opts = {}) {
  const data = await apiPost(cfg, "/v1/pipeline/extract-contacts", {
    url,
    limit: opts.limit ?? cfg.crawlLimit,
    model: opts.model ?? "gpt-4o",
    prompt: opts.prompt ?? "Extract all team member contact information: name, email, phone, title, LinkedIn profile."
  });
  const arr = Array.isArray(data) ? data : [];
  return arr.filter((r) => r && typeof r === "object");
}
async function aiStudioExtract(cfg, route, urlOrSearch, prompt, opts = {}) {
  const body = {
    ...proxyFields(cfg),
    prompt,
    limit: opts.limit ?? 10
  };
  if (route === "search") body.search = urlOrSearch;
  else body.url = urlOrSearch;
  if (opts.metadata === false) body.metadata = false;
  if (opts.returnFormat) body.return_format = opts.returnFormat;
  if (opts.schema) body.extraction_schema = opts.schema;
  const data = await apiPost(cfg, "/ai/" + route, body);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.pages) ? data.pages : data?.data ? data.data : [];
  return arr.map((r) => ({
    url: String(r?.url ?? ""),
    status: Number(r?.status ?? 0),
    error: r?.error ?? null,
    content: r?.content ?? null,
    extractedData: r?.metadata?.extracted_data ?? r?.extracted_data ?? null,
    links: Array.isArray(r?.links) ? r.links.map(String) : []
  }));
}
async function listScraperDirectory(opts = {}) {
  const qs = new URLSearchParams();
  if (opts.domain) qs.set("domain", opts.domain);
  if (opts.category) qs.set("category", opts.category);
  qs.set("limit", String(opts.limit ?? 50));
  const resp = await fetch((opts.base ?? "https://api.spider.cloud") + "/data/scraper-directory?" + qs.toString(), {
    headers: { Accept: "application/json" }
  });
  if (!resp.ok) {
    throw new SpiderError(resp.status, "scraper-directory failed (" + resp.status + ")");
  }
  const j = await resp.json();
  return Array.isArray(j?.data) ? j.data : [];
}
function fetchPathFromUrl(input) {
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(input) ? input : "https://" + input);
  } catch {
    throw new SpiderError(0, `invalid URL: ${input}`);
  }
  const domain = u.hostname.replace(/^www\./, "");
  const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
  return { domain, path };
}
async function fetchStructured(cfg, input, opts = {}) {
  const { domain, path } = fetchPathFromUrl(input);
  const body = { ...proxyFields(cfg) };
  if (opts.returnFormat) body.return_format = opts.returnFormat;
  if (opts.limit && opts.limit > 1) body.limit = opts.limit;
  if (opts.readability) body.readability = true;
  const data = await apiPost(cfg, `/fetch/${encodeURIComponent(domain)}${encodeURI(path)}`, body);
  if (!data || typeof data !== "object") throw new SpiderError(0, `/fetch returned no data for ${domain}${path}`);
  return {
    url: String(data.url ?? input),
    content: data.content ?? null,
    status: Number(data.status ?? 0),
    metadata: data.metadata ?? null,
    css_extracted: data.css_extracted ?? null,
    links: Array.isArray(data.links) ? data.links.map(String) : []
  };
}

// spider-leads/src/extract.ts
var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
var BAD_DOMAINS = /* @__PURE__ */ new Set([
  "example.com",
  "example.org",
  "example.net",
  "yourdomain.com",
  "yourdomainhere.com",
  "yoursite.com",
  "domain.com",
  "domainname.com",
  "email.com",
  "test.com",
  "foo.com",
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
  "sentry.wixpress.com",
  "name.com",
  "website.com",
  "mycompany.com",
  "company.com",
  "user.com",
  "yourcompany.com",
  "email.com",
  "mail.com"
]);
var IMAGE_EXT = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "css", "js", "map", "ico", "zip", "pdf", "woff", "woff2", "ttf", "eot"]);
function isValidEmail(email) {
  const e = email.trim().toLowerCase();
  if (e.length < 5 || e.length > 254) return false;
  if ((e.match(/@/g) ?? []).length !== 1) return false;
  const [local, domain] = e.split("@");
  if (!local || !domain || local.length > 64) return false;
  if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
  const dot = domain.lastIndexOf(".");
  if (dot < 1 || dot === domain.length - 1) return false;
  const tld = domain.slice(dot + 1).toLowerCase();
  if (IMAGE_EXT.has(tld)) return false;
  if (BAD_DOMAINS.has(domain)) return false;
  if (/\d{2,}/.test(tld)) return false;
  return true;
}
function extractEmails(text) {
  const out = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase();
    if (isValidEmail(e)) out.add(e);
  }
  return [...out];
}
var PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
function extractPhones(text) {
  const out = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(PHONE_RE)) {
    const p = m[0].trim();
    const digits = p.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) out.add(p);
  }
  return [...out];
}
var LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/g;
function extractLinkedin(text) {
  return [...new Set(text.match(LINKEDIN_RE) ?? [])];
}
var CONTACT_PATH_RE = /\/(?:contact|contacts|team|our-team|meet-the-team|about|about-us|aboutus|staff|people|leadership|leadership-team|founders?|founder-team|board|board-of-directors|management|executive|executives|management-team|careers?|jobs?|directory|employees|who-we-are|impressum|imprint|kontakt|uber-uns)\b/i;
function isContactUrl(url) {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return false;
    return CONTACT_PATH_RE.test(path);
  } catch {
    return false;
  }
}
function filterContactUrls(urls, max) {
  const matched = urls.filter((u) => isContactUrl(u));
  const pool = matched.length > 0 ? matched : urls;
  return [...new Set(pool)].slice(0, max);
}
function toRoot(input) {
  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    return u.protocol + "//" + u.hostname;
  }
  return "https://" + input;
}
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function emailNameHint(email) {
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  const parts = local.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}
var PERSONAL_DOMAINS = /* @__PURE__ */ new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.co.in",
  "outlook.com",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "qq.com",
  "163.com",
  "126.com",
  "foxmail.com",
  "naver.com",
  "daum.net",
  "tutanota.com",
  "hey.com",
  "fastmail.com",
  "web.de",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "libero.it",
  "alice.it",
  "virgilio.it",
  "sina.com",
  "sohu.com",
  "rediffmail.com"
]);
var ROLE_LOCAL_PARTS = /* @__PURE__ */ new Set([
  "info",
  "sales",
  "support",
  "contact",
  "hello",
  "help",
  "admin",
  "office",
  "enquiries",
  "enquiry",
  "inquiries",
  "inquiry",
  "careers",
  "jobs",
  "hr",
  "billing",
  "accounts",
  "marketing",
  "press",
  "media",
  "team",
  "general",
  "mail",
  "email",
  "reception",
  "bookings",
  "reservations",
  "service",
  "partners",
  "feedback",
  "privacy",
  "legal",
  "webmaster",
  "postmaster",
  "abuse",
  "welcome",
  "connect",
  "ask",
  "start",
  "talk",
  "hello",
  "hi"
]);
function isStudentDomain(domain) {
  const lower = domain.toLowerCase();
  if (lower.endsWith(".edu")) return true;
  if (/\.ac\.[a-z]{2}$/.test(lower)) return true;
  if (/\.edu\.[a-z]{2}$/.test(lower)) return true;
  return false;
}
function classifyEmailType(email) {
  const clean = (email ?? "").toLowerCase().trim();
  const at = clean.indexOf("@");
  if (at <= 0 || at === clean.length - 1) return "unknown";
  const local = clean.slice(0, at);
  const domain = clean.slice(at + 1);
  if (isStudentDomain(domain)) return "student";
  const domain2 = domain.split(".").slice(-2).join(".");
  if (PERSONAL_DOMAINS.has(domain) || PERSONAL_DOMAINS.has(domain2)) return "personal";
  if (ROLE_LOCAL_PARTS.has(local)) return "business";
  return "corporate";
}

// spider-leads/src/people.ts
var GITHUB_RE = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?/g;
function extractGithubHandles(text) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(GITHUB_RE)) {
    const org = m[1];
    const user = m[2] ?? null;
    const url = m[0];
    if (seen.has(org + "/" + (user ?? ""))) continue;
    seen.add(org + "/" + (user ?? ""));
    out.push({
      // A link like github.com/org/team or github.com/org (single segment) is an org.
      org: !user || user === "team" || user === "people" ? org : null,
      user,
      url
    });
  }
  return out;
}
function extractGithubOrgs(text) {
  const handles = extractGithubHandles(text);
  const orgs = /* @__PURE__ */ new Set();
  for (const h of handles) {
    if (h.org) orgs.add(h.org);
  }
  return [...orgs];
}
function extractGithubUsers(text) {
  const handles = extractGithubHandles(text);
  const users = /* @__PURE__ */ new Set();
  for (const h of handles) if (h.user) users.add(h.user);
  for (const m of text.matchAll(/(?:^|\s)@([A-Za-z0-9_-]{2,30})(?=\s|$)/g)) {
    if (!/^\d+$/.test(m[1])) users.add(m[1]);
  }
  return [...users];
}
var LINKEDIN_RE2 = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/g;
function extractNamedPeople(markdown) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const lines = markdown.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•·]\s*/, "").trim());
  for (const line of lines) {
    const name = parseNameTitle(line);
    if (!name) continue;
    const key = name.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const linkedin = line.match(LINKEDIN_RE2)?.[0];
    const github = line.match(GITHUB_RE)?.[0];
    out.push({
      name: name.name,
      title: name.title,
      linkedin,
      github,
      source: "page",
      sourceUrl: void 0
      // caller fills the page URL
    });
  }
  return out;
}
function parseNameTitle(line) {
  if (!line || line.length > 140) return null;
  if (/^(https?:|www\.|tel:|mailto:|@|#|\||\*)/i.test(line)) return null;
  if (/\b(privacy|terms|copyright|all rights|menu|home|about us|login|sign)/i.test(line)) return null;
  if (/(\$\d|\b\d{3,4}[-.)]\s?\d{3,4}\b)/.test(line) && !/[—–,-]/.test(line)) return null;
  const parts = line.split(/\s+[—–·|]\s+|\s+-\s+|,\s+|\s+\(|\s+:\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const maybeName = parts[0];
  const rest = parts[1].replace(/\)$/, "").trim();
  const nameParts = maybeName.split(/\s+/).filter(Boolean);
  if (nameParts.length < 2 || nameParts.length > 4) return null;
  for (const p of nameParts) {
    if (!/^[A-Za-zÀ-ÿ'.-]{1,30}$/.test(p)) return null;
  }
  if (nameParts.some((p) => p.length <= 1 && /^[A-Z]$/.test(p))) {
  }
  const name = nameParts.map((p) => /^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p).join(" ");
  const looksLikeEmail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(rest);
  const looksLikePhone = /^\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{0,4}$/.test(rest) && /[\d\s().-]{7,}/.test(rest);
  const title = !looksLikeEmail && !looksLikePhone && rest.length > 0 && rest.length <= 60 ? rest : void 0;
  if (!title && !looksLikeEmail) return null;
  return { name, title };
}
function splitName(fullName) {
  const cleaned = (fullName ?? "").replace(/\b(jr|sr|ii|iii|iv|md|phd|esq)\b\.?$/i, "").replace(/[()]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const bad = words.filter((w) => /[0-9@/]/.test(w) || w.startsWith("@") || w.includes("http"));
  if (bad.length > 0 || words.length < 2) return null;
  const last = words[words.length - 1];
  const first = words[0];
  if (!/^[A-Za-zÀ-ÿ'.-]+$/.test(first) || !/^[A-Za-zÀ-ÿ'.-]+$/.test(last)) return null;
  const middle = words.length > 2 ? words.slice(1, -1).join(" ") : void 0;
  return { first, last, middle };
}
function asciiName(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
}
function dots(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
}
function localPartFor(name, pattern) {
  const parts = splitName(name);
  if (!parts) return null;
  const f = parts.first.toLowerCase();
  const l = parts.last.toLowerCase();
  const fi = f[0];
  const li = l[0];
  switch (pattern) {
    case "first.last":
      return dots(f + " " + l);
    case "first_last":
      return f + "_" + l;
    case "firstlast":
      return f + l;
    case "f.last":
      return fi + "." + l;
    case "flast":
      return fi + l;
    case "firstl":
      return f + li;
    case "f.lastname":
      return fi + "." + l;
    case "last.first":
      return dots(l + " " + f);
    case "first":
      return f;
    default:
      return null;
  }
}
var PATTERN_LABELS = [
  "first.last",
  "first_last",
  "firstlast",
  "f.last",
  "flast",
  "firstl",
  "last.first",
  "first"
];
function patternOf(email, name) {
  const local = email.split("@")[0].toLowerCase();
  for (const p of PATTERN_LABELS) {
    if (localPartFor(name, p) === local) return p;
  }
  return null;
}

// spider-leads/src/ai.ts
var CATEGORIES = [
  "SaaS / Software",
  "Agency / Services",
  "E-commerce / Retail",
  "Consulting",
  "Manufacturing / Industrial",
  "Finance / Insurance",
  "Healthcare",
  "Education / Training",
  "Real Estate / Construction",
  "Media / Publishing",
  "Hospitality / Travel",
  "Nonprofit / Government",
  "Other"
];
function hasAiKey(cfg) {
  return cfg.openaiApiKey.length > 0;
}
async function chatJson(cfg, system, user, maxTokens = 1200) {
  return chatJsonOnce(cfg, system, user, maxTokens, true).catch(async (err) => {
    if (/\b400\b/.test(err.message) && !/\b401\b/.test(err.message)) {
      return chatJsonOnce(cfg, system, user, maxTokens, false);
    }
    throw err;
  });
}
async function chatJsonOnce(cfg, system, user, maxTokens, useJsonMode) {
  const payload = {
    model: cfg.openaiModel,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (useJsonMode) payload.response_format = { type: "json_object" };
  const resp = await fetch(cfg.openaiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.openaiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`AI request failed (${resp.status}): ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  return content;
}
function tryParseArgs(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
      }
    }
    return {};
  }
}
async function chatWithTools(cfg, messages, tools) {
  const payload = {
    model: cfg.openaiModel,
    temperature: 0,
    max_tokens: 4e3,
    messages
  };
  if (tools.length > 0) payload.tools = tools;
  const resp = await fetch(cfg.openaiBaseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.openaiApiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error("AI tool call failed (" + resp.status + "): " + body.slice(0, 300));
  }
  const data = await resp.json();
  const message = data?.choices?.[0]?.message ?? {};
  const content = typeof message.content === "string" ? message.content : "";
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.map((tc) => ({
    id: String(tc.id ?? "call_" + Math.random().toString(36).slice(2)),
    name: String(tc?.function?.name ?? ""),
    args: tryParseArgs(String(tc?.function?.arguments ?? "{}"))
  })).filter((tc) => tc.name.length > 0);
  return { content, toolCalls };
}
function parseJsonObject(text) {
  const cleaned = text.replace(/^\s*\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
    }
  }
  throw new Error("AI returned no parseable JSON: " + text.slice(0, 200));
}
var EXTRA_CATEGORY_RULES = [];
var EXTRA_INTEREST_RULES = [];
var registeredRuleSets = /* @__PURE__ */ new Set();
function registerRuleSets(pluginId, rules) {
  if (!rules) return;
  if (registeredRuleSets.has(pluginId)) return;
  registeredRuleSets.add(pluginId);
  for (const r of rules.categories ?? []) {
    try {
      EXTRA_CATEGORY_RULES.push({ match: new RegExp(r.match, "i"), label: r.category });
    } catch {
    }
  }
  for (const r of rules.interests ?? []) {
    try {
      EXTRA_INTEREST_RULES.push({ match: new RegExp(r.match, "i"), label: r.topic });
    } catch {
    }
  }
}
var RULE_CATEGORIES = [
  [/\b(shopify|woocommerce|etsy|amazon|e-commerce|ecommerce|store|products?|cart)\b/i, "E-commerce / Retail", "storefront language"],
  [/\b(saas|software|cloud|platform|api|developer|app |app$|technology|tech |ai |machine learning|data)\b/i, "SaaS / Software", "technology language"],
  [/\b(agency|studio|marketing|design|creative|consultancy|consulting|services)\b/i, "Agency / Services", "agency language"],
  [/\b(manufactur|industrial|factory|logistics|supply chain|wholesale|distribut)\b/i, "Manufacturing / Industrial", "industrial language"],
  [/\b(bank|fintech|insurance|invest|capital|finance|financial|payments?|credit)\b/i, "Finance / Insurance", "finance language"],
  [/\b(hospital|clinic|medical|health|care|wellness|dental|pharma)\b/i, "Healthcare", "healthcare language"],
  [/\b(school|university|college|academy|training|education|learn|course|tutoring)\b/i, "Education / Training", "education language"],
  [/\b(real estate|property|construction|building|architecture|interior|realtor|housing)\b/i, "Real Estate / Construction", "real estate language"],
  [/\b(news|media|publish|magazine|blog|podcast|youtube|journal)\b/i, "Media / Publishing", "media language"],
  [/\b(hotel|travel|tourism|restaurant|hospitality|resort|cafe|food)\b/i, "Hospitality / Travel", "hospitality language"],
  [/\b(nonprofit|non-profit|foundation|charity|ngo|organization|ministry|church)\b/i, "Nonprofit / Government", "nonprofit language"]
];
var INTEREST_RULES = [
  [/\b(ai|artificial intelligence|machine learning|llm|gpt|neural|deep learning|agent)\b/i, "AI / Machine Learning"],
  [/\b(cloud|aws|azure|gcp|kubernetes|devops|infrastructure|serverless)\b/i, "Cloud / DevOps"],
  [/\b(fintech|payments?|banking|investing|blockchain|crypto|web3|defi)\b/i, "Fintech / Web3"],
  [/\b(ecommerce|e-commerce|shopify|dropshipping|retail|marketplace|online store)\b/i, "E-commerce"],
  [/\b(cybersecurity|security|privacy|compliance|gdpr|ransomware)\b/i, "Security / Privacy"],
  [/\b(sustainability|esg|green|renewable|climate|carbon|clean energy)\b/i, "Sustainability / ESG"],
  [/\b(healthcare|health|medical|wellness|biotech|pharma|clinic|hospital)\b/i, "Healthcare / Biotech"],
  [/\b(education|elearning|edtech|online course|university|training|academy)\b/i, "Education / EdTech"],
  [/\b(real estate|property|proptech|construction|housing|realtor)\b/i, "Real Estate / PropTech"],
  [/\b(marketing|seo|content|social media|growth|brand|advertising)\b/i, "Marketing / Growth"],
  [/\b(gaming|esports|metaverse|vr|ar|game studio)\b/i, "Gaming / XR"],
  [/\b(sales|b2b|lead generation|crm|outbound|revenue)\b/i, "Sales / CRM"],
  [/\b(data|analytics|big data|database|business intelligence|dashboard)\b/i, "Data / Analytics"],
  [/\b(automotive|ev|electric vehicle|mobility|charging)\b/i, "Automotive / Mobility"],
  [/\b(logistics|supply chain|shipping|fulfillment|freight|warehouse)\b/i, "Logistics / Supply Chain"],
  [/\b(food|restaurant|hospitality|travel|tourism|hotel)\b/i, "Food / Travel"],
  [/\b(energy|oil|gas|solar|power|utilities|grid)\b/i, "Energy"],
  [/\b(legal|law|attorney|lawyer|litigation)\b/i, "Legal"],
  [/\b(recruiting|hiring|talent|hr|people ops|headhunting)\b/i, "HR / Talent"],
  [/\b(manufactur|industrial|factory|supply chain|logistics)\b/i, "Manufacturing / Industrial"],
  [/\b(saas|software|api|developer|platform|startup|product)\b/i, "SaaS / Startups"]
];
function extractInterestsByRules(texts) {
  const haystack = texts.join(" ").slice(0, 2e4).toLowerCase();
  const out = [];
  for (const [re, topic] of INTEREST_RULES) {
    const hits = (haystack.match(re) ?? []).length;
    if (hits > 0) {
      out.push({ topic, confidence: Math.min(0.4 + hits * 0.12, 0.85) });
    }
  }
  for (const rule of EXTRA_INTEREST_RULES) {
    const hits = (haystack.match(rule.match) ?? []).length;
    if (hits > 0) {
      out.push({ topic: rule.label, confidence: Math.min(0.5 + hits * 0.1, 0.8) });
    }
  }
  return out.sort((x, y) => y.confidence - x.confidence).slice(0, 8);
}
function categorizeByRules(texts) {
  const haystack = texts.join(" ").slice(0, 2e4);
  let best = null;
  for (const [re, cat, why] of RULE_CATEGORIES) {
    const hits = (haystack.match(re) ?? []).length;
    if (hits > 0 && (!best || hits > best[2])) best = [cat, why, hits];
  }
  for (const rule of EXTRA_CATEGORY_RULES) {
    const hits = (haystack.match(rule.match) ?? []).length;
    if (hits > 0 && (!best || hits > best[2])) best = [rule.label, "plugin rule", hits];
  }
  const base = best ? {
    category: best[0],
    subcategory: best[1],
    tier: "Unknown",
    confidence: Math.min(0.5 + best[2] * 0.08, 0.85),
    reason: `keyword match (${best[1]})`
  } : { category: "Other", subcategory: "", tier: "Unknown", confidence: 0.3, reason: "no strong signal" };
  return { ...base, method: "rules", interests: extractInterestsByRules(texts), relations: extractRelationsByRules(texts) };
}
var RELATION_SIGNALS = [
  [/\b(trusted by|customers include|clients include|our clients|case stud(?:y|ies)|working with|serves)\b/i, "Client"],
  [/\b(partner(?:s|ship)?(?:s with| of|ed with| with)?|integration with|integrations? with|collaborat(?:e|ion) with|alliance)\b/i, "Partner"],
  [/\b(powered by|built on|runs on|provided by|technology from)\b/i, "Supplier"],
  [/\b(competitor|competes with|alternative to|vs\.?|versus)\b/i, "Competitor"],
  [/\b(subsidiary of|a (?:subsidiary|division|company) of|part of the .+ group)\b/i, "Subsidiary"],
  [/\b(acquired by|acquisition of)\b/i, "Parent"],
  [/\b(invest(?:ed|or)? (?:in|by)|backed by)\b/i, "Investor"]
];
var NON_COMPANY_WORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "our",
  "their",
  "we",
  "us",
  "they",
  "with",
  "of",
  "to",
  "for",
  "in",
  "on",
  "by",
  "at",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "or",
  "but",
  "powered",
  "trusted",
  "built",
  "provided",
  "include",
  "includes",
  "including",
  "solutions",
  "platform",
  "technology",
  "technologies",
  "software",
  "company",
  "companies",
  "team"
]);
function extractRelationsByRules(texts) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const haystack = texts.join("\n").slice(0, 3e4);
  const sentences = haystack.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 10);
  for (const sentence of sentences) {
    for (const [re, type] of RELATION_SIGNALS) {
      const m = sentence.match(re);
      if (!m) continue;
      const idx = m.index ?? 0;
      const after = sentence.slice(idx + m[0].length);
      const before = sentence.slice(Math.max(0, idx - 80), idx);
      const candidate = findCompanyName(after) ?? findCompanyName(before);
      if (!candidate) continue;
      const key = type + ":" + candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type,
        target: candidate,
        evidence: sentence.slice(0, 200),
        confidence: 0.45
      });
      break;
    }
  }
  return out.slice(0, 12);
}
function findCompanyName(text) {
  const m = text.match(/(?:^|[\s,–—-])([A-Z][A-Za-z0-9&'’.-]+(?:[\s]+[A-Z][A-Za-z0-9&'’.-]+){0,2})/);
  if (!m) return null;
  const words = m[1].split(/\s+/);
  if (words.some((w) => NON_COMPANY_WORDS.has(w.toLowerCase()))) return null;
  if (/^(Inc|LLC|Ltd|Corp|Co|Group|GmbH|AG|The)$/.test(words[words.length - 1]) && words.length === 1) return null;
  return words.join(" ");
}
async function categorizeDomain(cfg, domain, pages) {
  const texts = pages.map((p) => p.markdown.slice(0, 4e3));
  if (!hasAiKey(cfg)) {
    log.debug(`categorizing ${domain} with rules (no OPENAI_API_KEY)`);
    return categorizeByRules(texts);
  }
  try {
    const snippet = texts.join("\n\n---\n\n").slice(0, 2e4);
    const system = "You classify businesses for B2B lead generation. Return ONLY JSON with keys: category (one of: " + CATEGORIES.join(", ") + '), subcategory (short, e.g. "B2B marketing agency"), tier (SMB | Mid-market | Enterprise | Unknown), confidence (0-1), reason (one sentence), interests (array of 3-6 objects {topic, confidence} \u2014 topics this company or its audience cares about, e.g. "AI / Machine Learning", "Sustainability", "Developer Tools"), relations (array of objects {type, target, targetDomain, evidence, confidence} \u2014 company relationships visible on the site: Partner, Client, Supplier, Competitor, Subsidiary, Parent, Investor, Other. Include only relationships stated on the page, e.g. "trusted by Acme", "powers deployments for Globex", "in partnership with Initech". Use targetDomain when the site is named, and a short evidence snippet).';
    const user = `Classify this company. Domain: ${domain}

Website content:

${snippet}`;
    const json = parseJsonObject(await chatJson(cfg, system, user));
    const cat = String(json.category ?? "Other");
    const rawInterests = Array.isArray(json.interests) ? json.interests : [];
    const interests = rawInterests.map((i) => ({
      topic: String(i?.topic ?? "").trim(),
      confidence: Math.min(Math.max(Number(i?.confidence) || 0.5, 0), 1)
    })).filter((i) => i.topic.length > 0).slice(0, 8);
    const rawRelations = Array.isArray(json.relations) ? json.relations : [];
    const relations = rawRelations.map((r) => ({
      type: String(r?.type ?? "Other"),
      target: String(r?.target ?? "").trim(),
      targetDomain: r?.targetDomain ? String(r.targetDomain).replace(/^https?:\/\//, "").replace(/\/$/, "") : void 0,
      evidence: r?.evidence ? String(r.evidence).slice(0, 200) : void 0,
      confidence: Math.min(Math.max(Number(r?.confidence) || 0.5, 0), 1)
    })).filter((r) => r.target.length > 1).slice(0, 12);
    return {
      category: CATEGORIES.includes(cat) ? cat : "Other",
      subcategory: String(json.subcategory ?? ""),
      tier: String(json.tier ?? "Unknown"),
      confidence: Math.min(Math.max(Number(json.confidence) || 0.5, 0), 1),
      reason: String(json.reason ?? ""),
      method: "ai",
      interests: interests.length > 0 ? interests : extractInterestsByRules(texts),
      relations: relations.length > 0 ? relations : extractRelationsByRules(texts)
    };
  } catch (err) {
    log.warn(`AI categorization failed for ${domain}: ${err.message} \u2014 using rules`);
    return categorizeByRules(texts);
  }
}
function parseContactsLocal(pages) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const page of pages) {
    const emails = extractEmails(page.markdown);
    const phones = extractPhones(page.markdown);
    const linkedin = extractLinkedin(page.markdown);
    for (const email of emails) {
      const key = email;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        email,
        person_name: emailNameHint(email) ?? void 0,
        linkedin: linkedin[0],
        phone: phones[0]
      });
    }
    if (emails.length === 0) {
      for (const phone of phones.slice(0, 2)) {
        const key = "p:" + phone;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ phone, person_name: void 0 });
      }
    }
    for (const person of extractNamedPeople(page.markdown)) {
      const key = "n:" + person.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        person_name: person.name,
        title: person.title,
        linkedin: person.linkedin,
        github: void 0
      });
    }
  }
  return out;
}
async function parseContacts(cfg, pages, company) {
  const textPages = pages.filter((p) => p.markdown.trim().length > 0);
  if (!hasAiKey(cfg) || textPages.length === 0) {
    return parseContactsLocal(textPages.length > 0 ? textPages : pages);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const CHUNK_CHARS = 35e3;
  let chunk = [];
  let chunkSize = 0;
  const flush = async () => {
    if (chunk.length === 0) return;
    try {
      const snippet = chunk.map((p) => `URL: ${p.url}
${p.markdown.slice(0, 6e3)}`).join("\n\n----\n\n").slice(0, CHUNK_CHARS);
      const system = 'You extract business contact information from website pages for B2B lead generation. Return ONLY a JSON object: {"contacts": [{"email": "\u2026", "person_name": "\u2026", "title": "\u2026", "phone": "\u2026", "linkedin": "\u2026"}]}. Include only real contact records that appear in the text. Include team members even when no email is published (set email to null \u2014 the name, title and LinkedIn are what matter). Email must look like a real address (reject image filenames, placeholder domains, @example.com etc.). Use null for unknown fields.';
      const user = `Company: ${company}

Pages:

${snippet}`;
      const json = parseJsonObject(await chatJson(cfg, system, user, 2e3));
      const contacts = Array.isArray(json.contacts) ? json.contacts : [];
      for (const c2 of contacts) {
        const rec = {
          email: typeof c2.email === "string" && c2.email ? c2.email.toLowerCase() : void 0,
          person_name: typeof c2.person_name === "string" ? c2.person_name : void 0,
          title: typeof c2.title === "string" ? c2.title : void 0,
          phone: typeof c2.phone === "string" ? c2.phone : void 0,
          linkedin: typeof c2.linkedin === "string" ? c2.linkedin : void 0,
          github: typeof c2.github === "string" ? c2.github : void 0
        };
        const key = rec.email ?? `p:${rec.phone ?? rec.person_name ?? Math.random()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
    } catch (err) {
      log.warn(`AI contact parsing failed: ${err.message} \u2014 falling back to regex for this chunk`);
      for (const rec of parseContactsLocal(chunk)) {
        const key = rec.email ?? `p:${rec.phone ?? Math.random()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rec);
      }
    }
    chunk = [];
    chunkSize = 0;
  };
  for (const page of textPages) {
    chunk.push(page);
    chunkSize += page.markdown.length;
    if (chunkSize >= CHUNK_CHARS) await flush();
  }
  await flush();
  return out;
}

// spider-leads/src/leadscore.ts
var EXEC_KEYWORDS = /\b(ceo|cto|coo|cfo|cmo|cio|cro|founder|co-founder|cofounder|owner|principal|partner|president|chairman|chair|managing director|md|vp|vice president|evp|svp|chief)\b/i;
var HEAD_KEYWORDS = /\b(head|lead)\b\s+(of|\s)|head\s+of|head of|team lead|lead engineer|lead designer|lead developer|lead recruiter|lead\b\s+(sales|marketing|product|engineering|design|recruiting|talent|people|success|support|operations|finance|growth|business)/i;
var DIRECTOR_KEYWORDS = /\b(director|board member|trustee|regional manager|gm)\b/i;
var MANAGER_KEYWORDS = /\b(manager|supervisor|coordinator|lead team|team manager)\b/i;
var SALES_KEYWORDS = /\b(sales|account executive|ae\b|sdr|bdr|business development|account manager|growth|partnerships|revenue|inside sales|sales development|customer success|success manager|renewals|closer|quota)\b/i;
var ENGINEERING_KEYWORDS = /\b(engineer(?:ing)?|developer|software|devops|sre|platform|architect|backend|frontend|full[- ]?stack|data engineer|ml|machine learning|ai|infrastructure|qa)\b/i;
var MARKETING_KEYWORDS = /\b(marketing|seo|content|campaign|brand|growth|social media|digital|creat(?:ive|ion)?|copywriter|pr|communications|community|demand gen|performance)\b/i;
var PRODUCT_KEYWORDS = /\b(product|pm\b|ux|ui|designer|design|researcher|project manager|program manager)\b/i;
var FINANCE_KEYWORDS = /\b(finance|accountant|accounting|controller|treasurer|analyst|budget|bookkeeper)\b/i;
var HR_KEYWORDS = /\b(hr|human resources|people ops|talent|recruiter|recruiting|people partner|headcount|onboarding|training)\b/i;
var LEGAL_KEYWORDS = /\b(legal|counsel|attorney|lawyer|compliance|paralegal)\b/i;
var OPERATIONS_KEYWORDS = /\b(operations|ops\b|office manager|admin|administrator|support|success|logistics|procurement|facilities|front desk|reception)\b/i;
function classifyTitle(title) {
  const t = (title ?? "").trim();
  const lower = t.toLowerCase();
  if (!t) return { department: "other", seniority: "unknown", decisionMaker: false };
  let seniority = "unknown";
  if (EXEC_KEYWORDS.test(t)) seniority = "exec";
  else if (HEAD_KEYWORDS.test(t)) seniority = "head";
  else if (DIRECTOR_KEYWORDS.test(t)) seniority = "director";
  else if (MANAGER_KEYWORDS.test(t)) seniority = "manager";
  else if (/\b(engineer|developer|designer|analyst|associate|specialist|coordinator|representative|writer|researcher|recruiter|consultant|advisor|architect|scientist)\b/i.test(t)) seniority = "ic";
  else seniority = "unknown";
  const deptHits = [
    [ENGINEERING_KEYWORDS, "engineering"],
    [MARKETING_KEYWORDS, "marketing"],
    [SALES_KEYWORDS, "sales"],
    [PRODUCT_KEYWORDS, "product"],
    [FINANCE_KEYWORDS, "finance"],
    [HR_KEYWORDS, "hr"],
    [LEGAL_KEYWORDS, "legal"],
    [OPERATIONS_KEYWORDS, "operations"]
  ];
  let bestDept = "other";
  let bestHits = 0;
  for (const [re, dept] of deptHits) {
    const hits = (lower.match(re) ?? []).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestDept = dept;
    }
  }
  const department = bestDept;
  const decisionMaker = seniority === "exec" || seniority === "head" || seniority === "director" || /\b(owner|founder|ceo|cto|coo|cfo|president|vp|chief|director|head of|partner)\b/i.test(t) || /\b(purchasing|procurement|decision|buyer)\b/i.test(t) || seniority === "manager" && /\b(sales|business development|growth)\b/i.test(t);
  return { department, seniority, decisionMaker };
}
function seniorityWeight(s) {
  switch (s) {
    case "exec":
      return 1;
    case "head":
      return 0.92;
    case "director":
      return 0.86;
    case "manager":
      return 0.78;
    case "ic":
      return 0.66;
    default:
      return 0.6;
  }
}
function tierWeight(tier) {
  const t = (tier ?? "").toLowerCase();
  if (t.includes("enterprise")) return 1;
  if (t.includes("mid")) return 0.9;
  if (t.includes("smb") || t.includes("small")) return 0.8;
  return 0.72;
}
function scoreLead(input) {
  let emailFactor;
  if (input.emailValid === 0) {
    return { score: 0, grade: "D" };
  } else if (input.emailSource === "guessed" && typeof input.emailScore === "number") {
    emailFactor = 0.55 + 0.45 * Math.min(1, Math.max(0, input.emailScore));
  } else if (input.emailSource === "github") {
    emailFactor = 0.95;
  } else if (input.emailSource === "page") {
    emailFactor = input.emailValid === 1 ? 1 : 0.75;
  } else {
    emailFactor = input.emailValid === 1 ? 0.9 : 0.7;
  }
  const cls = classifyTitle(input.title);
  const sr = seniorityWeight(cls.seniority);
  const tw = tierWeight(input.companyTier);
  const conf = Math.min(1, Math.max(0, input.companyConfidence ?? 0.5));
  let score = 100 * emailFactor * (0.55 + 0.45 * sr) * (0.7 + 0.3 * tw) * (0.92 + 0.08 * conf);
  if (input.icpMatch === true) score += 12;
  else if (input.icpMatch === false) score -= 10;
  score = Math.round(Math.min(100, Math.max(0, score)));
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";
  return { score, grade };
}
function gradeLabel(grade) {
  switch (grade) {
    case "A":
      return "Hot";
    case "B":
      return "Warm";
    case "C":
      return "Cool";
    default:
      return "Cold";
  }
}
function icpMatch(category, interests, icpCategories, icpInterests) {
  if (icpCategories.length === 0 && icpInterests.length === 0) return null;
  const cat = (category ?? "").toLowerCase();
  if (icpCategories.length > 0 && icpCategories.some((c2) => cat.includes(c2.toLowerCase()))) return true;
  if (icpCategories.length > 0 && cat) return false;
  if (icpInterests.length > 0) {
    const hay = interests.join(" ").toLowerCase();
    return icpInterests.some((t) => hay.includes(t.toLowerCase()));
  }
  return false;
}

// spider-leads/src/plunk.ts
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
async function verifyEmail(cfg, email) {
  if (!cfg.plunkApiKey) throw new Error("PLUNK_API_KEY is not set");
  const resp = await fetch(cfg.plunkApiBase.replace(/\/$/, "") + "/v1/verify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.plunkApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email })
  });
  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get("retry-after") ?? 2);
    log.debug(`plunk 429 \u2014 waiting ${retryAfter}s`);
    await sleep2(retryAfter * 1e3);
    return verifyEmail(cfg, email);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
    } catch {
    }
    throw new Error(`Plunk verify failed (${resp.status}): ${msg}`);
  }
  const body = await resp.json();
  const d = body?.data ?? {};
  return {
    valid: d.valid !== false,
    isDisposable: d.isDisposable === true,
    isAlias: d.isAlias === true,
    isTypo: d.isTypo === true,
    isPlusAddressed: d.isPlusAddressed === true,
    isPersonalEmail: d.isPersonalEmail === true,
    domainExists: d.domainExists === true,
    hasWebsite: d.hasWebsite === true,
    hasMxRecords: d.hasMxRecords === true,
    reasons: Array.isArray(d.reasons) ? d.reasons : [],
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function verifyBatch(cfg, emails, opts = {}) {
  const concurrency = opts.concurrency ?? 5;
  let cursor = 0;
  const worker = async () => {
    while (cursor < emails.length) {
      const email = emails[cursor++];
      try {
        const res = await verifyEmail(cfg, email);
        await opts.onResult?.(email, res);
      } catch (err) {
        await opts.onResult?.(email, null, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(emails.length, 1)) }, worker));
}

// node_modules/@libsql/core/lib-esm/api.js
var LibsqlError = class extends Error {
  /** Machine-readable error code. */
  code;
  /** Extended error code with more specific information (e.g., SQLITE_CONSTRAINT_PRIMARYKEY). */
  extendedCode;
  /** Raw numeric error code */
  rawCode;
  constructor(message, code, extendedCode, rawCode, cause) {
    if (code !== void 0) {
      message = `${code}: ${message}`;
    }
    super(message, { cause });
    this.code = code;
    this.extendedCode = extendedCode;
    this.rawCode = rawCode;
    this.name = "LibsqlError";
  }
};
var LibsqlBatchError = class extends LibsqlError {
  /** The zero-based index of the statement that failed in the batch. */
  statementIndex;
  constructor(message, statementIndex, code, extendedCode, rawCode, cause) {
    super(message, code, extendedCode, rawCode, cause);
    this.statementIndex = statementIndex;
    this.name = "LibsqlBatchError";
  }
};

// node_modules/@libsql/core/lib-esm/uri.js
function parseUri(text) {
  const match = URI_RE.exec(text);
  if (match === null) {
    throw new LibsqlError(`The URL '${text}' is not in a valid format`, "URL_INVALID");
  }
  const groups = match.groups;
  const scheme = groups["scheme"];
  const authority = groups["authority"] !== void 0 ? parseAuthority(groups["authority"]) : void 0;
  const path = percentDecode(groups["path"]);
  const query = groups["query"] !== void 0 ? parseQuery(groups["query"]) : void 0;
  const fragment = groups["fragment"] !== void 0 ? percentDecode(groups["fragment"]) : void 0;
  return { scheme, authority, path, query, fragment };
}
var URI_RE = (() => {
  const SCHEME = "(?<scheme>[A-Za-z][A-Za-z.+-]*)";
  const AUTHORITY = "(?<authority>[^/?#]*)";
  const PATH = "(?<path>[^?#]*)";
  const QUERY = "(?<query>[^#]*)";
  const FRAGMENT = "(?<fragment>.*)";
  return new RegExp(`^${SCHEME}:(//${AUTHORITY})?${PATH}(\\?${QUERY})?(#${FRAGMENT})?$`, "su");
})();
function parseAuthority(text) {
  const match = AUTHORITY_RE.exec(text);
  if (match === null) {
    throw new LibsqlError("The authority part of the URL is not in a valid format", "URL_INVALID");
  }
  const groups = match.groups;
  const host = percentDecode(groups["host_br"] ?? groups["host"]);
  const port = groups["port"] ? parseInt(groups["port"], 10) : void 0;
  const userinfo = groups["username"] !== void 0 ? {
    username: percentDecode(groups["username"]),
    password: groups["password"] !== void 0 ? percentDecode(groups["password"]) : void 0
  } : void 0;
  return { host, port, userinfo };
}
var AUTHORITY_RE = (() => {
  return new RegExp(`^((?<username>[^:]*)(:(?<password>.*))?@)?((?<host>[^:\\[\\]]*)|(\\[(?<host_br>[^\\[\\]]*)\\]))(:(?<port>[0-9]*))?$`, "su");
})();
function parseQuery(text) {
  const sequences = text.split("&");
  const pairs = [];
  for (const sequence of sequences) {
    if (sequence === "") {
      continue;
    }
    let key;
    let value;
    const splitIdx = sequence.indexOf("=");
    if (splitIdx < 0) {
      key = sequence;
      value = "";
    } else {
      key = sequence.substring(0, splitIdx);
      value = sequence.substring(splitIdx + 1);
    }
    pairs.push({
      key: percentDecode(key.replaceAll("+", " ")),
      value: percentDecode(value.replaceAll("+", " "))
    });
  }
  return { pairs };
}
function percentDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch (e) {
    if (e instanceof URIError) {
      throw new LibsqlError(`URL component has invalid percent encoding: ${e}`, "URL_INVALID", void 0, void 0, e);
    }
    throw e;
  }
}
function encodeBaseUrl(scheme, authority, path) {
  if (authority === void 0) {
    throw new LibsqlError(`URL with scheme ${JSON.stringify(scheme + ":")} requires authority (the "//" part)`, "URL_INVALID");
  }
  const schemeText = `${scheme}:`;
  const hostText = encodeHost(authority.host);
  const portText = encodePort(authority.port);
  const userinfoText = encodeUserinfo(authority.userinfo);
  const authorityText = `//${userinfoText}${hostText}${portText}`;
  let pathText = path.split("/").map(encodeURIComponent).join("/");
  if (pathText !== "" && !pathText.startsWith("/")) {
    pathText = "/" + pathText;
  }
  return new URL(`${schemeText}${authorityText}${pathText}`);
}
function encodeHost(host) {
  return host.includes(":") ? `[${encodeURI(host)}]` : encodeURI(host);
}
function encodePort(port) {
  return port !== void 0 ? `:${port}` : "";
}
function encodeUserinfo(userinfo) {
  if (userinfo === void 0) {
    return "";
  }
  const usernameText = encodeURIComponent(userinfo.username);
  const passwordText = userinfo.password !== void 0 ? `:${encodeURIComponent(userinfo.password)}` : "";
  return `${usernameText}${passwordText}@`;
}

// node_modules/js-base64/base64.mjs
var version = "3.9.3";
var VERSION = version;
var _TD = typeof TextDecoder === "function" ? new TextDecoder("utf-8", { ignoreBOM: true }) : void 0;
var _TE = typeof TextEncoder === "function" ? new TextEncoder() : void 0;
var b64ch = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
var b64chs = Array.prototype.slice.call(b64ch);
var b64tab = ((a) => {
  let tab = {};
  a.forEach((c2, i) => tab[c2] = i);
  return tab;
})(b64chs);
var b64re = /^(?:[A-Za-z\d+\/]{4})*?(?:[A-Za-z\d+\/]{2}(?:==)?|[A-Za-z\d+\/]{3}=?)?$/;
var _fromCC = String.fromCharCode.bind(String);
var _U8Afrom = typeof Uint8Array.from === "function" ? Uint8Array.from.bind(Uint8Array) : (it) => new Uint8Array(Array.prototype.slice.call(it, 0));
var _mkUriSafe = (src) => src.replace(/=/g, "").replace(/[+\/]/g, (m0) => m0 == "+" ? "-" : "_");
var _tidyB64 = (s) => s.replace(/[^A-Za-z0-9\+\/]/g, "");
var btoaPolyfill = (bin) => {
  let u32, c0, c1, c2, asc = "";
  const pad = bin.length % 3;
  for (let i = 0; i < bin.length; ) {
    if ((c0 = bin.charCodeAt(i++)) > 255 || (c1 = bin.charCodeAt(i++)) > 255 || (c2 = bin.charCodeAt(i++)) > 255)
      throw new TypeError("invalid character found");
    u32 = c0 << 16 | c1 << 8 | c2;
    asc += b64chs[u32 >> 18 & 63] + b64chs[u32 >> 12 & 63] + b64chs[u32 >> 6 & 63] + b64chs[u32 & 63];
  }
  return pad ? asc.slice(0, pad - 3) + "===".substring(pad) : asc;
};
var _btoa = typeof btoa === "function" ? (bin) => btoa(bin) : btoaPolyfill;
var _fromUint8Array = typeof Uint8Array.prototype.toBase64 === "function" ? (u8a) => u8a.toBase64() : (u8a) => {
  const maxargs = 4096;
  let strs = [];
  for (let i = 0, l = u8a.length; i < l; i += maxargs) {
    strs.push(_fromCC.apply(null, u8a.subarray(i, i + maxargs)));
  }
  return _btoa(strs.join(""));
};
var fromUint8Array = (u8a, urlsafe = false) => urlsafe ? _mkUriSafe(_fromUint8Array(u8a)) : _fromUint8Array(u8a);
var cb_utob = (c2) => {
  if (c2.length < 2) {
    var cc = c2.charCodeAt(0);
    return cc < 128 ? c2 : cc < 2048 ? _fromCC(192 | cc >>> 6) + _fromCC(128 | cc & 63) : _fromCC(224 | cc >>> 12 & 15) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
  } else {
    var cc = 65536 + (c2.charCodeAt(0) - 55296) * 1024 + (c2.charCodeAt(1) - 56320);
    return _fromCC(240 | cc >>> 18 & 7) + _fromCC(128 | cc >>> 12 & 63) + _fromCC(128 | cc >>> 6 & 63) + _fromCC(128 | cc & 63);
  }
};
var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\x00-\x7F]/g;
var utob = (u) => u.replace(re_utob, cb_utob);
var _encode = _TE ? (s) => _fromUint8Array(_TE.encode(s)) : (s) => _btoa(utob(s));
var encode = (src, urlsafe = false) => urlsafe ? _mkUriSafe(_encode(src)) : _encode(src);
var encodeURI2 = (src) => encode(src, true);
var re_btou = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}|[\xF0-\xF7][\x80-\xBF]{3}/g;
var cb_btou = (cccc) => {
  switch (cccc.length) {
    case 4:
      var cp = (7 & cccc.charCodeAt(0)) << 18 | (63 & cccc.charCodeAt(1)) << 12 | (63 & cccc.charCodeAt(2)) << 6 | 63 & cccc.charCodeAt(3), offset = cp - 65536;
      return _fromCC((offset >>> 10) + 55296) + _fromCC((offset & 1023) + 56320);
    case 3:
      return _fromCC((15 & cccc.charCodeAt(0)) << 12 | (63 & cccc.charCodeAt(1)) << 6 | 63 & cccc.charCodeAt(2));
    default:
      return _fromCC((31 & cccc.charCodeAt(0)) << 6 | 63 & cccc.charCodeAt(1));
  }
};
var btou = (b) => b.replace(re_btou, cb_btou);
var atobPolyfill = (asc) => {
  asc = asc.replace(/\s+/g, "");
  if (!b64re.test(asc))
    throw new TypeError("malformed base64.");
  asc += "==".slice(2 - (asc.length & 3));
  let u24, r1, r2;
  let binArray = [];
  for (let i = 0; i < asc.length; ) {
    u24 = b64tab[asc.charAt(i++)] << 18 | b64tab[asc.charAt(i++)] << 12 | (r1 = b64tab[asc.charAt(i++)]) << 6 | (r2 = b64tab[asc.charAt(i++)]);
    if (r1 === 64) {
      binArray.push(_fromCC(u24 >> 16 & 255));
    } else if (r2 === 64) {
      binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255));
    } else {
      binArray.push(_fromCC(u24 >> 16 & 255, u24 >> 8 & 255, u24 & 255));
    }
  }
  return binArray.join("");
};
var _atob = typeof atob === "function" ? (asc) => atob(_tidyB64(asc)) : atobPolyfill;
var _toUint8Array = typeof Uint8Array.fromBase64 === "function" ? (a) => Uint8Array.fromBase64(a) : (a) => _U8Afrom(_atob(a).split("").map((c2) => c2.charCodeAt(0)));
var toUint8Array = (a) => _toUint8Array(_unURI(a));
var _decode = _TD ? (a) => _TD.decode(_toUint8Array(a)) : (a) => btou(_atob(a));
var _unURI = (a) => _tidyB64(a.replace(/[-_]/g, (m0) => m0 == "-" ? "+" : "/"));
var decode = (src) => _decode(_unURI(src));
var isValid = (src) => {
  if (typeof src !== "string")
    return false;
  const s = src.replace(/\s+/g, "").replace(/={0,2}$/, "");
  return !/[^\s0-9a-zA-Z\+/]/.test(s) || !/[^\s0-9a-zA-Z\-_]/.test(s);
};
var _noEnum = (v) => {
  return {
    value: v,
    enumerable: false,
    writable: true,
    configurable: true
  };
};
var extendString = function() {
  const _add = (name, body) => Object.defineProperty(String.prototype, name, _noEnum(body));
  _add("fromBase64", function() {
    return decode(this);
  });
  _add("toBase64", function(urlsafe) {
    return encode(this, urlsafe);
  });
  _add("toBase64URI", function() {
    return encode(this, true);
  });
  _add("toBase64URL", function() {
    return encode(this, true);
  });
  _add("toUint8Array", function() {
    return toUint8Array(this);
  });
};
var extendUint8Array = function() {
  const _add = (name, body) => Object.defineProperty(Uint8Array.prototype, name, _noEnum(body));
  _add("toBase64", function(urlsafe) {
    return fromUint8Array(this, urlsafe);
  });
  _add("toBase64URI", function() {
    return fromUint8Array(this, true);
  });
  _add("toBase64URL", function() {
    return fromUint8Array(this, true);
  });
};
var extendBuiltins = () => {
  extendString();
  extendUint8Array();
};
var gBase64 = {
  version,
  VERSION,
  atob: _atob,
  atobPolyfill,
  btoa: _btoa,
  btoaPolyfill,
  fromBase64: decode,
  toBase64: encode,
  encode,
  encodeURI: encodeURI2,
  encodeURL: encodeURI2,
  utob,
  btou,
  decode,
  isValid,
  fromUint8Array,
  toUint8Array,
  extendString,
  extendUint8Array,
  extendBuiltins
};

// node_modules/@libsql/core/lib-esm/util.js
var supportedUrlLink = "https://github.com/libsql/libsql-client-ts#supported-urls";
function transactionModeToBegin(mode) {
  if (mode === "write") {
    return "BEGIN IMMEDIATE";
  } else if (mode === "read") {
    return "BEGIN TRANSACTION READONLY";
  } else if (mode === "deferred") {
    return "BEGIN DEFERRED";
  } else {
    throw RangeError('Unknown transaction mode, supported values are "write", "read" and "deferred"');
  }
}
var ResultSetImpl = class {
  columns;
  columnTypes;
  rows;
  rowsAffected;
  lastInsertRowid;
  constructor(columns, columnTypes, rows, rowsAffected, lastInsertRowid) {
    this.columns = columns;
    this.columnTypes = columnTypes;
    this.rows = rows;
    this.rowsAffected = rowsAffected;
    this.lastInsertRowid = lastInsertRowid;
  }
  toJSON() {
    return {
      columns: this.columns,
      columnTypes: this.columnTypes,
      rows: this.rows.map(rowToJson),
      rowsAffected: this.rowsAffected,
      lastInsertRowid: this.lastInsertRowid !== void 0 ? "" + this.lastInsertRowid : null
    };
  }
};
function rowToJson(row) {
  return Array.prototype.map.call(row, valueToJson);
}
function valueToJson(value) {
  if (typeof value === "bigint") {
    return "" + value;
  } else if (value instanceof ArrayBuffer) {
    return gBase64.fromUint8Array(new Uint8Array(value));
  } else {
    return value;
  }
}

// node_modules/@libsql/core/lib-esm/config.js
var inMemoryMode = ":memory:";
function expandConfig(config, preferHttp) {
  if (typeof config !== "object") {
    throw new TypeError(`Expected client configuration as object, got ${typeof config}`);
  }
  let { url, authToken, tls, intMode, concurrency } = config;
  concurrency = Math.max(0, concurrency || 20);
  intMode ??= "number";
  let connectionQueryParams = [];
  if (url === inMemoryMode) {
    url = "file::memory:";
  }
  const uri = parseUri(url);
  const originalUriScheme = uri.scheme.toLowerCase();
  const isInMemoryMode = originalUriScheme === "file" && uri.path === inMemoryMode && uri.authority === void 0;
  let queryParamsDef;
  if (isInMemoryMode) {
    queryParamsDef = {
      cache: {
        values: ["shared", "private"],
        update: (key, value) => connectionQueryParams.push(`${key}=${value}`)
      }
    };
  } else {
    queryParamsDef = {
      tls: {
        values: ["0", "1"],
        update: (_, value) => tls = value === "1"
      },
      authToken: {
        update: (_, value) => authToken = value
      }
    };
  }
  for (const { key, value } of uri.query?.pairs ?? []) {
    if (!Object.hasOwn(queryParamsDef, key)) {
      throw new LibsqlError(`Unsupported URL query parameter ${JSON.stringify(key)}`, "URL_PARAM_NOT_SUPPORTED");
    }
    const queryParamDef = queryParamsDef[key];
    if (queryParamDef.values !== void 0 && !queryParamDef.values.includes(value)) {
      throw new LibsqlError(`Unknown value for the "${key}" query argument: ${JSON.stringify(value)}. Supported values are: [${queryParamDef.values.map((x) => '"' + x + '"').join(", ")}]`, "URL_INVALID");
    }
    if (queryParamDef.update !== void 0) {
      queryParamDef?.update(key, value);
    }
  }
  const connectionQueryParamsString = connectionQueryParams.length === 0 ? "" : `?${connectionQueryParams.join("&")}`;
  const path = uri.path + connectionQueryParamsString;
  let scheme;
  if (originalUriScheme === "libsql") {
    if (tls === false) {
      if (uri.authority?.port === void 0) {
        throw new LibsqlError('A "libsql:" URL with ?tls=0 must specify an explicit port', "URL_INVALID");
      }
      scheme = preferHttp ? "http" : "ws";
    } else {
      scheme = preferHttp ? "https" : "wss";
    }
  } else {
    scheme = originalUriScheme;
  }
  if (scheme === "http" || scheme === "ws") {
    tls ??= false;
  } else {
    tls ??= true;
  }
  if (scheme !== "http" && scheme !== "ws" && scheme !== "https" && scheme !== "wss" && scheme !== "file") {
    throw new LibsqlError(`The client supports only "libsql:", "wss:", "ws:", "https:", "http:" and "file:" URLs, got ${JSON.stringify(uri.scheme + ":")}. For more information, please read ${supportedUrlLink}`, "URL_SCHEME_NOT_SUPPORTED");
  }
  if (intMode !== "number" && intMode !== "bigint" && intMode !== "string") {
    throw new TypeError(`Invalid value for intMode, expected "number", "bigint" or "string", got ${JSON.stringify(intMode)}`);
  }
  if (uri.fragment !== void 0) {
    throw new LibsqlError(`URL fragments are not supported: ${JSON.stringify("#" + uri.fragment)}`, "URL_INVALID");
  }
  if (isInMemoryMode) {
    return {
      scheme: "file",
      tls: false,
      path,
      intMode,
      concurrency,
      syncUrl: config.syncUrl,
      syncInterval: config.syncInterval,
      readYourWrites: config.readYourWrites,
      offline: config.offline,
      fetch: config.fetch,
      timeout: config.timeout,
      authToken: void 0,
      encryptionKey: void 0,
      remoteEncryptionKey: void 0,
      authority: void 0
    };
  }
  return {
    scheme,
    tls,
    authority: uri.authority,
    path,
    authToken,
    intMode,
    concurrency,
    encryptionKey: config.encryptionKey,
    remoteEncryptionKey: config.remoteEncryptionKey,
    syncUrl: config.syncUrl,
    syncInterval: config.syncInterval,
    readYourWrites: config.readYourWrites,
    offline: config.offline,
    fetch: config.fetch,
    timeout: config.timeout
  };
}

// node_modules/@libsql/isomorphic-ws/web.mjs
var _WebSocket;
if (typeof WebSocket !== "undefined") {
  _WebSocket = WebSocket;
} else if (typeof global !== "undefined") {
  _WebSocket = global.WebSocket;
} else if (typeof window !== "undefined") {
  _WebSocket = window.WebSocket;
} else if (typeof self !== "undefined") {
  _WebSocket = self.WebSocket;
}

// node_modules/@libsql/hrana-client/lib-esm/client.js
var Client = class {
  /** @private */
  constructor() {
    this.intMode = "number";
  }
  /** Representation of integers returned from the database. See {@link IntMode}.
   *
   * This value is inherited by {@link Stream} objects created with {@link openStream}, but you can
   * override the integer mode for every stream by setting {@link Stream.intMode} on the stream.
   */
  intMode;
};

// node_modules/@libsql/hrana-client/lib-esm/errors.js
var ClientError = class extends Error {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "ClientError";
  }
};
var ProtoError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "ProtoError";
  }
};
var ResponseError = class extends ClientError {
  code;
  /** @internal */
  proto;
  /** @private */
  constructor(message, protoError) {
    super(message);
    this.name = "ResponseError";
    this.code = protoError.code;
    this.proto = protoError;
    this.stack = void 0;
  }
};
var ClosedError = class extends ClientError {
  /** @private */
  constructor(message, cause) {
    if (cause !== void 0) {
      super(`${message}: ${cause}`);
      this.cause = cause;
    } else {
      super(message);
    }
    this.name = "ClosedError";
  }
};
var WebSocketUnsupportedError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "WebSocketUnsupportedError";
  }
};
var WebSocketError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "WebSocketError";
  }
};
var HttpServerError = class extends ClientError {
  status;
  /** @private */
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "HttpServerError";
  }
};
var ProtocolVersionError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "ProtocolVersionError";
  }
};
var InternalError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "InternalError";
  }
};
var MisuseError = class extends ClientError {
  /** @private */
  constructor(message) {
    super(message);
    this.name = "MisuseError";
  }
};

// node_modules/@libsql/hrana-client/lib-esm/encoding/json/decode.js
function string(value) {
  if (typeof value === "string") {
    return value;
  }
  throw typeError(value, "string");
}
function stringOpt(value) {
  if (value === null || value === void 0) {
    return void 0;
  } else if (typeof value === "string") {
    return value;
  }
  throw typeError(value, "string or null");
}
function number(value) {
  if (typeof value === "number") {
    return value;
  }
  throw typeError(value, "number");
}
function boolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  throw typeError(value, "boolean");
}
function array(value) {
  if (Array.isArray(value)) {
    return value;
  }
  throw typeError(value, "array");
}
function object(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  throw typeError(value, "object");
}
function arrayObjectsMap(value, fun) {
  return array(value).map((elemValue) => fun(object(elemValue)));
}
function typeError(value, expected) {
  if (value === void 0) {
    return new ProtoError(`Expected ${expected}, but the property was missing`);
  }
  let received = typeof value;
  if (value === null) {
    received = "null";
  } else if (Array.isArray(value)) {
    received = "array";
  }
  return new ProtoError(`Expected ${expected}, received ${received}`);
}
function readJsonObject(value, fun) {
  return fun(object(value));
}

// node_modules/@libsql/hrana-client/lib-esm/encoding/json/encode.js
var ObjectWriter = class {
  #output;
  #isFirst;
  constructor(output) {
    this.#output = output;
    this.#isFirst = false;
  }
  begin() {
    this.#output.push("{");
    this.#isFirst = true;
  }
  end() {
    this.#output.push("}");
    this.#isFirst = false;
  }
  #key(name) {
    if (this.#isFirst) {
      this.#output.push('"');
      this.#isFirst = false;
    } else {
      this.#output.push(',"');
    }
    this.#output.push(name);
    this.#output.push('":');
  }
  string(name, value) {
    this.#key(name);
    this.#output.push(JSON.stringify(value));
  }
  stringRaw(name, value) {
    this.#key(name);
    this.#output.push('"');
    this.#output.push(value);
    this.#output.push('"');
  }
  number(name, value) {
    this.#key(name);
    this.#output.push("" + value);
  }
  boolean(name, value) {
    this.#key(name);
    this.#output.push(value ? "true" : "false");
  }
  object(name, value, valueFun) {
    this.#key(name);
    this.begin();
    valueFun(this, value);
    this.end();
  }
  arrayObjects(name, values, valueFun) {
    this.#key(name);
    this.#output.push("[");
    for (let i = 0; i < values.length; ++i) {
      if (i !== 0) {
        this.#output.push(",");
      }
      this.begin();
      valueFun(this, values[i]);
      this.end();
    }
    this.#output.push("]");
  }
};
function writeJsonObject(value, fun) {
  const output = [];
  const writer = new ObjectWriter(output);
  writer.begin();
  fun(writer, value);
  writer.end();
  return output.join("");
}

// node_modules/@libsql/hrana-client/lib-esm/encoding/protobuf/util.js
var VARINT = 0;
var FIXED_64 = 1;
var LENGTH_DELIMITED = 2;
var FIXED_32 = 5;

// node_modules/@libsql/hrana-client/lib-esm/encoding/protobuf/decode.js
var MessageReader = class {
  #array;
  #view;
  #pos;
  constructor(array2) {
    this.#array = array2;
    this.#view = new DataView(array2.buffer, array2.byteOffset, array2.byteLength);
    this.#pos = 0;
  }
  varint() {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = this.#array[this.#pos++];
      value |= (byte & 127) << shift;
      if (!(byte & 128)) {
        break;
      }
    }
    return value;
  }
  varintBig() {
    let value = 0n;
    for (let shift = 0n; ; shift += 7n) {
      const byte = this.#array[this.#pos++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        break;
      }
    }
    return value;
  }
  bytes(length) {
    const array2 = new Uint8Array(this.#array.buffer, this.#array.byteOffset + this.#pos, length);
    this.#pos += length;
    return array2;
  }
  double() {
    const value = this.#view.getFloat64(this.#pos, true);
    this.#pos += 8;
    return value;
  }
  skipVarint() {
    for (; ; ) {
      const byte = this.#array[this.#pos++];
      if (!(byte & 128)) {
        break;
      }
    }
  }
  skip(count) {
    this.#pos += count;
  }
  eof() {
    return this.#pos >= this.#array.byteLength;
  }
};
var FieldReader = class {
  #reader;
  #wireType;
  constructor(reader) {
    this.#reader = reader;
    this.#wireType = -1;
  }
  setup(wireType) {
    this.#wireType = wireType;
  }
  #expect(expectedWireType) {
    if (this.#wireType !== expectedWireType) {
      throw new ProtoError(`Expected wire type ${expectedWireType}, got ${this.#wireType}`);
    }
    this.#wireType = -1;
  }
  bytes() {
    this.#expect(LENGTH_DELIMITED);
    const length = this.#reader.varint();
    return this.#reader.bytes(length);
  }
  string() {
    return new TextDecoder().decode(this.bytes());
  }
  message(def2) {
    return readProtobufMessage(this.bytes(), def2);
  }
  int32() {
    this.#expect(VARINT);
    return this.#reader.varint();
  }
  uint32() {
    return this.int32();
  }
  bool() {
    return this.int32() !== 0;
  }
  uint64() {
    this.#expect(VARINT);
    return this.#reader.varintBig();
  }
  sint64() {
    const value = this.uint64();
    return value >> 1n ^ -(value & 1n);
  }
  double() {
    this.#expect(FIXED_64);
    return this.#reader.double();
  }
  maybeSkip() {
    if (this.#wireType < 0) {
      return;
    } else if (this.#wireType === VARINT) {
      this.#reader.skipVarint();
    } else if (this.#wireType === FIXED_64) {
      this.#reader.skip(8);
    } else if (this.#wireType === LENGTH_DELIMITED) {
      const length = this.#reader.varint();
      this.#reader.skip(length);
    } else if (this.#wireType === FIXED_32) {
      this.#reader.skip(4);
    } else {
      throw new ProtoError(`Unexpected wire type ${this.#wireType}`);
    }
    this.#wireType = -1;
  }
};
function readProtobufMessage(data, def2) {
  const msgReader = new MessageReader(data);
  const fieldReader = new FieldReader(msgReader);
  let value = def2.default();
  while (!msgReader.eof()) {
    const key = msgReader.varint();
    const tag = key >> 3;
    const wireType = key & 7;
    fieldReader.setup(wireType);
    const tagFun = def2[tag];
    if (tagFun !== void 0) {
      const returnedValue = tagFun(fieldReader, value);
      if (returnedValue !== void 0) {
        value = returnedValue;
      }
    }
    fieldReader.maybeSkip();
  }
  return value;
}

// node_modules/@libsql/hrana-client/lib-esm/encoding/protobuf/encode.js
var MessageWriter = class _MessageWriter {
  #buf;
  #array;
  #view;
  #pos;
  constructor() {
    this.#buf = new ArrayBuffer(256);
    this.#array = new Uint8Array(this.#buf);
    this.#view = new DataView(this.#buf);
    this.#pos = 0;
  }
  #ensure(extra) {
    if (this.#pos + extra <= this.#buf.byteLength) {
      return;
    }
    let newCap = this.#buf.byteLength;
    while (newCap < this.#pos + extra) {
      newCap *= 2;
    }
    const newBuf = new ArrayBuffer(newCap);
    const newArray = new Uint8Array(newBuf);
    const newView = new DataView(newBuf);
    newArray.set(new Uint8Array(this.#buf, 0, this.#pos));
    this.#buf = newBuf;
    this.#array = newArray;
    this.#view = newView;
  }
  #varint(value) {
    this.#ensure(5);
    value = 0 | value;
    do {
      let byte = value & 127;
      value >>>= 7;
      byte |= value ? 128 : 0;
      this.#array[this.#pos++] = byte;
    } while (value);
  }
  #varintBig(value) {
    this.#ensure(10);
    value = value & 0xffffffffffffffffn;
    do {
      let byte = Number(value & 0x7fn);
      value >>= 7n;
      byte |= value ? 128 : 0;
      this.#array[this.#pos++] = byte;
    } while (value);
  }
  #tag(tag, wireType) {
    this.#varint(tag << 3 | wireType);
  }
  bytes(tag, value) {
    this.#tag(tag, LENGTH_DELIMITED);
    this.#varint(value.byteLength);
    this.#ensure(value.byteLength);
    this.#array.set(value, this.#pos);
    this.#pos += value.byteLength;
  }
  string(tag, value) {
    this.bytes(tag, new TextEncoder().encode(value));
  }
  message(tag, value, fun) {
    const writer = new _MessageWriter();
    fun(writer, value);
    this.bytes(tag, writer.data());
  }
  int32(tag, value) {
    this.#tag(tag, VARINT);
    this.#varint(value);
  }
  uint32(tag, value) {
    this.int32(tag, value);
  }
  bool(tag, value) {
    this.int32(tag, value ? 1 : 0);
  }
  sint64(tag, value) {
    this.#tag(tag, VARINT);
    this.#varintBig(value << 1n ^ value >> 63n);
  }
  double(tag, value) {
    this.#tag(tag, FIXED_64);
    this.#ensure(8);
    this.#view.setFloat64(this.#pos, value, true);
    this.#pos += 8;
  }
  data() {
    return new Uint8Array(this.#buf, 0, this.#pos);
  }
};
function writeProtobufMessage(value, fun) {
  const w = new MessageWriter();
  fun(w, value);
  return w.data();
}

// node_modules/@libsql/hrana-client/lib-esm/id_alloc.js
var IdAlloc = class {
  // Set of all allocated ids
  #usedIds;
  // Set of all free ids lower than `#usedIds.size`
  #freeIds;
  constructor() {
    this.#usedIds = /* @__PURE__ */ new Set();
    this.#freeIds = /* @__PURE__ */ new Set();
  }
  // Returns an id that was free, and marks it as used.
  alloc() {
    for (const freeId2 of this.#freeIds) {
      this.#freeIds.delete(freeId2);
      this.#usedIds.add(freeId2);
      if (!this.#usedIds.has(this.#usedIds.size - 1)) {
        this.#freeIds.add(this.#usedIds.size - 1);
      }
      return freeId2;
    }
    const freeId = this.#usedIds.size;
    this.#usedIds.add(freeId);
    return freeId;
  }
  free(id) {
    if (!this.#usedIds.delete(id)) {
      throw new InternalError("Freeing an id that is not allocated");
    }
    this.#freeIds.delete(this.#usedIds.size);
    if (id < this.#usedIds.size) {
      this.#freeIds.add(id);
    }
  }
};

// node_modules/@libsql/hrana-client/lib-esm/util.js
function impossible(value, message) {
  throw new InternalError(message);
}

// node_modules/@libsql/hrana-client/lib-esm/value.js
function valueToProto(value) {
  if (value === null) {
    return null;
  } else if (typeof value === "string") {
    return value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("Only finite numbers (not Infinity or NaN) can be passed as arguments");
    }
    return value;
  } else if (typeof value === "bigint") {
    if (value < minInteger || value > maxInteger) {
      throw new RangeError("This bigint value is too large to be represented as a 64-bit integer and passed as argument");
    }
    return value;
  } else if (typeof value === "boolean") {
    return value ? 1n : 0n;
  } else if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  } else if (value instanceof Uint8Array) {
    return value;
  } else if (value instanceof Date) {
    return +value.valueOf();
  } else if (typeof value === "object") {
    return "" + value.toString();
  } else {
    throw new TypeError("Unsupported type of value");
  }
}
var minInteger = -9223372036854775808n;
var maxInteger = 9223372036854775807n;
function valueFromProto(value, intMode) {
  if (value === null) {
    return null;
  } else if (typeof value === "number") {
    return value;
  } else if (typeof value === "string") {
    return value;
  } else if (typeof value === "bigint") {
    if (intMode === "number") {
      const num = Number(value);
      if (!Number.isSafeInteger(num)) {
        throw new RangeError("Received integer which is too large to be safely represented as a JavaScript number");
      }
      return num;
    } else if (intMode === "bigint") {
      return value;
    } else if (intMode === "string") {
      return "" + value;
    } else {
      throw new MisuseError("Invalid value for IntMode");
    }
  } else if (value instanceof Uint8Array) {
    return value.slice().buffer;
  } else if (value === void 0) {
    throw new ProtoError("Received unrecognized type of Value");
  } else {
    throw impossible(value, "Impossible type of Value");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/result.js
function stmtResultFromProto(result) {
  return {
    affectedRowCount: result.affectedRowCount,
    lastInsertRowid: result.lastInsertRowid,
    columnNames: result.cols.map((col) => col.name),
    columnDecltypes: result.cols.map((col) => col.decltype)
  };
}
function rowsResultFromProto(result, intMode) {
  const stmtResult = stmtResultFromProto(result);
  const rows = result.rows.map((row) => rowFromProto(stmtResult.columnNames, row, intMode));
  return { ...stmtResult, rows };
}
function rowResultFromProto(result, intMode) {
  const stmtResult = stmtResultFromProto(result);
  let row;
  if (result.rows.length > 0) {
    row = rowFromProto(stmtResult.columnNames, result.rows[0], intMode);
  }
  return { ...stmtResult, row };
}
function valueResultFromProto(result, intMode) {
  const stmtResult = stmtResultFromProto(result);
  let value;
  if (result.rows.length > 0 && stmtResult.columnNames.length > 0) {
    value = valueFromProto(result.rows[0][0], intMode);
  }
  return { ...stmtResult, value };
}
function rowFromProto(colNames, values, intMode) {
  const row = {};
  Object.defineProperty(row, "length", { value: values.length });
  for (let i = 0; i < values.length; ++i) {
    const value = valueFromProto(values[i], intMode);
    Object.defineProperty(row, i, { value });
    const colName = colNames[i];
    if (colName !== void 0 && !Object.hasOwn(row, colName)) {
      Object.defineProperty(row, colName, { value, enumerable: true, configurable: true, writable: true });
    }
  }
  return row;
}
function errorFromProto(error) {
  return new ResponseError(error.message, error);
}

// node_modules/@libsql/hrana-client/lib-esm/sql.js
var Sql = class {
  #owner;
  #sqlId;
  #closed;
  /** @private */
  constructor(owner, sqlId) {
    this.#owner = owner;
    this.#sqlId = sqlId;
    this.#closed = void 0;
  }
  /** @private */
  _getSqlId(owner) {
    if (this.#owner !== owner) {
      throw new MisuseError("Attempted to use SQL text opened with other object");
    } else if (this.#closed !== void 0) {
      throw new ClosedError("SQL text is closed", this.#closed);
    }
    return this.#sqlId;
  }
  /** Remove the SQL text from the server, releasing resouces. */
  close() {
    this._setClosed(new ClientError("SQL text was manually closed"));
  }
  /** @private */
  _setClosed(error) {
    if (this.#closed === void 0) {
      this.#closed = error;
      this.#owner._closeSql(this.#sqlId);
    }
  }
  /** True if the SQL text is closed (removed from the server). */
  get closed() {
    return this.#closed !== void 0;
  }
};
function sqlToProto(owner, sql) {
  if (sql instanceof Sql) {
    return { sqlId: sql._getSqlId(owner) };
  } else {
    return { sql: "" + sql };
  }
}

// node_modules/@libsql/hrana-client/lib-esm/queue.js
var Queue = class {
  #pushStack;
  #shiftStack;
  constructor() {
    this.#pushStack = [];
    this.#shiftStack = [];
  }
  get length() {
    return this.#pushStack.length + this.#shiftStack.length;
  }
  push(elem) {
    this.#pushStack.push(elem);
  }
  shift() {
    if (this.#shiftStack.length === 0 && this.#pushStack.length > 0) {
      this.#shiftStack = this.#pushStack.reverse();
      this.#pushStack = [];
    }
    return this.#shiftStack.pop();
  }
  first() {
    return this.#shiftStack.length !== 0 ? this.#shiftStack[this.#shiftStack.length - 1] : this.#pushStack[0];
  }
};

// node_modules/@libsql/hrana-client/lib-esm/stmt.js
var Stmt = class {
  /** The SQL statement text. */
  sql;
  /** @private */
  _args;
  /** @private */
  _namedArgs;
  /** Initialize the statement with given SQL text. */
  constructor(sql) {
    this.sql = sql;
    this._args = [];
    this._namedArgs = /* @__PURE__ */ new Map();
  }
  /** Binds positional parameters from the given `values`. All previous positional bindings are cleared. */
  bindIndexes(values) {
    this._args.length = 0;
    for (const value of values) {
      this._args.push(valueToProto(value));
    }
    return this;
  }
  /** Binds a parameter by a 1-based index. */
  bindIndex(index, value) {
    if (index !== (index | 0) || index <= 0) {
      throw new RangeError("Index of a positional argument must be positive integer");
    }
    while (this._args.length < index) {
      this._args.push(null);
    }
    this._args[index - 1] = valueToProto(value);
    return this;
  }
  /** Binds a parameter by name. */
  bindName(name, value) {
    this._namedArgs.set(name, valueToProto(value));
    return this;
  }
  /** Clears all bindings. */
  unbindAll() {
    this._args.length = 0;
    this._namedArgs.clear();
    return this;
  }
};
function stmtToProto(sqlOwner, stmt, wantRows) {
  let inSql;
  let args = [];
  let namedArgs = [];
  if (stmt instanceof Stmt) {
    inSql = stmt.sql;
    args = stmt._args;
    for (const [name, value] of stmt._namedArgs.entries()) {
      namedArgs.push({ name, value });
    }
  } else if (Array.isArray(stmt)) {
    inSql = stmt[0];
    if (Array.isArray(stmt[1])) {
      args = stmt[1].map((arg) => valueToProto(arg));
    } else {
      namedArgs = Object.entries(stmt[1]).map(([name, value]) => {
        return { name, value: valueToProto(value) };
      });
    }
  } else {
    inSql = stmt;
  }
  const { sql, sqlId } = sqlToProto(sqlOwner, inSql);
  return { sql, sqlId, args, namedArgs, wantRows };
}

// node_modules/@libsql/hrana-client/lib-esm/batch.js
var Batch = class {
  /** @private */
  _stream;
  #useCursor;
  /** @private */
  _steps;
  #executed;
  /** @private */
  constructor(stream, useCursor) {
    this._stream = stream;
    this.#useCursor = useCursor;
    this._steps = [];
    this.#executed = false;
  }
  /** Return a builder for adding a step to the batch. */
  step() {
    return new BatchStep(this);
  }
  /** Execute the batch. */
  execute() {
    if (this.#executed) {
      throw new MisuseError("This batch has already been executed");
    }
    this.#executed = true;
    const batch = {
      steps: this._steps.map((step) => step.proto)
    };
    if (this.#useCursor) {
      return executeCursor(this._stream, this._steps, batch);
    } else {
      return executeRegular(this._stream, this._steps, batch);
    }
  }
};
function executeRegular(stream, steps, batch) {
  return stream._batch(batch).then((result) => {
    for (let step = 0; step < steps.length; ++step) {
      const stepResult = result.stepResults.get(step);
      const stepError = result.stepErrors.get(step);
      steps[step].callback(stepResult, stepError);
    }
  });
}
async function executeCursor(stream, steps, batch) {
  const cursor = await stream._openCursor(batch);
  try {
    let nextStep = 0;
    let beginEntry = void 0;
    let rows = [];
    for (; ; ) {
      const entry = await cursor.next();
      if (entry === void 0) {
        break;
      }
      if (entry.type === "step_begin") {
        if (entry.step < nextStep || entry.step >= steps.length) {
          throw new ProtoError("Server produced StepBeginEntry for unexpected step");
        } else if (beginEntry !== void 0) {
          throw new ProtoError("Server produced StepBeginEntry before terminating previous step");
        }
        for (let step = nextStep; step < entry.step; ++step) {
          steps[step].callback(void 0, void 0);
        }
        nextStep = entry.step + 1;
        beginEntry = entry;
        rows = [];
      } else if (entry.type === "step_end") {
        if (beginEntry === void 0) {
          throw new ProtoError("Server produced StepEndEntry but no step is active");
        }
        const stmtResult = {
          cols: beginEntry.cols,
          rows,
          affectedRowCount: entry.affectedRowCount,
          lastInsertRowid: entry.lastInsertRowid
        };
        steps[beginEntry.step].callback(stmtResult, void 0);
        beginEntry = void 0;
        rows = [];
      } else if (entry.type === "step_error") {
        if (beginEntry === void 0) {
          if (entry.step >= steps.length) {
            throw new ProtoError("Server produced StepErrorEntry for unexpected step");
          }
          for (let step = nextStep; step < entry.step; ++step) {
            steps[step].callback(void 0, void 0);
          }
        } else {
          if (entry.step !== beginEntry.step) {
            throw new ProtoError("Server produced StepErrorEntry for unexpected step");
          }
          beginEntry = void 0;
          rows = [];
        }
        steps[entry.step].callback(void 0, entry.error);
        nextStep = entry.step + 1;
      } else if (entry.type === "row") {
        if (beginEntry === void 0) {
          throw new ProtoError("Server produced RowEntry but no step is active");
        }
        rows.push(entry.row);
      } else if (entry.type === "error") {
        throw errorFromProto(entry.error);
      } else if (entry.type === "none") {
        throw new ProtoError("Server produced unrecognized CursorEntry");
      } else {
        throw impossible(entry, "Impossible CursorEntry");
      }
    }
    if (beginEntry !== void 0) {
      throw new ProtoError("Server closed Cursor before terminating active step");
    }
    for (let step = nextStep; step < steps.length; ++step) {
      steps[step].callback(void 0, void 0);
    }
  } finally {
    cursor.close();
  }
}
var BatchStep = class {
  /** @private */
  _batch;
  #conds;
  /** @private */
  _index;
  /** @private */
  constructor(batch) {
    this._batch = batch;
    this.#conds = [];
    this._index = void 0;
  }
  /** Add the condition that needs to be satisfied to execute the statement. If you use this method multiple
   * times, we join the conditions with a logical AND. */
  condition(cond) {
    this.#conds.push(cond._proto);
    return this;
  }
  /** Add a statement that returns rows. */
  query(stmt) {
    return this.#add(stmt, true, rowsResultFromProto);
  }
  /** Add a statement that returns at most a single row. */
  queryRow(stmt) {
    return this.#add(stmt, true, rowResultFromProto);
  }
  /** Add a statement that returns at most a single value. */
  queryValue(stmt) {
    return this.#add(stmt, true, valueResultFromProto);
  }
  /** Add a statement without returning rows. */
  run(stmt) {
    return this.#add(stmt, false, stmtResultFromProto);
  }
  #add(inStmt, wantRows, fromProto) {
    if (this._index !== void 0) {
      throw new MisuseError("This BatchStep has already been added to the batch");
    }
    const stmt = stmtToProto(this._batch._stream._sqlOwner(), inStmt, wantRows);
    let condition;
    if (this.#conds.length === 0) {
      condition = void 0;
    } else if (this.#conds.length === 1) {
      condition = this.#conds[0];
    } else {
      condition = { type: "and", conds: this.#conds.slice() };
    }
    const proto = { stmt, condition };
    return new Promise((outputCallback, errorCallback) => {
      const callback = (stepResult, stepError) => {
        if (stepResult !== void 0 && stepError !== void 0) {
          errorCallback(new ProtoError("Server returned both result and error"));
        } else if (stepError !== void 0) {
          errorCallback(errorFromProto(stepError));
        } else if (stepResult !== void 0) {
          outputCallback(fromProto(stepResult, this._batch._stream.intMode));
        } else {
          outputCallback(void 0);
        }
      };
      this._index = this._batch._steps.length;
      this._batch._steps.push({ proto, callback });
    });
  }
};
var BatchCond = class _BatchCond {
  /** @private */
  _batch;
  /** @private */
  _proto;
  /** @private */
  constructor(batch, proto) {
    this._batch = batch;
    this._proto = proto;
  }
  /** Create a condition that evaluates to true when the given step executes successfully.
   *
   * If the given step fails error or is skipped because its condition evaluated to false, this
   * condition evaluates to false.
   */
  static ok(step) {
    return new _BatchCond(step._batch, { type: "ok", step: stepIndex(step) });
  }
  /** Create a condition that evaluates to true when the given step fails.
   *
   * If the given step succeeds or is skipped because its condition evaluated to false, this condition
   * evaluates to false.
   */
  static error(step) {
    return new _BatchCond(step._batch, { type: "error", step: stepIndex(step) });
  }
  /** Create a condition that is a logical negation of another condition.
   */
  static not(cond) {
    return new _BatchCond(cond._batch, { type: "not", cond: cond._proto });
  }
  /** Create a condition that is a logical AND of other conditions.
   */
  static and(batch, conds) {
    for (const cond of conds) {
      checkCondBatch(batch, cond);
    }
    return new _BatchCond(batch, { type: "and", conds: conds.map((e) => e._proto) });
  }
  /** Create a condition that is a logical OR of other conditions.
   */
  static or(batch, conds) {
    for (const cond of conds) {
      checkCondBatch(batch, cond);
    }
    return new _BatchCond(batch, { type: "or", conds: conds.map((e) => e._proto) });
  }
  /** Create a condition that evaluates to true when the SQL connection is in autocommit mode (not inside an
   * explicit transaction). This requires protocol version 3 or higher.
   */
  static isAutocommit(batch) {
    batch._stream.client()._ensureVersion(3, "BatchCond.isAutocommit()");
    return new _BatchCond(batch, { type: "is_autocommit" });
  }
};
function stepIndex(step) {
  if (step._index === void 0) {
    throw new MisuseError("Cannot add a condition referencing a step that has not been added to the batch");
  }
  return step._index;
}
function checkCondBatch(expectedBatch, cond) {
  if (cond._batch !== expectedBatch) {
    throw new MisuseError("Cannot mix BatchCond objects for different Batch objects");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/describe.js
function describeResultFromProto(result) {
  return {
    paramNames: result.params.map((p) => p.name),
    columns: result.cols,
    isExplain: result.isExplain,
    isReadonly: result.isReadonly
  };
}

// node_modules/@libsql/hrana-client/lib-esm/stream.js
var Stream = class {
  /** @private */
  constructor(intMode) {
    this.intMode = intMode;
  }
  /** Execute a statement and return rows. */
  query(stmt) {
    return this.#execute(stmt, true, rowsResultFromProto);
  }
  /** Execute a statement and return at most a single row. */
  queryRow(stmt) {
    return this.#execute(stmt, true, rowResultFromProto);
  }
  /** Execute a statement and return at most a single value. */
  queryValue(stmt) {
    return this.#execute(stmt, true, valueResultFromProto);
  }
  /** Execute a statement without returning rows. */
  run(stmt) {
    return this.#execute(stmt, false, stmtResultFromProto);
  }
  #execute(inStmt, wantRows, fromProto) {
    const stmt = stmtToProto(this._sqlOwner(), inStmt, wantRows);
    return this._execute(stmt).then((r) => fromProto(r, this.intMode));
  }
  /** Return a builder for creating and executing a batch.
   *
   * If `useCursor` is true, the batch will be executed using a Hrana cursor, which will stream results from
   * the server to the client, which consumes less memory on the server. This requires protocol version 3 or
   * higher.
   */
  batch(useCursor = false) {
    return new Batch(this, useCursor);
  }
  /** Parse and analyze a statement. This requires protocol version 2 or higher. */
  describe(inSql) {
    const protoSql = sqlToProto(this._sqlOwner(), inSql);
    return this._describe(protoSql).then(describeResultFromProto);
  }
  /** Execute a sequence of statements separated by semicolons. This requires protocol version 2 or higher.
   * */
  sequence(inSql) {
    const protoSql = sqlToProto(this._sqlOwner(), inSql);
    return this._sequence(protoSql);
  }
  /** Representation of integers returned from the database. See {@link IntMode}.
   *
   * This value affects the results of all operations on this stream.
   */
  intMode;
};

// node_modules/@libsql/hrana-client/lib-esm/cursor.js
var Cursor = class {
};

// node_modules/@libsql/hrana-client/lib-esm/ws/cursor.js
var fetchChunkSize = 1e3;
var fetchQueueSize = 10;
var WsCursor = class extends Cursor {
  #client;
  #stream;
  #cursorId;
  #entryQueue;
  #fetchQueue;
  #closed;
  #done;
  /** @private */
  constructor(client, stream, cursorId) {
    super();
    this.#client = client;
    this.#stream = stream;
    this.#cursorId = cursorId;
    this.#entryQueue = new Queue();
    this.#fetchQueue = new Queue();
    this.#closed = void 0;
    this.#done = false;
  }
  /** Fetch the next entry from the cursor. */
  async next() {
    for (; ; ) {
      if (this.#closed !== void 0) {
        throw new ClosedError("Cursor is closed", this.#closed);
      }
      while (!this.#done && this.#fetchQueue.length < fetchQueueSize) {
        this.#fetchQueue.push(this.#fetch());
      }
      const entry = this.#entryQueue.shift();
      if (this.#done || entry !== void 0) {
        return entry;
      }
      await this.#fetchQueue.shift().then((response) => {
        if (response === void 0) {
          return;
        }
        for (const entry2 of response.entries) {
          this.#entryQueue.push(entry2);
        }
        this.#done ||= response.done;
      });
    }
  }
  #fetch() {
    return this.#stream._sendCursorRequest(this, {
      type: "fetch_cursor",
      cursorId: this.#cursorId,
      maxCount: fetchChunkSize
    }).then((resp) => resp, (error) => {
      this._setClosed(error);
      return void 0;
    });
  }
  /** @private */
  _setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    this.#stream._sendCursorRequest(this, {
      type: "close_cursor",
      cursorId: this.#cursorId
    }).catch(() => void 0);
    this.#stream._cursorClosed(this);
  }
  /** Close the cursor. */
  close() {
    this._setClosed(new ClientError("Cursor was manually closed"));
  }
  /** True if the cursor is closed. */
  get closed() {
    return this.#closed !== void 0;
  }
};

// node_modules/@libsql/hrana-client/lib-esm/ws/stream.js
var WsStream = class _WsStream extends Stream {
  #client;
  #streamId;
  #queue;
  #cursor;
  #closing;
  #closed;
  /** @private */
  static open(client) {
    const streamId = client._streamIdAlloc.alloc();
    const stream = new _WsStream(client, streamId);
    const responseCallback = () => void 0;
    const errorCallback = (e) => stream.#setClosed(e);
    const request = { type: "open_stream", streamId };
    client._sendRequest(request, { responseCallback, errorCallback });
    return stream;
  }
  /** @private */
  constructor(client, streamId) {
    super(client.intMode);
    this.#client = client;
    this.#streamId = streamId;
    this.#queue = new Queue();
    this.#cursor = void 0;
    this.#closing = false;
    this.#closed = void 0;
  }
  /** Get the {@link WsClient} object that this stream belongs to. */
  client() {
    return this.#client;
  }
  /** @private */
  _sqlOwner() {
    return this.#client;
  }
  /** @private */
  _execute(stmt) {
    return this.#sendStreamRequest({
      type: "execute",
      streamId: this.#streamId,
      stmt
    }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _batch(batch) {
    return this.#sendStreamRequest({
      type: "batch",
      streamId: this.#streamId,
      batch
    }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _describe(protoSql) {
    this.#client._ensureVersion(2, "describe()");
    return this.#sendStreamRequest({
      type: "describe",
      streamId: this.#streamId,
      sql: protoSql.sql,
      sqlId: protoSql.sqlId
    }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _sequence(protoSql) {
    this.#client._ensureVersion(2, "sequence()");
    return this.#sendStreamRequest({
      type: "sequence",
      streamId: this.#streamId,
      sql: protoSql.sql,
      sqlId: protoSql.sqlId
    }).then((_response) => {
      return void 0;
    });
  }
  /** Check whether the SQL connection underlying this stream is in autocommit state (i.e., outside of an
   * explicit transaction). This requires protocol version 3 or higher.
   */
  getAutocommit() {
    this.#client._ensureVersion(3, "getAutocommit()");
    return this.#sendStreamRequest({
      type: "get_autocommit",
      streamId: this.#streamId
    }).then((response) => {
      return response.isAutocommit;
    });
  }
  #sendStreamRequest(request) {
    return new Promise((responseCallback, errorCallback) => {
      this.#pushToQueue({ type: "request", request, responseCallback, errorCallback });
    });
  }
  /** @private */
  _openCursor(batch) {
    this.#client._ensureVersion(3, "cursor");
    return new Promise((cursorCallback, errorCallback) => {
      this.#pushToQueue({ type: "cursor", batch, cursorCallback, errorCallback });
    });
  }
  /** @private */
  _sendCursorRequest(cursor, request) {
    if (cursor !== this.#cursor) {
      throw new InternalError("Cursor not associated with the stream attempted to execute a request");
    }
    return new Promise((responseCallback, errorCallback) => {
      if (this.#closed !== void 0) {
        errorCallback(new ClosedError("Stream is closed", this.#closed));
      } else {
        this.#client._sendRequest(request, { responseCallback, errorCallback });
      }
    });
  }
  /** @private */
  _cursorClosed(cursor) {
    if (cursor !== this.#cursor) {
      throw new InternalError("Cursor was closed, but it was not associated with the stream");
    }
    this.#cursor = void 0;
    this.#flushQueue();
  }
  #pushToQueue(entry) {
    if (this.#closed !== void 0) {
      entry.errorCallback(new ClosedError("Stream is closed", this.#closed));
    } else if (this.#closing) {
      entry.errorCallback(new ClosedError("Stream is closing", void 0));
    } else {
      this.#queue.push(entry);
      this.#flushQueue();
    }
  }
  #flushQueue() {
    for (; ; ) {
      const entry = this.#queue.first();
      if (entry === void 0 && this.#cursor === void 0 && this.#closing) {
        this.#setClosed(new ClientError("Stream was gracefully closed"));
        break;
      } else if (entry?.type === "request" && this.#cursor === void 0) {
        const { request, responseCallback, errorCallback } = entry;
        this.#queue.shift();
        this.#client._sendRequest(request, { responseCallback, errorCallback });
      } else if (entry?.type === "cursor" && this.#cursor === void 0) {
        const { batch, cursorCallback } = entry;
        this.#queue.shift();
        const cursorId = this.#client._cursorIdAlloc.alloc();
        const cursor = new WsCursor(this.#client, this, cursorId);
        const request = {
          type: "open_cursor",
          streamId: this.#streamId,
          cursorId,
          batch
        };
        const responseCallback = () => void 0;
        const errorCallback = (e) => cursor._setClosed(e);
        this.#client._sendRequest(request, { responseCallback, errorCallback });
        this.#cursor = cursor;
        cursorCallback(cursor);
      } else {
        break;
      }
    }
  }
  #setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    if (this.#cursor !== void 0) {
      this.#cursor._setClosed(error);
    }
    for (; ; ) {
      const entry = this.#queue.shift();
      if (entry !== void 0) {
        entry.errorCallback(error);
      } else {
        break;
      }
    }
    const request = { type: "close_stream", streamId: this.#streamId };
    const responseCallback = () => this.#client._streamIdAlloc.free(this.#streamId);
    const errorCallback = () => void 0;
    this.#client._sendRequest(request, { responseCallback, errorCallback });
  }
  /** Immediately close the stream. */
  close() {
    this.#setClosed(new ClientError("Stream was manually closed"));
  }
  /** Gracefully close the stream. */
  closeGracefully() {
    this.#closing = true;
    this.#flushQueue();
  }
  /** True if the stream is closed or closing. */
  get closed() {
    return this.#closed !== void 0 || this.#closing;
  }
};

// node_modules/@libsql/hrana-client/lib-esm/shared/json_encode.js
function Stmt2(w, msg) {
  if (msg.sql !== void 0) {
    w.string("sql", msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.number("sql_id", msg.sqlId);
  }
  w.arrayObjects("args", msg.args, Value);
  w.arrayObjects("named_args", msg.namedArgs, NamedArg);
  w.boolean("want_rows", msg.wantRows);
}
function NamedArg(w, msg) {
  w.string("name", msg.name);
  w.object("value", msg.value, Value);
}
function Batch2(w, msg) {
  w.arrayObjects("steps", msg.steps, BatchStep2);
}
function BatchStep2(w, msg) {
  if (msg.condition !== void 0) {
    w.object("condition", msg.condition, BatchCond2);
  }
  w.object("stmt", msg.stmt, Stmt2);
}
function BatchCond2(w, msg) {
  w.stringRaw("type", msg.type);
  if (msg.type === "ok" || msg.type === "error") {
    w.number("step", msg.step);
  } else if (msg.type === "not") {
    w.object("cond", msg.cond, BatchCond2);
  } else if (msg.type === "and" || msg.type === "or") {
    w.arrayObjects("conds", msg.conds, BatchCond2);
  } else if (msg.type === "is_autocommit") {
  } else {
    throw impossible(msg, "Impossible type of BatchCond");
  }
}
function Value(w, msg) {
  if (msg === null) {
    w.stringRaw("type", "null");
  } else if (typeof msg === "bigint") {
    w.stringRaw("type", "integer");
    w.stringRaw("value", "" + msg);
  } else if (typeof msg === "number") {
    w.stringRaw("type", "float");
    w.number("value", msg);
  } else if (typeof msg === "string") {
    w.stringRaw("type", "text");
    w.string("value", msg);
  } else if (msg instanceof Uint8Array) {
    w.stringRaw("type", "blob");
    w.stringRaw("base64", gBase64.fromUint8Array(msg));
  } else if (msg === void 0) {
  } else {
    throw impossible(msg, "Impossible type of Value");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/ws/json_encode.js
function ClientMsg(w, msg) {
  w.stringRaw("type", msg.type);
  if (msg.type === "hello") {
    if (msg.jwt !== void 0) {
      w.string("jwt", msg.jwt);
    }
  } else if (msg.type === "request") {
    w.number("request_id", msg.requestId);
    w.object("request", msg.request, Request2);
  } else {
    throw impossible(msg, "Impossible type of ClientMsg");
  }
}
function Request2(w, msg) {
  w.stringRaw("type", msg.type);
  if (msg.type === "open_stream") {
    w.number("stream_id", msg.streamId);
  } else if (msg.type === "close_stream") {
    w.number("stream_id", msg.streamId);
  } else if (msg.type === "execute") {
    w.number("stream_id", msg.streamId);
    w.object("stmt", msg.stmt, Stmt2);
  } else if (msg.type === "batch") {
    w.number("stream_id", msg.streamId);
    w.object("batch", msg.batch, Batch2);
  } else if (msg.type === "open_cursor") {
    w.number("stream_id", msg.streamId);
    w.number("cursor_id", msg.cursorId);
    w.object("batch", msg.batch, Batch2);
  } else if (msg.type === "close_cursor") {
    w.number("cursor_id", msg.cursorId);
  } else if (msg.type === "fetch_cursor") {
    w.number("cursor_id", msg.cursorId);
    w.number("max_count", msg.maxCount);
  } else if (msg.type === "sequence") {
    w.number("stream_id", msg.streamId);
    if (msg.sql !== void 0) {
      w.string("sql", msg.sql);
    }
    if (msg.sqlId !== void 0) {
      w.number("sql_id", msg.sqlId);
    }
  } else if (msg.type === "describe") {
    w.number("stream_id", msg.streamId);
    if (msg.sql !== void 0) {
      w.string("sql", msg.sql);
    }
    if (msg.sqlId !== void 0) {
      w.number("sql_id", msg.sqlId);
    }
  } else if (msg.type === "store_sql") {
    w.number("sql_id", msg.sqlId);
    w.string("sql", msg.sql);
  } else if (msg.type === "close_sql") {
    w.number("sql_id", msg.sqlId);
  } else if (msg.type === "get_autocommit") {
    w.number("stream_id", msg.streamId);
  } else {
    throw impossible(msg, "Impossible type of Request");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/shared/protobuf_encode.js
function Stmt3(w, msg) {
  if (msg.sql !== void 0) {
    w.string(1, msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.int32(2, msg.sqlId);
  }
  for (const arg of msg.args) {
    w.message(3, arg, Value2);
  }
  for (const arg of msg.namedArgs) {
    w.message(4, arg, NamedArg2);
  }
  w.bool(5, msg.wantRows);
}
function NamedArg2(w, msg) {
  w.string(1, msg.name);
  w.message(2, msg.value, Value2);
}
function Batch3(w, msg) {
  for (const step of msg.steps) {
    w.message(1, step, BatchStep3);
  }
}
function BatchStep3(w, msg) {
  if (msg.condition !== void 0) {
    w.message(1, msg.condition, BatchCond3);
  }
  w.message(2, msg.stmt, Stmt3);
}
function BatchCond3(w, msg) {
  if (msg.type === "ok") {
    w.uint32(1, msg.step);
  } else if (msg.type === "error") {
    w.uint32(2, msg.step);
  } else if (msg.type === "not") {
    w.message(3, msg.cond, BatchCond3);
  } else if (msg.type === "and") {
    w.message(4, msg.conds, BatchCondList);
  } else if (msg.type === "or") {
    w.message(5, msg.conds, BatchCondList);
  } else if (msg.type === "is_autocommit") {
    w.message(6, void 0, Empty);
  } else {
    throw impossible(msg, "Impossible type of BatchCond");
  }
}
function BatchCondList(w, msg) {
  for (const cond of msg) {
    w.message(1, cond, BatchCond3);
  }
}
function Value2(w, msg) {
  if (msg === null) {
    w.message(1, void 0, Empty);
  } else if (typeof msg === "bigint") {
    w.sint64(2, msg);
  } else if (typeof msg === "number") {
    w.double(3, msg);
  } else if (typeof msg === "string") {
    w.string(4, msg);
  } else if (msg instanceof Uint8Array) {
    w.bytes(5, msg);
  } else if (msg === void 0) {
  } else {
    throw impossible(msg, "Impossible type of Value");
  }
}
function Empty(_w, _msg) {
}

// node_modules/@libsql/hrana-client/lib-esm/ws/protobuf_encode.js
function ClientMsg2(w, msg) {
  if (msg.type === "hello") {
    w.message(1, msg, HelloMsg);
  } else if (msg.type === "request") {
    w.message(2, msg, RequestMsg);
  } else {
    throw impossible(msg, "Impossible type of ClientMsg");
  }
}
function HelloMsg(w, msg) {
  if (msg.jwt !== void 0) {
    w.string(1, msg.jwt);
  }
}
function RequestMsg(w, msg) {
  w.int32(1, msg.requestId);
  const request = msg.request;
  if (request.type === "open_stream") {
    w.message(2, request, OpenStreamReq);
  } else if (request.type === "close_stream") {
    w.message(3, request, CloseStreamReq);
  } else if (request.type === "execute") {
    w.message(4, request, ExecuteReq);
  } else if (request.type === "batch") {
    w.message(5, request, BatchReq);
  } else if (request.type === "open_cursor") {
    w.message(6, request, OpenCursorReq);
  } else if (request.type === "close_cursor") {
    w.message(7, request, CloseCursorReq);
  } else if (request.type === "fetch_cursor") {
    w.message(8, request, FetchCursorReq);
  } else if (request.type === "sequence") {
    w.message(9, request, SequenceReq);
  } else if (request.type === "describe") {
    w.message(10, request, DescribeReq);
  } else if (request.type === "store_sql") {
    w.message(11, request, StoreSqlReq);
  } else if (request.type === "close_sql") {
    w.message(12, request, CloseSqlReq);
  } else if (request.type === "get_autocommit") {
    w.message(13, request, GetAutocommitReq);
  } else {
    throw impossible(request, "Impossible type of Request");
  }
}
function OpenStreamReq(w, msg) {
  w.int32(1, msg.streamId);
}
function CloseStreamReq(w, msg) {
  w.int32(1, msg.streamId);
}
function ExecuteReq(w, msg) {
  w.int32(1, msg.streamId);
  w.message(2, msg.stmt, Stmt3);
}
function BatchReq(w, msg) {
  w.int32(1, msg.streamId);
  w.message(2, msg.batch, Batch3);
}
function OpenCursorReq(w, msg) {
  w.int32(1, msg.streamId);
  w.int32(2, msg.cursorId);
  w.message(3, msg.batch, Batch3);
}
function CloseCursorReq(w, msg) {
  w.int32(1, msg.cursorId);
}
function FetchCursorReq(w, msg) {
  w.int32(1, msg.cursorId);
  w.uint32(2, msg.maxCount);
}
function SequenceReq(w, msg) {
  w.int32(1, msg.streamId);
  if (msg.sql !== void 0) {
    w.string(2, msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.int32(3, msg.sqlId);
  }
}
function DescribeReq(w, msg) {
  w.int32(1, msg.streamId);
  if (msg.sql !== void 0) {
    w.string(2, msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.int32(3, msg.sqlId);
  }
}
function StoreSqlReq(w, msg) {
  w.int32(1, msg.sqlId);
  w.string(2, msg.sql);
}
function CloseSqlReq(w, msg) {
  w.int32(1, msg.sqlId);
}
function GetAutocommitReq(w, msg) {
  w.int32(1, msg.streamId);
}

// node_modules/@libsql/hrana-client/lib-esm/shared/json_decode.js
function Error2(obj) {
  const message = string(obj["message"]);
  const code = stringOpt(obj["code"]);
  return { message, code };
}
function StmtResult(obj) {
  const cols = arrayObjectsMap(obj["cols"], Col);
  const rows = array(obj["rows"]).map((rowObj) => arrayObjectsMap(rowObj, Value3));
  const affectedRowCount = number(obj["affected_row_count"]);
  const lastInsertRowidStr = stringOpt(obj["last_insert_rowid"]);
  const lastInsertRowid = lastInsertRowidStr !== void 0 ? BigInt(lastInsertRowidStr) : void 0;
  return { cols, rows, affectedRowCount, lastInsertRowid };
}
function Col(obj) {
  const name = stringOpt(obj["name"]);
  const decltype = stringOpt(obj["decltype"]);
  return { name, decltype };
}
function BatchResult(obj) {
  const stepResults = /* @__PURE__ */ new Map();
  array(obj["step_results"]).forEach((value, i) => {
    if (value !== null) {
      stepResults.set(i, StmtResult(object(value)));
    }
  });
  const stepErrors = /* @__PURE__ */ new Map();
  array(obj["step_errors"]).forEach((value, i) => {
    if (value !== null) {
      stepErrors.set(i, Error2(object(value)));
    }
  });
  return { stepResults, stepErrors };
}
function CursorEntry(obj) {
  const type = string(obj["type"]);
  if (type === "step_begin") {
    const step = number(obj["step"]);
    const cols = arrayObjectsMap(obj["cols"], Col);
    return { type: "step_begin", step, cols };
  } else if (type === "step_end") {
    const affectedRowCount = number(obj["affected_row_count"]);
    const lastInsertRowidStr = stringOpt(obj["last_insert_rowid"]);
    const lastInsertRowid = lastInsertRowidStr !== void 0 ? BigInt(lastInsertRowidStr) : void 0;
    return { type: "step_end", affectedRowCount, lastInsertRowid };
  } else if (type === "step_error") {
    const step = number(obj["step"]);
    const error = Error2(object(obj["error"]));
    return { type: "step_error", step, error };
  } else if (type === "row") {
    const row = arrayObjectsMap(obj["row"], Value3);
    return { type: "row", row };
  } else if (type === "error") {
    const error = Error2(object(obj["error"]));
    return { type: "error", error };
  } else {
    throw new ProtoError("Unexpected type of CursorEntry");
  }
}
function DescribeResult(obj) {
  const params = arrayObjectsMap(obj["params"], DescribeParam);
  const cols = arrayObjectsMap(obj["cols"], DescribeCol);
  const isExplain = boolean(obj["is_explain"]);
  const isReadonly = boolean(obj["is_readonly"]);
  return { params, cols, isExplain, isReadonly };
}
function DescribeParam(obj) {
  const name = stringOpt(obj["name"]);
  return { name };
}
function DescribeCol(obj) {
  const name = string(obj["name"]);
  const decltype = stringOpt(obj["decltype"]);
  return { name, decltype };
}
function Value3(obj) {
  const type = string(obj["type"]);
  if (type === "null") {
    return null;
  } else if (type === "integer") {
    const value = string(obj["value"]);
    return BigInt(value);
  } else if (type === "float") {
    return number(obj["value"]);
  } else if (type === "text") {
    return string(obj["value"]);
  } else if (type === "blob") {
    return gBase64.toUint8Array(string(obj["base64"]));
  } else {
    throw new ProtoError("Unexpected type of Value");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/ws/json_decode.js
function ServerMsg(obj) {
  const type = string(obj["type"]);
  if (type === "hello_ok") {
    return { type: "hello_ok" };
  } else if (type === "hello_error") {
    const error = Error2(object(obj["error"]));
    return { type: "hello_error", error };
  } else if (type === "response_ok") {
    const requestId = number(obj["request_id"]);
    const response = Response(object(obj["response"]));
    return { type: "response_ok", requestId, response };
  } else if (type === "response_error") {
    const requestId = number(obj["request_id"]);
    const error = Error2(object(obj["error"]));
    return { type: "response_error", requestId, error };
  } else {
    throw new ProtoError("Unexpected type of ServerMsg");
  }
}
function Response(obj) {
  const type = string(obj["type"]);
  if (type === "open_stream") {
    return { type: "open_stream" };
  } else if (type === "close_stream") {
    return { type: "close_stream" };
  } else if (type === "execute") {
    const result = StmtResult(object(obj["result"]));
    return { type: "execute", result };
  } else if (type === "batch") {
    const result = BatchResult(object(obj["result"]));
    return { type: "batch", result };
  } else if (type === "open_cursor") {
    return { type: "open_cursor" };
  } else if (type === "close_cursor") {
    return { type: "close_cursor" };
  } else if (type === "fetch_cursor") {
    const entries = arrayObjectsMap(obj["entries"], CursorEntry);
    const done = boolean(obj["done"]);
    return { type: "fetch_cursor", entries, done };
  } else if (type === "sequence") {
    return { type: "sequence" };
  } else if (type === "describe") {
    const result = DescribeResult(object(obj["result"]));
    return { type: "describe", result };
  } else if (type === "store_sql") {
    return { type: "store_sql" };
  } else if (type === "close_sql") {
    return { type: "close_sql" };
  } else if (type === "get_autocommit") {
    const isAutocommit = boolean(obj["is_autocommit"]);
    return { type: "get_autocommit", isAutocommit };
  } else {
    throw new ProtoError("Unexpected type of Response");
  }
}

// node_modules/@libsql/hrana-client/lib-esm/shared/protobuf_decode.js
var Error3 = {
  default() {
    return { message: "", code: void 0 };
  },
  1(r, msg) {
    msg.message = r.string();
  },
  2(r, msg) {
    msg.code = r.string();
  }
};
var StmtResult2 = {
  default() {
    return {
      cols: [],
      rows: [],
      affectedRowCount: 0,
      lastInsertRowid: void 0
    };
  },
  1(r, msg) {
    msg.cols.push(r.message(Col2));
  },
  2(r, msg) {
    msg.rows.push(r.message(Row));
  },
  3(r, msg) {
    msg.affectedRowCount = Number(r.uint64());
  },
  4(r, msg) {
    msg.lastInsertRowid = r.sint64();
  }
};
var Col2 = {
  default() {
    return { name: void 0, decltype: void 0 };
  },
  1(r, msg) {
    msg.name = r.string();
  },
  2(r, msg) {
    msg.decltype = r.string();
  }
};
var Row = {
  default() {
    return [];
  },
  1(r, msg) {
    msg.push(r.message(Value4));
  }
};
var BatchResult2 = {
  default() {
    return { stepResults: /* @__PURE__ */ new Map(), stepErrors: /* @__PURE__ */ new Map() };
  },
  1(r, msg) {
    const [key, value] = r.message(BatchResultStepResult);
    msg.stepResults.set(key, value);
  },
  2(r, msg) {
    const [key, value] = r.message(BatchResultStepError);
    msg.stepErrors.set(key, value);
  }
};
var BatchResultStepResult = {
  default() {
    return [0, StmtResult2.default()];
  },
  1(r, msg) {
    msg[0] = r.uint32();
  },
  2(r, msg) {
    msg[1] = r.message(StmtResult2);
  }
};
var BatchResultStepError = {
  default() {
    return [0, Error3.default()];
  },
  1(r, msg) {
    msg[0] = r.uint32();
  },
  2(r, msg) {
    msg[1] = r.message(Error3);
  }
};
var CursorEntry2 = {
  default() {
    return { type: "none" };
  },
  1(r) {
    return r.message(StepBeginEntry);
  },
  2(r) {
    return r.message(StepEndEntry);
  },
  3(r) {
    return r.message(StepErrorEntry);
  },
  4(r) {
    return { type: "row", row: r.message(Row) };
  },
  5(r) {
    return { type: "error", error: r.message(Error3) };
  }
};
var StepBeginEntry = {
  default() {
    return { type: "step_begin", step: 0, cols: [] };
  },
  1(r, msg) {
    msg.step = r.uint32();
  },
  2(r, msg) {
    msg.cols.push(r.message(Col2));
  }
};
var StepEndEntry = {
  default() {
    return {
      type: "step_end",
      affectedRowCount: 0,
      lastInsertRowid: void 0
    };
  },
  1(r, msg) {
    msg.affectedRowCount = r.uint32();
  },
  2(r, msg) {
    msg.lastInsertRowid = r.uint64();
  }
};
var StepErrorEntry = {
  default() {
    return {
      type: "step_error",
      step: 0,
      error: Error3.default()
    };
  },
  1(r, msg) {
    msg.step = r.uint32();
  },
  2(r, msg) {
    msg.error = r.message(Error3);
  }
};
var DescribeResult2 = {
  default() {
    return {
      params: [],
      cols: [],
      isExplain: false,
      isReadonly: false
    };
  },
  1(r, msg) {
    msg.params.push(r.message(DescribeParam2));
  },
  2(r, msg) {
    msg.cols.push(r.message(DescribeCol2));
  },
  3(r, msg) {
    msg.isExplain = r.bool();
  },
  4(r, msg) {
    msg.isReadonly = r.bool();
  }
};
var DescribeParam2 = {
  default() {
    return { name: void 0 };
  },
  1(r, msg) {
    msg.name = r.string();
  }
};
var DescribeCol2 = {
  default() {
    return { name: "", decltype: void 0 };
  },
  1(r, msg) {
    msg.name = r.string();
  },
  2(r, msg) {
    msg.decltype = r.string();
  }
};
var Value4 = {
  default() {
    return void 0;
  },
  1(r) {
    return null;
  },
  2(r) {
    return r.sint64();
  },
  3(r) {
    return r.double();
  },
  4(r) {
    return r.string();
  },
  5(r) {
    return r.bytes();
  }
};

// node_modules/@libsql/hrana-client/lib-esm/ws/protobuf_decode.js
var ServerMsg2 = {
  default() {
    return { type: "none" };
  },
  1(r) {
    return { type: "hello_ok" };
  },
  2(r) {
    return r.message(HelloErrorMsg);
  },
  3(r) {
    return r.message(ResponseOkMsg);
  },
  4(r) {
    return r.message(ResponseErrorMsg);
  }
};
var HelloErrorMsg = {
  default() {
    return { type: "hello_error", error: Error3.default() };
  },
  1(r, msg) {
    msg.error = r.message(Error3);
  }
};
var ResponseErrorMsg = {
  default() {
    return { type: "response_error", requestId: 0, error: Error3.default() };
  },
  1(r, msg) {
    msg.requestId = r.int32();
  },
  2(r, msg) {
    msg.error = r.message(Error3);
  }
};
var ResponseOkMsg = {
  default() {
    return {
      type: "response_ok",
      requestId: 0,
      response: { type: "none" }
    };
  },
  1(r, msg) {
    msg.requestId = r.int32();
  },
  2(r, msg) {
    msg.response = { type: "open_stream" };
  },
  3(r, msg) {
    msg.response = { type: "close_stream" };
  },
  4(r, msg) {
    msg.response = r.message(ExecuteResp);
  },
  5(r, msg) {
    msg.response = r.message(BatchResp);
  },
  6(r, msg) {
    msg.response = { type: "open_cursor" };
  },
  7(r, msg) {
    msg.response = { type: "close_cursor" };
  },
  8(r, msg) {
    msg.response = r.message(FetchCursorResp);
  },
  9(r, msg) {
    msg.response = { type: "sequence" };
  },
  10(r, msg) {
    msg.response = r.message(DescribeResp);
  },
  11(r, msg) {
    msg.response = { type: "store_sql" };
  },
  12(r, msg) {
    msg.response = { type: "close_sql" };
  },
  13(r, msg) {
    msg.response = r.message(GetAutocommitResp);
  }
};
var ExecuteResp = {
  default() {
    return { type: "execute", result: StmtResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(StmtResult2);
  }
};
var BatchResp = {
  default() {
    return { type: "batch", result: BatchResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(BatchResult2);
  }
};
var FetchCursorResp = {
  default() {
    return { type: "fetch_cursor", entries: [], done: false };
  },
  1(r, msg) {
    msg.entries.push(r.message(CursorEntry2));
  },
  2(r, msg) {
    msg.done = r.bool();
  }
};
var DescribeResp = {
  default() {
    return { type: "describe", result: DescribeResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(DescribeResult2);
  }
};
var GetAutocommitResp = {
  default() {
    return { type: "get_autocommit", isAutocommit: false };
  },
  1(r, msg) {
    msg.isAutocommit = r.bool();
  }
};

// node_modules/@libsql/hrana-client/lib-esm/ws/client.js
var subprotocolsV2 = /* @__PURE__ */ new Map([
  ["hrana2", { version: 2, encoding: "json" }],
  ["hrana1", { version: 1, encoding: "json" }]
]);
var subprotocolsV3 = /* @__PURE__ */ new Map([
  ["hrana3-protobuf", { version: 3, encoding: "protobuf" }],
  ["hrana3", { version: 3, encoding: "json" }],
  ["hrana2", { version: 2, encoding: "json" }],
  ["hrana1", { version: 1, encoding: "json" }]
]);
var WsClient = class extends Client {
  #socket;
  // List of callbacks that we queue until the socket transitions from the CONNECTING to the OPEN state.
  #openCallbacks;
  // Have we already transitioned from CONNECTING to OPEN and fired the callbacks in #openCallbacks?
  #opened;
  // Stores the error that caused us to close the client (and the socket). If we are not closed, this is
  // `undefined`.
  #closed;
  // Have we received a response to our "hello" from the server?
  #recvdHello;
  // Subprotocol negotiated with the server. It is only available after the socket transitions to the OPEN
  // state.
  #subprotocol;
  // Has the `getVersion()` function been called? This is only used to validate that the API is used
  // correctly.
  #getVersionCalled;
  // A map from request id to the responses that we expect to receive from the server.
  #responseMap;
  // An allocator of request ids.
  #requestIdAlloc;
  // An allocator of stream ids.
  /** @private */
  _streamIdAlloc;
  // An allocator of cursor ids.
  /** @private */
  _cursorIdAlloc;
  // An allocator of SQL text ids.
  #sqlIdAlloc;
  /** @private */
  constructor(socket, jwt) {
    super();
    this.#socket = socket;
    this.#openCallbacks = [];
    this.#opened = false;
    this.#closed = void 0;
    this.#recvdHello = false;
    this.#subprotocol = void 0;
    this.#getVersionCalled = false;
    this.#responseMap = /* @__PURE__ */ new Map();
    this.#requestIdAlloc = new IdAlloc();
    this._streamIdAlloc = new IdAlloc();
    this._cursorIdAlloc = new IdAlloc();
    this.#sqlIdAlloc = new IdAlloc();
    this.#socket.binaryType = "arraybuffer";
    this.#socket.addEventListener("open", () => this.#onSocketOpen());
    this.#socket.addEventListener("close", (event) => this.#onSocketClose(event));
    this.#socket.addEventListener("error", (event) => this.#onSocketError(event));
    this.#socket.addEventListener("message", (event) => this.#onSocketMessage(event));
    this.#send({ type: "hello", jwt });
  }
  // Send (or enqueue to send) a message to the server.
  #send(msg) {
    if (this.#closed !== void 0) {
      throw new InternalError("Trying to send a message on a closed client");
    }
    if (this.#opened) {
      this.#sendToSocket(msg);
    } else {
      const openCallback = () => this.#sendToSocket(msg);
      const errorCallback = () => void 0;
      this.#openCallbacks.push({ openCallback, errorCallback });
    }
  }
  // The socket transitioned from CONNECTING to OPEN
  #onSocketOpen() {
    const protocol = this.#socket.protocol;
    if (protocol === void 0) {
      this.#setClosed(new ClientError("The `WebSocket.protocol` property is undefined. This most likely means that the WebSocket implementation provided by the environment is broken. If you are using Miniflare 2, please update to Miniflare 3, which fixes this problem."));
      return;
    } else if (protocol === "") {
      this.#subprotocol = { version: 1, encoding: "json" };
    } else {
      this.#subprotocol = subprotocolsV3.get(protocol);
      if (this.#subprotocol === void 0) {
        this.#setClosed(new ProtoError(`Unrecognized WebSocket subprotocol: ${JSON.stringify(protocol)}`));
        return;
      }
    }
    for (const callbacks of this.#openCallbacks) {
      callbacks.openCallback();
    }
    this.#openCallbacks.length = 0;
    this.#opened = true;
  }
  #sendToSocket(msg) {
    const encoding = this.#subprotocol.encoding;
    if (encoding === "json") {
      const jsonMsg = writeJsonObject(msg, ClientMsg);
      this.#socket.send(jsonMsg);
    } else if (encoding === "protobuf") {
      const protobufMsg = writeProtobufMessage(msg, ClientMsg2);
      this.#socket.send(protobufMsg);
    } else {
      throw impossible(encoding, "Impossible encoding");
    }
  }
  /** Get the protocol version negotiated with the server, possibly waiting until the socket is open. */
  getVersion() {
    return new Promise((versionCallback, errorCallback) => {
      this.#getVersionCalled = true;
      if (this.#closed !== void 0) {
        errorCallback(this.#closed);
      } else if (!this.#opened) {
        const openCallback = () => versionCallback(this.#subprotocol.version);
        this.#openCallbacks.push({ openCallback, errorCallback });
      } else {
        versionCallback(this.#subprotocol.version);
      }
    });
  }
  // Make sure that the negotiated version is at least `minVersion`.
  /** @private */
  _ensureVersion(minVersion, feature) {
    if (this.#subprotocol === void 0 || !this.#getVersionCalled) {
      throw new ProtocolVersionError(`${feature} is supported only on protocol version ${minVersion} and higher, but the version supported by the WebSocket server is not yet known. Use Client.getVersion() to wait until the version is available.`);
    } else if (this.#subprotocol.version < minVersion) {
      throw new ProtocolVersionError(`${feature} is supported on protocol version ${minVersion} and higher, but the WebSocket server only supports version ${this.#subprotocol.version}`);
    }
  }
  // Send a request to the server and invoke a callback when we get the response.
  /** @private */
  _sendRequest(request, callbacks) {
    if (this.#closed !== void 0) {
      callbacks.errorCallback(new ClosedError("Client is closed", this.#closed));
      return;
    }
    const requestId = this.#requestIdAlloc.alloc();
    this.#responseMap.set(requestId, { ...callbacks, type: request.type });
    this.#send({ type: "request", requestId, request });
  }
  // The socket encountered an error.
  #onSocketError(event) {
    const eventMessage = event.message;
    const message = eventMessage ?? "WebSocket was closed due to an error";
    this.#setClosed(new WebSocketError(message));
  }
  // The socket was closed.
  #onSocketClose(event) {
    let message = `WebSocket was closed with code ${event.code}`;
    if (event.reason) {
      message += `: ${event.reason}`;
    }
    this.#setClosed(new WebSocketError(message));
  }
  // Close the client with the given error.
  #setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    for (const callbacks of this.#openCallbacks) {
      callbacks.errorCallback(error);
    }
    this.#openCallbacks.length = 0;
    for (const [requestId, responseState] of this.#responseMap.entries()) {
      responseState.errorCallback(error);
      this.#requestIdAlloc.free(requestId);
    }
    this.#responseMap.clear();
    this.#socket.close();
  }
  // We received a message from the socket.
  #onSocketMessage(event) {
    if (this.#closed !== void 0) {
      return;
    }
    try {
      let msg;
      const encoding = this.#subprotocol.encoding;
      if (encoding === "json") {
        if (typeof event.data !== "string") {
          this.#socket.close(3003, "Only text messages are accepted with JSON encoding");
          this.#setClosed(new ProtoError("Received non-text message from server with JSON encoding"));
          return;
        }
        msg = readJsonObject(JSON.parse(event.data), ServerMsg);
      } else if (encoding === "protobuf") {
        if (!(event.data instanceof ArrayBuffer)) {
          this.#socket.close(3003, "Only binary messages are accepted with Protobuf encoding");
          this.#setClosed(new ProtoError("Received non-binary message from server with Protobuf encoding"));
          return;
        }
        msg = readProtobufMessage(new Uint8Array(event.data), ServerMsg2);
      } else {
        throw impossible(encoding, "Impossible encoding");
      }
      this.#handleMsg(msg);
    } catch (e) {
      this.#socket.close(3007, "Could not handle message");
      this.#setClosed(e);
    }
  }
  // Handle a message from the server.
  #handleMsg(msg) {
    if (msg.type === "none") {
      throw new ProtoError("Received an unrecognized ServerMsg");
    } else if (msg.type === "hello_ok" || msg.type === "hello_error") {
      if (this.#recvdHello) {
        throw new ProtoError("Received a duplicated hello response");
      }
      this.#recvdHello = true;
      if (msg.type === "hello_error") {
        throw errorFromProto(msg.error);
      }
      return;
    } else if (!this.#recvdHello) {
      throw new ProtoError("Received a non-hello message before a hello response");
    }
    if (msg.type === "response_ok") {
      const requestId = msg.requestId;
      const responseState = this.#responseMap.get(requestId);
      this.#responseMap.delete(requestId);
      if (responseState === void 0) {
        throw new ProtoError("Received unexpected OK response");
      }
      this.#requestIdAlloc.free(requestId);
      try {
        if (responseState.type !== msg.response.type) {
          console.dir({ responseState, msg });
          throw new ProtoError("Received unexpected type of response");
        }
        responseState.responseCallback(msg.response);
      } catch (e) {
        responseState.errorCallback(e);
        throw e;
      }
    } else if (msg.type === "response_error") {
      const requestId = msg.requestId;
      const responseState = this.#responseMap.get(requestId);
      this.#responseMap.delete(requestId);
      if (responseState === void 0) {
        throw new ProtoError("Received unexpected error response");
      }
      this.#requestIdAlloc.free(requestId);
      responseState.errorCallback(errorFromProto(msg.error));
    } else {
      throw impossible(msg, "Impossible ServerMsg type");
    }
  }
  /** Open a {@link WsStream}, a stream for executing SQL statements. */
  openStream() {
    return WsStream.open(this);
  }
  /** Cache a SQL text on the server. This requires protocol version 2 or higher. */
  storeSql(sql) {
    this._ensureVersion(2, "storeSql()");
    const sqlId = this.#sqlIdAlloc.alloc();
    const sqlObj = new Sql(this, sqlId);
    const responseCallback = () => void 0;
    const errorCallback = (e) => sqlObj._setClosed(e);
    const request = { type: "store_sql", sqlId, sql };
    this._sendRequest(request, { responseCallback, errorCallback });
    return sqlObj;
  }
  /** @private */
  _closeSql(sqlId) {
    if (this.#closed !== void 0) {
      return;
    }
    const responseCallback = () => this.#sqlIdAlloc.free(sqlId);
    const errorCallback = (e) => this.#setClosed(e);
    const request = { type: "close_sql", sqlId };
    this._sendRequest(request, { responseCallback, errorCallback });
  }
  /** Close the client and the WebSocket. */
  close() {
    this.#setClosed(new ClientError("Client was manually closed"));
  }
  /** True if the client is closed. */
  get closed() {
    return this.#closed !== void 0;
  }
};

// node_modules/@libsql/hrana-client/lib-esm/queue_microtask.js
var _queueMicrotask;
if (typeof queueMicrotask !== "undefined") {
  _queueMicrotask = queueMicrotask;
} else {
  const resolved = Promise.resolve();
  _queueMicrotask = (callback) => {
    resolved.then(callback);
  };
}

// node_modules/@libsql/hrana-client/lib-esm/byte_queue.js
var ByteQueue = class {
  #array;
  #shiftPos;
  #pushPos;
  constructor(initialCap) {
    this.#array = new Uint8Array(new ArrayBuffer(initialCap));
    this.#shiftPos = 0;
    this.#pushPos = 0;
  }
  get length() {
    return this.#pushPos - this.#shiftPos;
  }
  data() {
    return this.#array.slice(this.#shiftPos, this.#pushPos);
  }
  push(chunk) {
    this.#ensurePush(chunk.byteLength);
    this.#array.set(chunk, this.#pushPos);
    this.#pushPos += chunk.byteLength;
  }
  #ensurePush(pushLength) {
    if (this.#pushPos + pushLength <= this.#array.byteLength) {
      return;
    }
    const filledLength = this.#pushPos - this.#shiftPos;
    if (filledLength + pushLength <= this.#array.byteLength && 2 * this.#pushPos >= this.#array.byteLength) {
      this.#array.copyWithin(0, this.#shiftPos, this.#pushPos);
    } else {
      let newCap = this.#array.byteLength;
      do {
        newCap *= 2;
      } while (filledLength + pushLength > newCap);
      const newArray = new Uint8Array(new ArrayBuffer(newCap));
      newArray.set(this.#array.slice(this.#shiftPos, this.#pushPos), 0);
      this.#array = newArray;
    }
    this.#pushPos = filledLength;
    this.#shiftPos = 0;
  }
  shift(length) {
    this.#shiftPos += length;
  }
};

// node_modules/@libsql/hrana-client/lib-esm/http/json_decode.js
function PipelineRespBody(obj) {
  const baton = stringOpt(obj["baton"]);
  const baseUrl = stringOpt(obj["base_url"]);
  const results = arrayObjectsMap(obj["results"], StreamResult);
  return { baton, baseUrl, results };
}
function StreamResult(obj) {
  const type = string(obj["type"]);
  if (type === "ok") {
    const response = StreamResponse(object(obj["response"]));
    return { type: "ok", response };
  } else if (type === "error") {
    const error = Error2(object(obj["error"]));
    return { type: "error", error };
  } else {
    throw new ProtoError("Unexpected type of StreamResult");
  }
}
function StreamResponse(obj) {
  const type = string(obj["type"]);
  if (type === "close") {
    return { type: "close" };
  } else if (type === "execute") {
    const result = StmtResult(object(obj["result"]));
    return { type: "execute", result };
  } else if (type === "batch") {
    const result = BatchResult(object(obj["result"]));
    return { type: "batch", result };
  } else if (type === "sequence") {
    return { type: "sequence" };
  } else if (type === "describe") {
    const result = DescribeResult(object(obj["result"]));
    return { type: "describe", result };
  } else if (type === "store_sql") {
    return { type: "store_sql" };
  } else if (type === "close_sql") {
    return { type: "close_sql" };
  } else if (type === "get_autocommit") {
    const isAutocommit = boolean(obj["is_autocommit"]);
    return { type: "get_autocommit", isAutocommit };
  } else {
    throw new ProtoError("Unexpected type of StreamResponse");
  }
}
function CursorRespBody(obj) {
  const baton = stringOpt(obj["baton"]);
  const baseUrl = stringOpt(obj["base_url"]);
  return { baton, baseUrl };
}

// node_modules/@libsql/hrana-client/lib-esm/http/protobuf_decode.js
var PipelineRespBody2 = {
  default() {
    return { baton: void 0, baseUrl: void 0, results: [] };
  },
  1(r, msg) {
    msg.baton = r.string();
  },
  2(r, msg) {
    msg.baseUrl = r.string();
  },
  3(r, msg) {
    msg.results.push(r.message(StreamResult2));
  }
};
var StreamResult2 = {
  default() {
    return { type: "none" };
  },
  1(r) {
    return { type: "ok", response: r.message(StreamResponse2) };
  },
  2(r) {
    return { type: "error", error: r.message(Error3) };
  }
};
var StreamResponse2 = {
  default() {
    return { type: "none" };
  },
  1(r) {
    return { type: "close" };
  },
  2(r) {
    return r.message(ExecuteStreamResp);
  },
  3(r) {
    return r.message(BatchStreamResp);
  },
  4(r) {
    return { type: "sequence" };
  },
  5(r) {
    return r.message(DescribeStreamResp);
  },
  6(r) {
    return { type: "store_sql" };
  },
  7(r) {
    return { type: "close_sql" };
  },
  8(r) {
    return r.message(GetAutocommitStreamResp);
  }
};
var ExecuteStreamResp = {
  default() {
    return { type: "execute", result: StmtResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(StmtResult2);
  }
};
var BatchStreamResp = {
  default() {
    return { type: "batch", result: BatchResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(BatchResult2);
  }
};
var DescribeStreamResp = {
  default() {
    return { type: "describe", result: DescribeResult2.default() };
  },
  1(r, msg) {
    msg.result = r.message(DescribeResult2);
  }
};
var GetAutocommitStreamResp = {
  default() {
    return { type: "get_autocommit", isAutocommit: false };
  },
  1(r, msg) {
    msg.isAutocommit = r.bool();
  }
};
var CursorRespBody2 = {
  default() {
    return { baton: void 0, baseUrl: void 0 };
  },
  1(r, msg) {
    msg.baton = r.string();
  },
  2(r, msg) {
    msg.baseUrl = r.string();
  }
};

// node_modules/@libsql/hrana-client/lib-esm/http/cursor.js
var HttpCursor = class extends Cursor {
  #stream;
  #encoding;
  #reader;
  #queue;
  #closed;
  #done;
  /** @private */
  constructor(stream, encoding) {
    super();
    this.#stream = stream;
    this.#encoding = encoding;
    this.#reader = void 0;
    this.#queue = new ByteQueue(16 * 1024);
    this.#closed = void 0;
    this.#done = false;
  }
  async open(response) {
    if (response.body === null) {
      throw new ProtoError("No response body for cursor request");
    }
    this.#reader = response.body[Symbol.asyncIterator]();
    const respBody = await this.#nextItem(CursorRespBody, CursorRespBody2);
    if (respBody === void 0) {
      throw new ProtoError("Empty response to cursor request");
    }
    return respBody;
  }
  /** Fetch the next entry from the cursor. */
  next() {
    return this.#nextItem(CursorEntry, CursorEntry2);
  }
  /** Close the cursor. */
  close() {
    this._setClosed(new ClientError("Cursor was manually closed"));
  }
  /** @private */
  _setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    this.#stream._cursorClosed(this);
    if (this.#reader !== void 0) {
      this.#reader.return();
    }
  }
  /** True if the cursor is closed. */
  get closed() {
    return this.#closed !== void 0;
  }
  async #nextItem(jsonFun, protobufDef) {
    for (; ; ) {
      if (this.#done) {
        return void 0;
      } else if (this.#closed !== void 0) {
        throw new ClosedError("Cursor is closed", this.#closed);
      }
      if (this.#encoding === "json") {
        const jsonData = this.#parseItemJson();
        if (jsonData !== void 0) {
          const jsonText = new TextDecoder().decode(jsonData);
          const jsonValue = JSON.parse(jsonText);
          return readJsonObject(jsonValue, jsonFun);
        }
      } else if (this.#encoding === "protobuf") {
        const protobufData = this.#parseItemProtobuf();
        if (protobufData !== void 0) {
          return readProtobufMessage(protobufData, protobufDef);
        }
      } else {
        throw impossible(this.#encoding, "Impossible encoding");
      }
      if (this.#reader === void 0) {
        throw new InternalError("Attempted to read from HTTP cursor before it was opened");
      }
      const { value, done } = await this.#reader.next();
      if (done && this.#queue.length === 0) {
        this.#done = true;
      } else if (done) {
        throw new ProtoError("Unexpected end of cursor stream");
      } else {
        this.#queue.push(value);
      }
    }
  }
  #parseItemJson() {
    const data = this.#queue.data();
    const newlineByte = 10;
    const newlinePos = data.indexOf(newlineByte);
    if (newlinePos < 0) {
      return void 0;
    }
    const jsonData = data.slice(0, newlinePos);
    this.#queue.shift(newlinePos + 1);
    return jsonData;
  }
  #parseItemProtobuf() {
    const data = this.#queue.data();
    let varintValue = 0;
    let varintLength = 0;
    for (; ; ) {
      if (varintLength >= data.byteLength) {
        return void 0;
      }
      const byte = data[varintLength];
      varintValue |= (byte & 127) << 7 * varintLength;
      varintLength += 1;
      if (!(byte & 128)) {
        break;
      }
    }
    if (data.byteLength < varintLength + varintValue) {
      return void 0;
    }
    const protobufData = data.slice(varintLength, varintLength + varintValue);
    this.#queue.shift(varintLength + varintValue);
    return protobufData;
  }
};

// node_modules/@libsql/hrana-client/lib-esm/http/json_encode.js
function PipelineReqBody(w, msg) {
  if (msg.baton !== void 0) {
    w.string("baton", msg.baton);
  }
  w.arrayObjects("requests", msg.requests, StreamRequest);
}
function StreamRequest(w, msg) {
  w.stringRaw("type", msg.type);
  if (msg.type === "close") {
  } else if (msg.type === "execute") {
    w.object("stmt", msg.stmt, Stmt2);
  } else if (msg.type === "batch") {
    w.object("batch", msg.batch, Batch2);
  } else if (msg.type === "sequence") {
    if (msg.sql !== void 0) {
      w.string("sql", msg.sql);
    }
    if (msg.sqlId !== void 0) {
      w.number("sql_id", msg.sqlId);
    }
  } else if (msg.type === "describe") {
    if (msg.sql !== void 0) {
      w.string("sql", msg.sql);
    }
    if (msg.sqlId !== void 0) {
      w.number("sql_id", msg.sqlId);
    }
  } else if (msg.type === "store_sql") {
    w.number("sql_id", msg.sqlId);
    w.string("sql", msg.sql);
  } else if (msg.type === "close_sql") {
    w.number("sql_id", msg.sqlId);
  } else if (msg.type === "get_autocommit") {
  } else {
    throw impossible(msg, "Impossible type of StreamRequest");
  }
}
function CursorReqBody(w, msg) {
  if (msg.baton !== void 0) {
    w.string("baton", msg.baton);
  }
  w.object("batch", msg.batch, Batch2);
}

// node_modules/@libsql/hrana-client/lib-esm/http/protobuf_encode.js
function PipelineReqBody2(w, msg) {
  if (msg.baton !== void 0) {
    w.string(1, msg.baton);
  }
  for (const req of msg.requests) {
    w.message(2, req, StreamRequest2);
  }
}
function StreamRequest2(w, msg) {
  if (msg.type === "close") {
    w.message(1, msg, CloseStreamReq2);
  } else if (msg.type === "execute") {
    w.message(2, msg, ExecuteStreamReq);
  } else if (msg.type === "batch") {
    w.message(3, msg, BatchStreamReq);
  } else if (msg.type === "sequence") {
    w.message(4, msg, SequenceStreamReq);
  } else if (msg.type === "describe") {
    w.message(5, msg, DescribeStreamReq);
  } else if (msg.type === "store_sql") {
    w.message(6, msg, StoreSqlStreamReq);
  } else if (msg.type === "close_sql") {
    w.message(7, msg, CloseSqlStreamReq);
  } else if (msg.type === "get_autocommit") {
    w.message(8, msg, GetAutocommitStreamReq);
  } else {
    throw impossible(msg, "Impossible type of StreamRequest");
  }
}
function CloseStreamReq2(_w, _msg) {
}
function ExecuteStreamReq(w, msg) {
  w.message(1, msg.stmt, Stmt3);
}
function BatchStreamReq(w, msg) {
  w.message(1, msg.batch, Batch3);
}
function SequenceStreamReq(w, msg) {
  if (msg.sql !== void 0) {
    w.string(1, msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.int32(2, msg.sqlId);
  }
}
function DescribeStreamReq(w, msg) {
  if (msg.sql !== void 0) {
    w.string(1, msg.sql);
  }
  if (msg.sqlId !== void 0) {
    w.int32(2, msg.sqlId);
  }
}
function StoreSqlStreamReq(w, msg) {
  w.int32(1, msg.sqlId);
  w.string(2, msg.sql);
}
function CloseSqlStreamReq(w, msg) {
  w.int32(1, msg.sqlId);
}
function GetAutocommitStreamReq(_w, _msg) {
}
function CursorReqBody2(w, msg) {
  if (msg.baton !== void 0) {
    w.string(1, msg.baton);
  }
  w.message(2, msg.batch, Batch3);
}

// node_modules/@libsql/hrana-client/lib-esm/http/stream.js
var HttpStream = class extends Stream {
  #client;
  #baseUrl;
  #jwt;
  #fetch;
  #remoteEncryptionKey;
  #baton;
  #queue;
  #flushing;
  #cursor;
  #closing;
  #closeQueued;
  #closed;
  #sqlIdAlloc;
  /** @private */
  constructor(client, baseUrl, jwt, customFetch, remoteEncryptionKey) {
    super(client.intMode);
    this.#client = client;
    this.#baseUrl = baseUrl.toString();
    this.#jwt = jwt;
    this.#fetch = customFetch;
    this.#remoteEncryptionKey = remoteEncryptionKey;
    this.#baton = void 0;
    this.#queue = new Queue();
    this.#flushing = false;
    this.#closing = false;
    this.#closeQueued = false;
    this.#closed = void 0;
    this.#sqlIdAlloc = new IdAlloc();
  }
  /** Get the {@link HttpClient} object that this stream belongs to. */
  client() {
    return this.#client;
  }
  /** @private */
  _sqlOwner() {
    return this;
  }
  /** Cache a SQL text on the server. */
  storeSql(sql) {
    const sqlId = this.#sqlIdAlloc.alloc();
    this.#sendStreamRequest({ type: "store_sql", sqlId, sql }).then(() => void 0, (error) => this._setClosed(error));
    return new Sql(this, sqlId);
  }
  /** @private */
  _closeSql(sqlId) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#sendStreamRequest({ type: "close_sql", sqlId }).then(() => this.#sqlIdAlloc.free(sqlId), (error) => this._setClosed(error));
  }
  /** @private */
  _execute(stmt) {
    return this.#sendStreamRequest({ type: "execute", stmt }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _batch(batch) {
    return this.#sendStreamRequest({ type: "batch", batch }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _describe(protoSql) {
    return this.#sendStreamRequest({
      type: "describe",
      sql: protoSql.sql,
      sqlId: protoSql.sqlId
    }).then((response) => {
      return response.result;
    });
  }
  /** @private */
  _sequence(protoSql) {
    return this.#sendStreamRequest({
      type: "sequence",
      sql: protoSql.sql,
      sqlId: protoSql.sqlId
    }).then((_response) => {
      return void 0;
    });
  }
  /** Check whether the SQL connection underlying this stream is in autocommit state (i.e., outside of an
   * explicit transaction). This requires protocol version 3 or higher.
   */
  getAutocommit() {
    this.#client._ensureVersion(3, "getAutocommit()");
    return this.#sendStreamRequest({
      type: "get_autocommit"
    }).then((response) => {
      return response.isAutocommit;
    });
  }
  #sendStreamRequest(request) {
    return new Promise((responseCallback, errorCallback) => {
      this.#pushToQueue({ type: "pipeline", request, responseCallback, errorCallback });
    });
  }
  /** @private */
  _openCursor(batch) {
    return new Promise((cursorCallback, errorCallback) => {
      this.#pushToQueue({ type: "cursor", batch, cursorCallback, errorCallback });
    });
  }
  /** @private */
  _cursorClosed(cursor) {
    if (cursor !== this.#cursor) {
      throw new InternalError("Cursor was closed, but it was not associated with the stream");
    }
    this.#cursor = void 0;
    _queueMicrotask(() => this.#flushQueue());
  }
  /** Immediately close the stream. */
  close() {
    this._setClosed(new ClientError("Stream was manually closed"));
  }
  /** Gracefully close the stream. */
  closeGracefully() {
    this.#closing = true;
    _queueMicrotask(() => this.#flushQueue());
  }
  /** True if the stream is closed. */
  get closed() {
    return this.#closed !== void 0 || this.#closing;
  }
  /** @private */
  _setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    if (this.#cursor !== void 0) {
      this.#cursor._setClosed(error);
    }
    this.#client._streamClosed(this);
    for (; ; ) {
      const entry = this.#queue.shift();
      if (entry !== void 0) {
        entry.errorCallback(error);
      } else {
        break;
      }
    }
    if ((this.#baton !== void 0 || this.#flushing) && !this.#closeQueued) {
      this.#queue.push({
        type: "pipeline",
        request: { type: "close" },
        responseCallback: () => void 0,
        errorCallback: () => void 0
      });
      this.#closeQueued = true;
      _queueMicrotask(() => this.#flushQueue());
    }
  }
  #pushToQueue(entry) {
    if (this.#closed !== void 0) {
      throw new ClosedError("Stream is closed", this.#closed);
    } else if (this.#closing) {
      throw new ClosedError("Stream is closing", void 0);
    } else {
      this.#queue.push(entry);
      _queueMicrotask(() => this.#flushQueue());
    }
  }
  #flushQueue() {
    if (this.#flushing || this.#cursor !== void 0) {
      return;
    }
    if (this.#closing && this.#queue.length === 0) {
      this._setClosed(new ClientError("Stream was gracefully closed"));
      return;
    }
    const endpoint = this.#client._endpoint;
    if (endpoint === void 0) {
      this.#client._endpointPromise.then(() => this.#flushQueue(), (error) => this._setClosed(error));
      return;
    }
    const firstEntry = this.#queue.shift();
    if (firstEntry === void 0) {
      return;
    } else if (firstEntry.type === "pipeline") {
      const pipeline = [firstEntry];
      for (; ; ) {
        const entry = this.#queue.first();
        if (entry !== void 0 && entry.type === "pipeline") {
          pipeline.push(entry);
          this.#queue.shift();
        } else if (entry === void 0 && this.#closing && !this.#closeQueued) {
          pipeline.push({
            type: "pipeline",
            request: { type: "close" },
            responseCallback: () => void 0,
            errorCallback: () => void 0
          });
          this.#closeQueued = true;
          break;
        } else {
          break;
        }
      }
      this.#flushPipeline(endpoint, pipeline);
    } else if (firstEntry.type === "cursor") {
      this.#flushCursor(endpoint, firstEntry);
    } else {
      throw impossible(firstEntry, "Impossible type of QueueEntry");
    }
  }
  #flushPipeline(endpoint, pipeline) {
    this.#flush(() => this.#createPipelineRequest(pipeline, endpoint), (resp) => decodePipelineResponse(resp, endpoint.encoding), (respBody) => respBody.baton, (respBody) => respBody.baseUrl, (respBody) => handlePipelineResponse(pipeline, respBody), (error) => pipeline.forEach((entry) => entry.errorCallback(error)));
  }
  #flushCursor(endpoint, entry) {
    const cursor = new HttpCursor(this, endpoint.encoding);
    this.#cursor = cursor;
    this.#flush(() => this.#createCursorRequest(entry, endpoint), (resp) => cursor.open(resp), (respBody) => respBody.baton, (respBody) => respBody.baseUrl, (_respBody) => entry.cursorCallback(cursor), (error) => entry.errorCallback(error));
  }
  #flush(createRequest, decodeResponse, getBaton, getBaseUrl, handleResponse, handleError) {
    let promise;
    try {
      const request = createRequest();
      const fetch2 = this.#fetch;
      promise = fetch2(request);
    } catch (error) {
      promise = Promise.reject(error);
    }
    this.#flushing = true;
    promise.then((resp) => {
      if (!resp.ok) {
        return errorFromResponse(resp).then((error) => {
          throw error;
        });
      }
      return decodeResponse(resp);
    }).then((r) => {
      this.#baton = getBaton(r);
      this.#baseUrl = getBaseUrl(r) ?? this.#baseUrl;
      handleResponse(r);
    }).catch((error) => {
      this._setClosed(error);
      handleError(error);
    }).finally(() => {
      this.#flushing = false;
      this.#flushQueue();
    });
  }
  #createPipelineRequest(pipeline, endpoint) {
    return this.#createRequest(new URL(endpoint.pipelinePath, this.#baseUrl), {
      baton: this.#baton,
      requests: pipeline.map((entry) => entry.request)
    }, endpoint.encoding, PipelineReqBody, PipelineReqBody2);
  }
  #createCursorRequest(entry, endpoint) {
    if (endpoint.cursorPath === void 0) {
      throw new ProtocolVersionError(`Cursors are supported only on protocol version 3 and higher, but the HTTP server only supports version ${endpoint.version}.`);
    }
    return this.#createRequest(new URL(endpoint.cursorPath, this.#baseUrl), {
      baton: this.#baton,
      batch: entry.batch
    }, endpoint.encoding, CursorReqBody, CursorReqBody2);
  }
  #createRequest(url, reqBody, encoding, jsonFun, protobufFun) {
    let bodyData;
    let contentType;
    if (encoding === "json") {
      bodyData = writeJsonObject(reqBody, jsonFun);
      contentType = "application/json";
    } else if (encoding === "protobuf") {
      bodyData = writeProtobufMessage(reqBody, protobufFun);
      contentType = "application/x-protobuf";
    } else {
      throw impossible(encoding, "Impossible encoding");
    }
    const headers = new Headers();
    headers.set("content-type", contentType);
    if (this.#jwt !== void 0) {
      headers.set("authorization", `Bearer ${this.#jwt}`);
    }
    if (this.#remoteEncryptionKey !== void 0) {
      headers.set("x-turso-encryption-key", this.#remoteEncryptionKey);
    }
    return new Request(url.toString(), { method: "POST", headers, body: bodyData });
  }
};
function handlePipelineResponse(pipeline, respBody) {
  if (respBody.results.length !== pipeline.length) {
    throw new ProtoError("Server returned unexpected number of pipeline results");
  }
  for (let i = 0; i < pipeline.length; ++i) {
    const result = respBody.results[i];
    const entry = pipeline[i];
    if (result.type === "ok") {
      if (result.response.type !== entry.request.type) {
        throw new ProtoError("Received unexpected type of response");
      }
      entry.responseCallback(result.response);
    } else if (result.type === "error") {
      entry.errorCallback(errorFromProto(result.error));
    } else if (result.type === "none") {
      throw new ProtoError("Received unrecognized type of StreamResult");
    } else {
      throw impossible(result, "Received impossible type of StreamResult");
    }
  }
}
async function decodePipelineResponse(resp, encoding) {
  if (encoding === "json") {
    const respJson = await resp.json();
    return readJsonObject(respJson, PipelineRespBody);
  }
  if (encoding === "protobuf") {
    const respData = await resp.arrayBuffer();
    return readProtobufMessage(new Uint8Array(respData), PipelineRespBody2);
  }
  await resp.body?.cancel();
  throw impossible(encoding, "Impossible encoding");
}
async function errorFromResponse(resp) {
  const respType = resp.headers.get("content-type") ?? "text/plain";
  let message = `Server returned HTTP status ${resp.status}`;
  if (respType === "application/json") {
    const respBody = await resp.json();
    if ("message" in respBody) {
      return errorFromProto(respBody);
    }
    return new HttpServerError(message, resp.status);
  }
  if (respType === "text/plain") {
    const respBody = (await resp.text()).trim();
    if (respBody !== "") {
      message += `: ${respBody}`;
    }
    return new HttpServerError(message, resp.status);
  }
  await resp.body?.cancel();
  return new HttpServerError(message, resp.status);
}

// node_modules/@libsql/hrana-client/lib-esm/http/client.js
var checkEndpoints = [
  {
    versionPath: "v3-protobuf",
    pipelinePath: "v3-protobuf/pipeline",
    cursorPath: "v3-protobuf/cursor",
    version: 3,
    encoding: "protobuf"
  }
  /*
  {
      versionPath: "v3",
      pipelinePath: "v3/pipeline",
      cursorPath: "v3/cursor",
      version: 3,
      encoding: "json",
  },
  */
];
var fallbackEndpoint = {
  versionPath: "v2",
  pipelinePath: "v2/pipeline",
  cursorPath: void 0,
  version: 2,
  encoding: "json"
};
var HttpClient = class extends Client {
  #url;
  #jwt;
  #fetch;
  #remoteEncryptionKey;
  #closed;
  #streams;
  /** @private */
  _endpointPromise;
  /** @private */
  _endpoint;
  /** @private */
  constructor(url, jwt, customFetch, remoteEncryptionKey, protocolVersion = 2) {
    super();
    this.#url = url;
    this.#jwt = jwt;
    this.#fetch = customFetch ?? globalThis.fetch;
    this.#remoteEncryptionKey = remoteEncryptionKey;
    this.#closed = void 0;
    this.#streams = /* @__PURE__ */ new Set();
    if (protocolVersion == 3) {
      this._endpointPromise = findEndpoint(this.#fetch, this.#url);
      this._endpointPromise.then((endpoint) => this._endpoint = endpoint, (error) => this.#setClosed(error));
    } else {
      this._endpointPromise = Promise.resolve(fallbackEndpoint);
      this._endpointPromise.then((endpoint) => this._endpoint = endpoint, (error) => this.#setClosed(error));
    }
  }
  /** Get the protocol version supported by the server. */
  async getVersion() {
    if (this._endpoint !== void 0) {
      return this._endpoint.version;
    }
    return (await this._endpointPromise).version;
  }
  // Make sure that the negotiated version is at least `minVersion`.
  /** @private */
  _ensureVersion(minVersion, feature) {
    if (minVersion <= fallbackEndpoint.version) {
      return;
    } else if (this._endpoint === void 0) {
      throw new ProtocolVersionError(`${feature} is supported only on protocol version ${minVersion} and higher, but the version supported by the HTTP server is not yet known. Use Client.getVersion() to wait until the version is available.`);
    } else if (this._endpoint.version < minVersion) {
      throw new ProtocolVersionError(`${feature} is supported only on protocol version ${minVersion} and higher, but the HTTP server only supports version ${this._endpoint.version}.`);
    }
  }
  /** Open a {@link HttpStream}, a stream for executing SQL statements. */
  openStream() {
    if (this.#closed !== void 0) {
      throw new ClosedError("Client is closed", this.#closed);
    }
    const stream = new HttpStream(this, this.#url, this.#jwt, this.#fetch, this.#remoteEncryptionKey);
    this.#streams.add(stream);
    return stream;
  }
  /** @private */
  _streamClosed(stream) {
    this.#streams.delete(stream);
  }
  /** Close the client and all its streams. */
  close() {
    this.#setClosed(new ClientError("Client was manually closed"));
  }
  /** True if the client is closed. */
  get closed() {
    return this.#closed !== void 0;
  }
  #setClosed(error) {
    if (this.#closed !== void 0) {
      return;
    }
    this.#closed = error;
    for (const stream of Array.from(this.#streams)) {
      stream._setClosed(new ClosedError("Client was closed", error));
    }
  }
};
async function findEndpoint(customFetch, clientUrl) {
  const fetch2 = customFetch;
  for (const endpoint of checkEndpoints) {
    const url = new URL(endpoint.versionPath, clientUrl);
    const request = new Request(url.toString(), { method: "GET" });
    const response = await fetch2(request);
    await response.arrayBuffer();
    if (response.ok) {
      return endpoint;
    }
  }
  return fallbackEndpoint;
}

// node_modules/@libsql/hrana-client/lib-esm/index.js
function openWs(url, jwt, protocolVersion = 2) {
  if (typeof _WebSocket === "undefined") {
    throw new WebSocketUnsupportedError("WebSockets are not supported in this environment");
  }
  var subprotocols = void 0;
  if (protocolVersion == 3) {
    subprotocols = Array.from(subprotocolsV3.keys());
  } else {
    subprotocols = Array.from(subprotocolsV2.keys());
  }
  const socket = new _WebSocket(url, subprotocols);
  return new WsClient(socket, jwt);
}
function openHttp(url, jwt, customFetch, remoteEncryptionKey, protocolVersion = 2) {
  return new HttpClient(url instanceof URL ? url : new URL(url), jwt, customFetch, remoteEncryptionKey, protocolVersion);
}

// node_modules/@libsql/client/lib-esm/hrana.js
var HranaTransaction = class {
  #mode;
  #version;
  // Promise that is resolved when the BEGIN statement completes, or `undefined` if we haven't executed the
  // BEGIN statement yet.
  #started;
  /** @private */
  constructor(mode, version2) {
    this.#mode = mode;
    this.#version = version2;
    this.#started = void 0;
  }
  execute(stmt) {
    return this.batch([stmt]).then((results) => results[0]);
  }
  async batch(stmts) {
    const stream = this._getStream();
    if (stream.closed) {
      throw new LibsqlError("Cannot execute statements because the transaction is closed", "TRANSACTION_CLOSED");
    }
    try {
      const hranaStmts = stmts.map(stmtToHrana);
      let rowsPromises;
      if (this.#started === void 0) {
        this._getSqlCache().apply(hranaStmts);
        const batch = stream.batch(this.#version >= 3);
        const beginStep = batch.step();
        const beginPromise = beginStep.run(transactionModeToBegin(this.#mode));
        let lastStep = beginStep;
        rowsPromises = hranaStmts.map((hranaStmt) => {
          const stmtStep = batch.step().condition(BatchCond.ok(lastStep));
          if (this.#version >= 3) {
            stmtStep.condition(BatchCond.not(BatchCond.isAutocommit(batch)));
          }
          const rowsPromise = stmtStep.query(hranaStmt);
          rowsPromise.catch(() => void 0);
          lastStep = stmtStep;
          return rowsPromise;
        });
        this.#started = batch.execute().then(() => beginPromise).then(() => void 0);
        try {
          await this.#started;
        } catch (e) {
          this.close();
          throw e;
        }
      } else {
        if (this.#version < 3) {
          await this.#started;
        } else {
        }
        this._getSqlCache().apply(hranaStmts);
        const batch = stream.batch(this.#version >= 3);
        let lastStep = void 0;
        rowsPromises = hranaStmts.map((hranaStmt) => {
          const stmtStep = batch.step();
          if (lastStep !== void 0) {
            stmtStep.condition(BatchCond.ok(lastStep));
          }
          if (this.#version >= 3) {
            stmtStep.condition(BatchCond.not(BatchCond.isAutocommit(batch)));
          }
          const rowsPromise = stmtStep.query(hranaStmt);
          rowsPromise.catch(() => void 0);
          lastStep = stmtStep;
          return rowsPromise;
        });
        await batch.execute();
      }
      const resultSets = [];
      for (let i = 0; i < rowsPromises.length; i++) {
        try {
          const rows = await rowsPromises[i];
          if (rows === void 0) {
            throw new LibsqlBatchError("Statement in a transaction was not executed, probably because the transaction has been rolled back", i, "TRANSACTION_CLOSED");
          }
          resultSets.push(resultSetFromHrana(rows));
        } catch (e) {
          if (e instanceof LibsqlBatchError) {
            throw e;
          }
          const mappedError = mapHranaError(e);
          if (mappedError instanceof LibsqlError) {
            throw new LibsqlBatchError(mappedError.message, i, mappedError.code, mappedError.extendedCode, mappedError.rawCode, mappedError.cause instanceof Error ? mappedError.cause : void 0);
          }
          throw mappedError;
        }
      }
      return resultSets;
    } catch (e) {
      throw mapHranaError(e);
    }
  }
  async executeMultiple(sql) {
    const stream = this._getStream();
    if (stream.closed) {
      throw new LibsqlError("Cannot execute statements because the transaction is closed", "TRANSACTION_CLOSED");
    }
    try {
      if (this.#started === void 0) {
        this.#started = stream.run(transactionModeToBegin(this.#mode)).then(() => void 0);
        try {
          await this.#started;
        } catch (e) {
          this.close();
          throw e;
        }
      } else {
        await this.#started;
      }
      await stream.sequence(sql);
    } catch (e) {
      throw mapHranaError(e);
    }
  }
  async rollback() {
    try {
      const stream = this._getStream();
      if (stream.closed) {
        return;
      }
      if (this.#started !== void 0) {
      } else {
        return;
      }
      const promise = stream.run("ROLLBACK").catch((e) => {
        throw mapHranaError(e);
      });
      stream.closeGracefully();
      await promise;
    } catch (e) {
      throw mapHranaError(e);
    } finally {
      this.close();
    }
  }
  async commit() {
    try {
      const stream = this._getStream();
      if (stream.closed) {
        throw new LibsqlError("Cannot commit the transaction because it is already closed", "TRANSACTION_CLOSED");
      }
      if (this.#started !== void 0) {
        await this.#started;
      } else {
        return;
      }
      const promise = stream.run("COMMIT").catch((e) => {
        throw mapHranaError(e);
      });
      stream.closeGracefully();
      await promise;
    } catch (e) {
      throw mapHranaError(e);
    } finally {
      this.close();
    }
  }
};
async function executeHranaBatch(mode, version2, batch, hranaStmts, disableForeignKeys = false) {
  if (disableForeignKeys) {
    batch.step().run("PRAGMA foreign_keys=off");
  }
  const beginStep = batch.step();
  const beginPromise = beginStep.run(transactionModeToBegin(mode));
  let lastStep = beginStep;
  const stmtPromises = hranaStmts.map((hranaStmt) => {
    const stmtStep = batch.step().condition(BatchCond.ok(lastStep));
    if (version2 >= 3) {
      stmtStep.condition(BatchCond.not(BatchCond.isAutocommit(batch)));
    }
    const stmtPromise = stmtStep.query(hranaStmt);
    lastStep = stmtStep;
    return stmtPromise;
  });
  const commitStep = batch.step().condition(BatchCond.ok(lastStep));
  if (version2 >= 3) {
    commitStep.condition(BatchCond.not(BatchCond.isAutocommit(batch)));
  }
  const commitPromise = commitStep.run("COMMIT");
  const rollbackStep = batch.step().condition(BatchCond.not(BatchCond.ok(commitStep)));
  rollbackStep.run("ROLLBACK").catch((_) => void 0);
  if (disableForeignKeys) {
    batch.step().run("PRAGMA foreign_keys=on");
  }
  await batch.execute();
  const resultSets = [];
  await beginPromise;
  for (let i = 0; i < stmtPromises.length; i++) {
    try {
      const hranaRows = await stmtPromises[i];
      if (hranaRows === void 0) {
        throw new LibsqlBatchError("Statement in a batch was not executed, probably because the transaction has been rolled back", i, "TRANSACTION_CLOSED");
      }
      resultSets.push(resultSetFromHrana(hranaRows));
    } catch (e) {
      if (e instanceof LibsqlBatchError) {
        throw e;
      }
      const mappedError = mapHranaError(e);
      if (mappedError instanceof LibsqlError) {
        throw new LibsqlBatchError(mappedError.message, i, mappedError.code, mappedError.extendedCode, mappedError.rawCode, mappedError.cause instanceof Error ? mappedError.cause : void 0);
      }
      throw mappedError;
    }
  }
  await commitPromise;
  return resultSets;
}
function stmtToHrana(stmt) {
  let sql;
  let args;
  if (Array.isArray(stmt)) {
    [sql, args] = stmt;
  } else if (typeof stmt === "string") {
    sql = stmt;
  } else {
    sql = stmt.sql;
    args = stmt.args;
  }
  const hranaStmt = new Stmt(sql);
  if (args) {
    if (Array.isArray(args)) {
      hranaStmt.bindIndexes(args);
    } else {
      for (const [key, value] of Object.entries(args)) {
        hranaStmt.bindName(key, value);
      }
    }
  }
  return hranaStmt;
}
function resultSetFromHrana(hranaRows) {
  const columns = hranaRows.columnNames.map((c2) => c2 ?? "");
  const columnTypes = hranaRows.columnDecltypes.map((c2) => c2 ?? "");
  const rows = hranaRows.rows;
  const rowsAffected = hranaRows.affectedRowCount;
  const lastInsertRowid = hranaRows.lastInsertRowid !== void 0 ? hranaRows.lastInsertRowid : void 0;
  return new ResultSetImpl(columns, columnTypes, rows, rowsAffected, lastInsertRowid);
}
function mapHranaError(e) {
  if (e instanceof ClientError) {
    const code = mapHranaErrorCode(e);
    return new LibsqlError(e.message, code, void 0, void 0, e);
  }
  return e;
}
function mapHranaErrorCode(e) {
  if (e instanceof ResponseError && e.code !== void 0) {
    return e.code;
  } else if (e instanceof ProtoError) {
    return "HRANA_PROTO_ERROR";
  } else if (e instanceof ClosedError) {
    return e.cause instanceof ClientError ? mapHranaErrorCode(e.cause) : "HRANA_CLOSED_ERROR";
  } else if (e instanceof WebSocketError) {
    return "HRANA_WEBSOCKET_ERROR";
  } else if (e instanceof HttpServerError) {
    return "SERVER_ERROR";
  } else if (e instanceof ProtocolVersionError) {
    return "PROTOCOL_VERSION_ERROR";
  } else if (e instanceof InternalError) {
    return "INTERNAL_ERROR";
  } else {
    return "UNKNOWN";
  }
}

// node_modules/@libsql/client/lib-esm/sql_cache.js
var SqlCache = class {
  #owner;
  #sqls;
  capacity;
  constructor(owner, capacity) {
    this.#owner = owner;
    this.#sqls = new Lru();
    this.capacity = capacity;
  }
  // Replaces SQL strings with cached `hrana.Sql` objects in the statements in `hranaStmts`. After this
  // function returns, we guarantee that all `hranaStmts` refer to valid (not closed) `hrana.Sql` objects,
  // but _we may invalidate any other `hrana.Sql` objects_ (by closing them, thus removing them from the
  // server).
  //
  // In practice, this means that after calling this function, you can use the statements only up to the
  // first `await`, because concurrent code may also use the cache and invalidate those statements.
  apply(hranaStmts) {
    if (this.capacity <= 0) {
      return;
    }
    const usedSqlObjs = /* @__PURE__ */ new Set();
    for (const hranaStmt of hranaStmts) {
      if (typeof hranaStmt.sql !== "string") {
        continue;
      }
      const sqlText = hranaStmt.sql;
      if (sqlText.length >= 5e3) {
        continue;
      }
      let sqlObj = this.#sqls.get(sqlText);
      if (sqlObj === void 0) {
        while (this.#sqls.size + 1 > this.capacity) {
          const [evictSqlText, evictSqlObj] = this.#sqls.peekLru();
          if (usedSqlObjs.has(evictSqlObj)) {
            break;
          }
          evictSqlObj.close();
          this.#sqls.delete(evictSqlText);
        }
        if (this.#sqls.size + 1 <= this.capacity) {
          sqlObj = this.#owner.storeSql(sqlText);
          this.#sqls.set(sqlText, sqlObj);
        }
      }
      if (sqlObj !== void 0) {
        hranaStmt.sql = sqlObj;
        usedSqlObjs.add(sqlObj);
      }
    }
  }
};
var Lru = class {
  // This maps keys to the cache values. The entries are ordered by their last use (entires that were used
  // most recently are at the end).
  #cache;
  constructor() {
    this.#cache = /* @__PURE__ */ new Map();
  }
  get(key) {
    const value = this.#cache.get(key);
    if (value !== void 0) {
      this.#cache.delete(key);
      this.#cache.set(key, value);
    }
    return value;
  }
  set(key, value) {
    this.#cache.set(key, value);
  }
  peekLru() {
    for (const entry of this.#cache.entries()) {
      return entry;
    }
    return void 0;
  }
  delete(key) {
    this.#cache.delete(key);
  }
  get size() {
    return this.#cache.size;
  }
};

// node_modules/@libsql/client/lib-esm/ws.js
var import_promise_limit = __toESM(require_promise_limit(), 1);
function _createClient(config) {
  if (config.scheme !== "wss" && config.scheme !== "ws") {
    throw new LibsqlError(`The WebSocket client supports only "libsql:", "wss:" and "ws:" URLs, got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`, "URL_SCHEME_NOT_SUPPORTED");
  }
  if (config.encryptionKey !== void 0) {
    throw new LibsqlError("Encryption key is not supported by the remote client.", "ENCRYPTION_KEY_NOT_SUPPORTED");
  }
  if (config.scheme === "ws" && config.tls) {
    throw new LibsqlError(`A "ws:" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
  } else if (config.scheme === "wss" && !config.tls) {
    throw new LibsqlError(`A "wss:" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
  }
  const url = encodeBaseUrl(config.scheme, config.authority, config.path);
  let client;
  try {
    client = openWs(url, config.authToken);
  } catch (e) {
    if (e instanceof WebSocketUnsupportedError) {
      const suggestedScheme = config.scheme === "wss" ? "https" : "http";
      const suggestedUrl = encodeBaseUrl(suggestedScheme, config.authority, config.path);
      throw new LibsqlError(`This environment does not support WebSockets, please switch to the HTTP client by using a "${suggestedScheme}:" URL (${JSON.stringify(suggestedUrl)}). For more information, please read ${supportedUrlLink}`, "WEBSOCKETS_NOT_SUPPORTED");
    }
    throw mapHranaError(e);
  }
  return new WsClient2(client, url, config.authToken, config.intMode, config.concurrency);
}
var maxConnAgeMillis = 60 * 1e3;
var sqlCacheCapacity = 100;
var WsClient2 = class {
  #url;
  #authToken;
  #intMode;
  // State of the current connection. The `hrana.WsClient` inside may be closed at any moment due to an
  // asynchronous error.
  #connState;
  // If defined, this is a connection that will be used in the future, once it is ready.
  #futureConnState;
  closed;
  protocol;
  #isSchemaDatabase;
  #promiseLimitFunction;
  /** @private */
  constructor(client, url, authToken, intMode, concurrency) {
    this.#url = url;
    this.#authToken = authToken;
    this.#intMode = intMode;
    this.#connState = this.#openConn(client);
    this.#futureConnState = void 0;
    this.closed = false;
    this.protocol = "ws";
    this.#promiseLimitFunction = (0, import_promise_limit.default)(concurrency);
  }
  async limit(fn) {
    return this.#promiseLimitFunction(fn);
  }
  async execute(stmtOrSql, args) {
    let stmt;
    if (typeof stmtOrSql === "string") {
      stmt = {
        sql: stmtOrSql,
        args: args || []
      };
    } else {
      stmt = stmtOrSql;
    }
    return this.limit(async () => {
      const streamState = await this.#openStream();
      try {
        const hranaStmt = stmtToHrana(stmt);
        streamState.conn.sqlCache.apply([hranaStmt]);
        const hranaRowsPromise = streamState.stream.query(hranaStmt);
        streamState.stream.closeGracefully();
        const hranaRowsResult = await hranaRowsPromise;
        return resultSetFromHrana(hranaRowsResult);
      } catch (e) {
        throw mapHranaError(e);
      } finally {
        this._closeStream(streamState);
      }
    });
  }
  async batch(stmts, mode = "deferred") {
    return this.limit(async () => {
      const streamState = await this.#openStream();
      try {
        const normalizedStmts = stmts.map((stmt) => {
          if (Array.isArray(stmt)) {
            return {
              sql: stmt[0],
              args: stmt[1] || []
            };
          }
          return stmt;
        });
        const hranaStmts = normalizedStmts.map(stmtToHrana);
        const version2 = await streamState.conn.client.getVersion();
        streamState.conn.sqlCache.apply(hranaStmts);
        const batch = streamState.stream.batch(version2 >= 3);
        const resultsPromise = executeHranaBatch(mode, version2, batch, hranaStmts);
        const results = await resultsPromise;
        return results;
      } catch (e) {
        throw mapHranaError(e);
      } finally {
        this._closeStream(streamState);
      }
    });
  }
  async migrate(stmts) {
    return this.limit(async () => {
      const streamState = await this.#openStream();
      try {
        const hranaStmts = stmts.map(stmtToHrana);
        const version2 = await streamState.conn.client.getVersion();
        const batch = streamState.stream.batch(version2 >= 3);
        const resultsPromise = executeHranaBatch("deferred", version2, batch, hranaStmts, true);
        const results = await resultsPromise;
        return results;
      } catch (e) {
        throw mapHranaError(e);
      } finally {
        this._closeStream(streamState);
      }
    });
  }
  async transaction(mode = "write") {
    return this.limit(async () => {
      const streamState = await this.#openStream();
      try {
        const version2 = await streamState.conn.client.getVersion();
        return new WsTransaction(this, streamState, mode, version2);
      } catch (e) {
        this._closeStream(streamState);
        throw mapHranaError(e);
      }
    });
  }
  async executeMultiple(sql) {
    return this.limit(async () => {
      const streamState = await this.#openStream();
      try {
        const promise = streamState.stream.sequence(sql);
        streamState.stream.closeGracefully();
        await promise;
      } catch (e) {
        throw mapHranaError(e);
      } finally {
        this._closeStream(streamState);
      }
    });
  }
  sync() {
    throw new LibsqlError("sync not supported in ws mode", "SYNC_NOT_SUPPORTED");
  }
  async #openStream() {
    if (this.closed) {
      throw new LibsqlError("The client is closed", "CLIENT_CLOSED");
    }
    const now = /* @__PURE__ */ new Date();
    const ageMillis = now.valueOf() - this.#connState.openTime.valueOf();
    if (ageMillis > maxConnAgeMillis && this.#futureConnState === void 0) {
      const futureConnState = this.#openConn();
      this.#futureConnState = futureConnState;
      futureConnState.client.getVersion().then((_version) => {
        if (this.#connState !== futureConnState) {
          if (this.#connState.streamStates.size === 0) {
            this.#connState.client.close();
          } else {
          }
        }
        this.#connState = futureConnState;
        this.#futureConnState = void 0;
      }, (_e) => {
        this.#futureConnState = void 0;
      });
    }
    if (this.#connState.client.closed) {
      try {
        if (this.#futureConnState !== void 0) {
          this.#connState = this.#futureConnState;
        } else {
          this.#connState = this.#openConn();
        }
      } catch (e) {
        throw mapHranaError(e);
      }
    }
    const connState = this.#connState;
    try {
      if (connState.useSqlCache === void 0) {
        connState.useSqlCache = await connState.client.getVersion() >= 2;
        if (connState.useSqlCache) {
          connState.sqlCache.capacity = sqlCacheCapacity;
        }
      }
      const stream = connState.client.openStream();
      stream.intMode = this.#intMode;
      const streamState = { conn: connState, stream };
      connState.streamStates.add(streamState);
      return streamState;
    } catch (e) {
      throw mapHranaError(e);
    }
  }
  #openConn(client) {
    try {
      client ??= openWs(this.#url, this.#authToken);
      return {
        client,
        useSqlCache: void 0,
        sqlCache: new SqlCache(client, 0),
        openTime: /* @__PURE__ */ new Date(),
        streamStates: /* @__PURE__ */ new Set()
      };
    } catch (e) {
      throw mapHranaError(e);
    }
  }
  async reconnect() {
    try {
      for (const st of Array.from(this.#connState.streamStates)) {
        try {
          st.stream.close();
        } catch {
        }
      }
      this.#connState.client.close();
    } catch {
    }
    if (this.#futureConnState) {
      try {
        this.#futureConnState.client.close();
      } catch {
      }
      this.#futureConnState = void 0;
    }
    const next = this.#openConn();
    const version2 = await next.client.getVersion();
    next.useSqlCache = version2 >= 2;
    if (next.useSqlCache) {
      next.sqlCache.capacity = sqlCacheCapacity;
    }
    this.#connState = next;
    this.closed = false;
  }
  _closeStream(streamState) {
    streamState.stream.close();
    const connState = streamState.conn;
    connState.streamStates.delete(streamState);
    if (connState.streamStates.size === 0 && connState !== this.#connState) {
      connState.client.close();
    }
  }
  close() {
    this.#connState.client.close();
    this.closed = true;
    if (this.#futureConnState) {
      try {
        this.#futureConnState.client.close();
      } catch {
      }
      this.#futureConnState = void 0;
    }
    this.closed = true;
  }
};
var WsTransaction = class extends HranaTransaction {
  #client;
  #streamState;
  /** @private */
  constructor(client, state, mode, version2) {
    super(mode, version2);
    this.#client = client;
    this.#streamState = state;
  }
  /** @private */
  _getStream() {
    return this.#streamState.stream;
  }
  /** @private */
  _getSqlCache() {
    return this.#streamState.conn.sqlCache;
  }
  close() {
    this.#client._closeStream(this.#streamState);
  }
  get closed() {
    return this.#streamState.stream.closed;
  }
};

// node_modules/@libsql/client/lib-esm/http.js
var import_promise_limit2 = __toESM(require_promise_limit(), 1);
function _createClient2(config) {
  if (config.scheme !== "https" && config.scheme !== "http") {
    throw new LibsqlError(`The HTTP client supports only "libsql:", "https:" and "http:" URLs, got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`, "URL_SCHEME_NOT_SUPPORTED");
  }
  if (config.encryptionKey !== void 0) {
    throw new LibsqlError("Encryption key is not supported by the remote client.", "ENCRYPTION_KEY_NOT_SUPPORTED");
  }
  if (config.scheme === "http" && config.tls) {
    throw new LibsqlError(`A "http:" URL cannot opt into TLS by using ?tls=1`, "URL_INVALID");
  } else if (config.scheme === "https" && !config.tls) {
    throw new LibsqlError(`A "https:" URL cannot opt out of TLS by using ?tls=0`, "URL_INVALID");
  }
  const url = encodeBaseUrl(config.scheme, config.authority, config.path);
  return new HttpClient2(url, config.authToken, config.intMode, config.fetch, config.concurrency, config.remoteEncryptionKey);
}
var sqlCacheCapacity2 = 30;
var HttpClient2 = class {
  #client;
  protocol;
  #url;
  #intMode;
  #customFetch;
  #concurrency;
  #authToken;
  #remoteEncryptionKey;
  #promiseLimitFunction;
  /** @private */
  constructor(url, authToken, intMode, customFetch, concurrency, remoteEncryptionKey) {
    this.#url = url;
    this.#authToken = authToken;
    this.#intMode = intMode;
    this.#customFetch = customFetch;
    this.#concurrency = concurrency;
    this.#remoteEncryptionKey = remoteEncryptionKey;
    this.#client = openHttp(this.#url, this.#authToken, this.#customFetch, remoteEncryptionKey);
    this.#client.intMode = this.#intMode;
    this.protocol = "http";
    this.#promiseLimitFunction = (0, import_promise_limit2.default)(this.#concurrency);
  }
  async limit(fn) {
    return this.#promiseLimitFunction(fn);
  }
  async execute(stmtOrSql, args) {
    let stmt;
    if (typeof stmtOrSql === "string") {
      stmt = {
        sql: stmtOrSql,
        args: args || []
      };
    } else {
      stmt = stmtOrSql;
    }
    return this.limit(async () => {
      try {
        const hranaStmt = stmtToHrana(stmt);
        let rowsPromise;
        const stream = this.#client.openStream();
        try {
          rowsPromise = stream.query(hranaStmt);
        } finally {
          stream.closeGracefully();
        }
        const rowsResult = await rowsPromise;
        return resultSetFromHrana(rowsResult);
      } catch (e) {
        throw mapHranaError(e);
      }
    });
  }
  async batch(stmts, mode = "deferred") {
    return this.limit(async () => {
      try {
        const normalizedStmts = stmts.map((stmt) => {
          if (Array.isArray(stmt)) {
            return {
              sql: stmt[0],
              args: stmt[1] || []
            };
          }
          return stmt;
        });
        const hranaStmts = normalizedStmts.map(stmtToHrana);
        const version2 = await this.#client.getVersion();
        let resultsPromise;
        const stream = this.#client.openStream();
        try {
          const sqlCache = new SqlCache(stream, sqlCacheCapacity2);
          sqlCache.apply(hranaStmts);
          const batch = stream.batch(false);
          resultsPromise = executeHranaBatch(mode, version2, batch, hranaStmts);
        } finally {
          stream.closeGracefully();
        }
        const results = await resultsPromise;
        return results;
      } catch (e) {
        throw mapHranaError(e);
      }
    });
  }
  async migrate(stmts) {
    return this.limit(async () => {
      try {
        const hranaStmts = stmts.map(stmtToHrana);
        const version2 = await this.#client.getVersion();
        let resultsPromise;
        const stream = this.#client.openStream();
        try {
          const batch = stream.batch(false);
          resultsPromise = executeHranaBatch("deferred", version2, batch, hranaStmts, true);
        } finally {
          stream.closeGracefully();
        }
        const results = await resultsPromise;
        return results;
      } catch (e) {
        throw mapHranaError(e);
      }
    });
  }
  async transaction(mode = "write") {
    return this.limit(async () => {
      try {
        const version2 = await this.#client.getVersion();
        return new HttpTransaction(this.#client.openStream(), mode, version2);
      } catch (e) {
        throw mapHranaError(e);
      }
    });
  }
  async executeMultiple(sql) {
    return this.limit(async () => {
      try {
        let promise;
        const stream = this.#client.openStream();
        try {
          promise = stream.sequence(sql);
        } finally {
          stream.closeGracefully();
        }
        await promise;
      } catch (e) {
        throw mapHranaError(e);
      }
    });
  }
  sync() {
    throw new LibsqlError("sync not supported in http mode", "SYNC_NOT_SUPPORTED");
  }
  close() {
    this.#client.close();
  }
  async reconnect() {
    try {
      if (!this.closed) {
        this.#client.close();
      }
    } finally {
      this.#client = openHttp(this.#url, this.#authToken, this.#customFetch, this.#remoteEncryptionKey);
      this.#client.intMode = this.#intMode;
    }
  }
  get closed() {
    return this.#client.closed;
  }
};
var HttpTransaction = class extends HranaTransaction {
  #stream;
  #sqlCache;
  /** @private */
  constructor(stream, mode, version2) {
    super(mode, version2);
    this.#stream = stream;
    this.#sqlCache = new SqlCache(stream, sqlCacheCapacity2);
  }
  /** @private */
  _getStream() {
    return this.#stream;
  }
  /** @private */
  _getSqlCache() {
    return this.#sqlCache;
  }
  close() {
    this.#stream.close();
  }
  get closed() {
    return this.#stream.closed;
  }
};

// node_modules/@libsql/client/lib-esm/web.js
function createClient(config) {
  return _createClient3(expandConfig(config, true));
}
function _createClient3(config) {
  if (config.scheme === "ws" || config.scheme === "wss") {
    return _createClient(config);
  } else if (config.scheme === "http" || config.scheme === "https") {
    return _createClient2(config);
  } else {
    throw new LibsqlError(`The client that uses Web standard APIs supports only "libsql:", "wss:", "ws:", "https:" and "http:" URLs, got ${JSON.stringify(config.scheme + ":")}. For more information, please read ${supportedUrlLink}`, "URL_SCHEME_NOT_SUPPORTED");
  }
}

// spider-leads/src/db.ts
function openDb(cfg) {
  const isLocal = cfg.tursoUrl.startsWith("file:");
  if (isLocal) {
    log.warn(`Using LOCAL database file ${cfg.tursoUrl.slice(5)} \u2014 set TURSO_URL (libsql://\u2026) and TURSO_AUTH_TOKEN in .env to use Turso.`);
  }
  return createClient({
    url: cfg.tursoUrl,
    authToken: cfg.tursoAuthToken || void 0
  });
}
var SCHEMA = [
  `CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    email TEXT,
    person_name TEXT,
    title TEXT,
    phone TEXT,
    linkedin TEXT,
    company TEXT,
    domain TEXT,
    category TEXT,
    subcategory TEXT,
    tier TEXT,
    confidence REAL,
    email_type TEXT,
    email_source TEXT,
    email_pattern TEXT,
    email_score REAL,
    department TEXT,
    seniority TEXT,
    decision_maker INTEGER,
    lead_score REAL,
    lead_tier TEXT,
    icp_match INTEGER,
    interests TEXT,
    source_url TEXT,
    source TEXT NOT NULL DEFAULT 'hunt',
    status TEXT NOT NULL DEFAULT 'new',
    email_valid INTEGER,
    is_disposable INTEGER,
    is_personal_email INTEGER,
    has_mx_records INTEGER,
    is_typo INTEGER,
    plunk_reasons TEXT,
    verified_at TEXT,
    raw_data TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads(email) WHERE email IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category)`,
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    linkedin TEXT,
    github TEXT,
    domain TEXT NOT NULL,
    company TEXT,
    source TEXT NOT NULL DEFAULT 'page',
    source_url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT,
    UNIQUE(domain, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_people_domain ON people(domain)`,
  `CREATE TABLE IF NOT EXISTS email_candidates (
    email TEXT PRIMARY KEY,
    person_name TEXT,
    domain TEXT NOT NULL,
    pattern TEXT,
    score REAL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    source_url TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_domain ON email_candidates(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_status ON email_candidates(status)`,
  `CREATE TABLE IF NOT EXISTS company_relations (
    id TEXT PRIMARY KEY,
    from_domain TEXT NOT NULL,
    type TEXT NOT NULL,
    target TEXT NOT NULL,
    target_domain TEXT,
    evidence TEXT,
    confidence REAL,
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(from_domain, target, type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_relations_from ON company_relations(from_domain)`,
  `CREATE INDEX IF NOT EXISTS idx_relations_to ON company_relations(target_domain)`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    pages_crawled INTEGER DEFAULT 0,
    leads_found INTEGER DEFAULT 0,
    leads_verified INTEGER DEFAULT 0,
    leads_invalid INTEGER DEFAULT 0,
    errors TEXT
  )`
];
async function initSchema(db) {
  for (const sql of SCHEMA) await db.execute(sql);
  await ensureColumn(db, "leads", "email_type", "TEXT");
  await ensureColumn(db, "leads", "interests", "TEXT");
  await ensureColumn(db, "leads", "email_source", "TEXT");
  await ensureColumn(db, "leads", "email_pattern", "TEXT");
  await ensureColumn(db, "leads", "email_score", "REAL");
  await ensureColumn(db, "leads", "department", "TEXT");
  await ensureColumn(db, "leads", "seniority", "TEXT");
  await ensureColumn(db, "leads", "decision_maker", "INTEGER");
  await ensureColumn(db, "leads", "lead_score", "REAL");
  await ensureColumn(db, "leads", "lead_tier", "TEXT");
  await ensureColumn(db, "leads", "icp_match", "INTEGER");
}
async function ensureColumn(db, table, column, decl) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  } catch {
  }
}
function boolInt(b) {
  return b ? 1 : 0;
}
async function upsertLead(db, lead) {
  const email = lead.email?.toLowerCase() ?? null;
  const exists = email ? await db.execute({ sql: "SELECT 1 FROM leads WHERE email = ?", args: [email] }) : { rows: [] };
  const outcome = exists.rows.length > 0 ? "updated" : "new";
  const id = crypto.randomUUID();
  const raw = JSON.stringify(lead.raw ?? null);
  const interests = JSON.stringify(lead.interests ?? []);
  const emailSource = lead.emailSource ?? "unknown";
  await db.execute({
    sql: `INSERT INTO leads (id, email, person_name, title, phone, linkedin, company, domain,
            category, subcategory, tier, confidence, email_type, email_source, email_pattern, email_score,
            department, seniority, decision_maker, lead_score, lead_tier, icp_match,
            interests, source_url, source, status, raw_data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
     ON CONFLICT DO UPDATE SET
       person_name = COALESCE(excluded.person_name, leads.person_name),
       title       = COALESCE(excluded.title, leads.title),
       phone       = COALESCE(excluded.phone, leads.phone),
       linkedin    = COALESCE(excluded.linkedin, leads.linkedin),
       company     = COALESCE(excluded.company, leads.company),
       domain      = COALESCE(excluded.domain, leads.domain),
       category    = COALESCE(excluded.category, leads.category),
       subcategory = COALESCE(excluded.subcategory, leads.subcategory),
       tier        = COALESCE(excluded.tier, leads.tier),
       confidence  = COALESCE(excluded.confidence, leads.confidence),
       email_type  = COALESCE(excluded.email_type, leads.email_type),
       email_source = CASE
                        -- Keep the more authoritative source: page > github > agent > guessed
                        WHEN excluded.email_source = 'page' THEN 'page'
                        WHEN leads.email_source = 'page' THEN 'page'
                        WHEN excluded.email_source = 'github' THEN 'github'
                        WHEN leads.email_source = 'github' THEN 'github'
                        WHEN excluded.email_source = 'agent' THEN 'agent'
                        WHEN leads.email_source = 'agent' THEN 'agent'
                        ELSE COALESCE(excluded.email_source, leads.email_source)
                      END,
       email_pattern = COALESCE(excluded.email_pattern, leads.email_pattern),
       email_score   = COALESCE(excluded.email_score, leads.email_score),
       department    = COALESCE(excluded.department, leads.department),
       seniority     = COALESCE(excluded.seniority, leads.seniority),
       decision_maker = COALESCE(excluded.decision_maker, leads.decision_maker),
       lead_score    = COALESCE(excluded.lead_score, leads.lead_score),
       lead_tier     = COALESCE(excluded.lead_tier, leads.lead_tier),
       icp_match     = COALESCE(excluded.icp_match, leads.icp_match),
       interests   = COALESCE(excluded.interests, leads.interests),
       source_url  = COALESCE(excluded.source_url, leads.source_url),
       raw_data    = COALESCE(excluded.raw_data, leads.raw_data),
       updated_at  = excluded.updated_at`,
    args: [
      id,
      email,
      lead.personName,
      lead.title,
      lead.phone,
      lead.linkedin,
      lead.company,
      lead.domain,
      lead.category,
      lead.subcategory,
      lead.tier,
      lead.confidence,
      lead.emailType,
      emailSource,
      lead.emailPattern ?? null,
      lead.emailScore ?? null,
      lead.department ?? null,
      lead.seniority ?? null,
      lead.decisionMaker == null ? null : lead.decisionMaker ? 1 : 0,
      lead.leadScore ?? null,
      lead.leadTier ?? null,
      lead.icpMatch == null ? null : lead.icpMatch ? 1 : 0,
      interests,
      lead.sourceUrl,
      lead.source,
      raw,
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  });
  return outcome;
}
async function updateLeadScore(db, email, fields) {
  await db.execute({
    sql: `UPDATE leads SET department = ?, seniority = ?, decision_maker = ?, lead_score = ?,
          lead_tier = ?, icp_match = ?, updated_at = ? WHERE email = ?`,
    args: [
      fields.department,
      fields.seniority,
      fields.decisionMaker ? 1 : 0,
      fields.leadScore,
      fields.leadTier,
      fields.icpMatch == null ? null : fields.icpMatch ? 1 : 0,
      (/* @__PURE__ */ new Date()).toISOString(),
      email.toLowerCase()
    ]
  });
}
async function recordVerification(db, email, res, error) {
  const status = error ? "error" : res.valid ? "verified" : "invalid";
  await db.execute({
    sql: `UPDATE leads SET status = ?, email_valid = ?, is_disposable = ?, is_personal_email = ?,
          has_mx_records = ?, is_typo = ?, plunk_reasons = ?, verified_at = ?, updated_at = ?
     WHERE email = ?`,
    args: [
      status,
      error ? null : boolInt(res.valid),
      error ? null : boolInt(res.isDisposable),
      error ? null : boolInt(res.isPersonalEmail),
      error ? null : boolInt(res.hasMxRecords),
      error ? null : boolInt(res.isTypo),
      error ? JSON.stringify({ error: error.message }) : JSON.stringify(res.reasons),
      (/* @__PURE__ */ new Date()).toISOString(),
      (/* @__PURE__ */ new Date()).toISOString(),
      email.toLowerCase()
    ]
  });
}
async function listLeads(db, opts = {}) {
  const where = [];
  const args = [];
  if (opts.category) {
    where.push("category = ?");
    args.push(opts.category);
  }
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts.emailType) {
    where.push("email_type = ?");
    args.push(opts.emailType);
  }
  if (opts.emailSource) {
    where.push("email_source = ?");
    args.push(opts.emailSource);
  }
  if (opts.department) {
    where.push("department = ?");
    args.push(opts.department);
  }
  if (opts.tier) {
    where.push("lead_tier = ?");
    args.push(opts.tier);
  }
  if (opts.minScore) {
    where.push("lead_score >= ?");
    args.push(opts.minScore);
  }
  if (opts.decisionMaker === true) {
    where.push("decision_maker = 1");
  }
  if (opts.interest) {
    where.push("interests LIKE ?");
    args.push("%" + opts.interest + "%");
  }
  const sql = `SELECT id, email, person_name, title, phone, company, domain, category, tier,
            confidence, email_type, email_source, email_pattern, email_score,
            department, seniority, decision_maker, lead_score, lead_tier, icp_match,
            interests, source_url, source, status, email_valid, verified_at, created_at
     FROM leads ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY lead_score DESC, created_at DESC LIMIT ? OFFSET ?`;
  args.push(opts.limit ?? 50, opts.offset ?? 0);
  const res = await db.execute({ sql, args });
  return res.rows;
}
async function unverifiedEmails(db, opts = {}) {
  const status = opts.status ?? "new";
  const res = await db.execute({
    sql: `SELECT email FROM leads WHERE email IS NOT NULL AND status = ? AND email_valid IS NULL
     ORDER BY created_at ASC LIMIT ?`,
    args: [status, opts.limit ?? 1e3]
  });
  return res.rows.map((r) => r.email);
}
async function upsertPerson(db, domain, person, company) {
  const name = (person.name ?? "").trim();
  if (!name) return "updated";
  const exists = await db.execute({
    sql: "SELECT id FROM people WHERE domain = ? AND lower(name) = lower(?) LIMIT 1",
    args: [domain, name]
  });
  const email = person.email?.toLowerCase().trim() ?? null;
  const title = person.title?.trim() ?? null;
  const linkedin = person.linkedin?.trim() ?? null;
  const github = person.github?.trim() ?? null;
  const sourceUrl = person.sourceUrl ?? null;
  const notes = person.notes ?? null;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (exists.rows.length > 0) {
    await db.execute({
      sql: `UPDATE people SET
        title      = COALESCE(?, title),
        email      = COALESCE(?, email),
        linkedin   = COALESCE(?, linkedin),
        github     = COALESCE(?, github),
        company    = COALESCE(?, company),
        source     = CASE WHEN ? = 'github' AND source = 'page' THEN source ELSE ? END,
        source_url = COALESCE(?, source_url),
        notes      = COALESCE(?, notes),
        updated_at = ?
       WHERE id = ?`,
      args: [
        title,
        email,
        linkedin,
        github,
        company ?? null,
        person.source ?? "page",
        person.source ?? "page",
        sourceUrl,
        notes,
        now,
        String(exists.rows[0].id)
      ]
    });
    return "updated";
  }
  await db.execute({
    sql: `INSERT INTO people (id, name, title, email, linkedin, github, domain, company, source, source_url, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      name,
      title,
      email,
      linkedin,
      github,
      domain,
      company ?? null,
      person.source ?? "page",
      sourceUrl,
      notes,
      now
    ]
  });
  return "new";
}
async function peopleForDomain(db, domain, opts = {}) {
  const res = await db.execute({
    sql: `SELECT * FROM people WHERE domain = ? ${opts.noEmail ? "AND (email IS NULL OR email = '')" : ""}
     ORDER BY created_at DESC LIMIT 1000`,
    args: [domain]
  });
  return res.rows;
}
async function knownEmailsForDomain(db, domain) {
  const res = await db.execute({
    sql: `SELECT email, person_name FROM leads
     WHERE domain = ? AND email IS NOT NULL AND person_name IS NOT NULL
       AND person_name != '' AND email_valid = 1 LIMIT 500`,
    args: [domain]
  });
  return res.rows.map((r) => ({ email: r.email, name: r.person_name }));
}
async function listPeople(db, opts = {}) {
  const where = [];
  const args = [];
  if (opts.domain) {
    where.push("domain = ?");
    args.push(opts.domain);
  }
  if (opts.noEmail) {
    where.push("(email IS NULL OR email = '')");
  }
  const sql = `SELECT * FROM people ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  args.push(opts.limit ?? 100, opts.offset ?? 0);
  const res = await db.execute({ sql, args });
  return res.rows;
}
async function upsertCandidate(db, c2) {
  await db.execute({
    sql: `INSERT INTO email_candidates (email, person_name, domain, pattern, score, reason, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       person_name = COALESCE(excluded.person_name, email_candidates.person_name),
       domain      = COALESCE(excluded.domain, email_candidates.domain),
       pattern     = COALESCE(excluded.pattern, email_candidates.pattern),
       score       = COALESCE(excluded.score, email_candidates.score),
       reason      = COALESCE(excluded.reason, email_candidates.reason),
       source_url  = COALESCE(excluded.source_url, email_candidates.source_url),
       updated_at  = excluded.updated_at`,
    args: [
      c2.email.toLowerCase(),
      c2.personName,
      c2.domain,
      c2.pattern,
      c2.score,
      c2.reason,
      null,
      (/* @__PURE__ */ new Date()).toISOString(),
      (/* @__PURE__ */ new Date()).toISOString()
    ]
  });
}
async function markCandidate(db, email, status, detail) {
  await db.execute({
    sql: `UPDATE email_candidates SET status = ?, detail = ?, updated_at = ? WHERE email = ?`,
    args: [status, detail ?? null, (/* @__PURE__ */ new Date()).toISOString(), email.toLowerCase()]
  });
}
async function candidatesForDomain(db, domain, opts = {}) {
  const status = opts.status ?? "all";
  const res = await db.execute({
    sql: `SELECT * FROM email_candidates WHERE domain = ? ${status !== "all" ? "AND status = ?" : ""}
     ORDER BY score DESC LIMIT ?`,
    args: status !== "all" ? [domain, status, opts.limit ?? 500] : [domain, opts.limit ?? 500]
  });
  return res.rows;
}
async function upsertRelation(db, fromDomain, relation, sourceUrl) {
  const target = (relation.target ?? "").trim();
  if (!target) return;
  const existing = await db.execute({
    sql: "SELECT id FROM company_relations WHERE from_domain = ? AND lower(target) = lower(?) AND type = ?",
    args: [fromDomain, target, relation.type]
  });
  const confidence = relation.confidence ?? 0.5;
  if (existing.rows.length > 0) {
    await db.execute({
      sql: `UPDATE company_relations SET target_domain = COALESCE(?, target_domain),
            evidence = COALESCE(?, evidence), confidence = MAX(confidence, ?),
            source_url = COALESCE(?, source_url) WHERE id = ?`,
      args: [
        relation.targetDomain ?? null,
        relation.evidence ?? null,
        confidence,
        sourceUrl ?? null,
        String(existing.rows[0].id)
      ]
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO company_relations (id, from_domain, type, target, target_domain, evidence, confidence, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      fromDomain,
      relation.type,
      target,
      relation.targetDomain ?? null,
      relation.evidence ?? null,
      confidence,
      sourceUrl ?? null
    ]
  });
}
async function relationsForDomain(db, domain, opts = {}) {
  const res = await db.execute({
    sql: "SELECT * FROM company_relations WHERE from_domain = ? ORDER BY confidence DESC LIMIT ?",
    args: [domain, opts.limit ?? 200]
  });
  return res.rows;
}
async function relatedDomainsFor(db, domain, opts = {}) {
  const res = await db.execute({
    sql: `SELECT target_domain AS domain, type FROM company_relations
           WHERE from_domain = ? AND target_domain IS NOT NULL AND target_domain != ?
          UNION
          SELECT from_domain AS domain, type FROM company_relations
           WHERE target_domain = ? AND from_domain != ?
          ORDER BY domain LIMIT ?`,
    args: [domain, domain, domain, domain, opts.limit ?? 200]
  });
  return res.rows;
}
async function leadsRelatedTo(db, domain, opts = {}) {
  const rel = await relatedDomainsFor(db, domain, { limit: 500 });
  if (rel.length === 0) return [];
  const domains = [...new Set(rel.map((r) => r.domain))];
  const placeholders = domains.map(() => "?").join(",");
  const args = [...domains];
  let scoreFilter = "";
  if (opts.minScore) {
    scoreFilter = " AND lead_score >= ?";
    args.push(opts.minScore);
  }
  const res = await db.execute({
    sql: `SELECT id, email, person_name, title, phone, company, domain, category, tier,
            confidence, email_type, email_source, email_pattern, email_score, interests, source_url, source, status,
            email_valid, verified_at, created_at, department, seniority, decision_maker, lead_score, lead_tier, icp_match
     FROM leads WHERE domain IN (${placeholders})${scoreFilter}
     ORDER BY lead_score DESC, created_at DESC LIMIT ${Number(opts.limit ?? 100)}`,
    args
  });
  return res.rows;
}
async function dbStats(db) {
  const byStatus = await db.execute(
    `SELECT status, COUNT(*) AS n FROM leads GROUP BY status ORDER BY n DESC`
  );
  const byCategory = await db.execute(
    `SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*) AS n FROM leads GROUP BY category ORDER BY n DESC`
  );
  const byEmailType = await db.execute(
    `SELECT COALESCE(email_type, 'unknown') AS email_type, COUNT(*) AS n FROM leads GROUP BY email_type ORDER BY n DESC`
  );
  const totals = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN email_valid = 1 THEN 1 ELSE 0 END) AS valid,
            SUM(CASE WHEN email_valid = 0 THEN 1 ELSE 0 END) AS invalid,
            SUM(CASE WHEN email_valid IS NULL AND email IS NOT NULL THEN 1 ELSE 0 END) AS unverified
     FROM leads`
  );
  const peopleCount = await db.execute(`SELECT COUNT(*) AS people FROM people`);
  const bySource = await db.execute(
    `SELECT COALESCE(email_source, 'unknown') AS email_source, COUNT(*) AS n
     FROM leads WHERE email IS NOT NULL GROUP BY email_source ORDER BY n DESC`
  );
  const byGrade = await db.execute(
    `SELECT COALESCE(lead_tier, 'none') AS lead_tier, COUNT(*) AS n FROM leads GROUP BY lead_tier ORDER BY n DESC`
  );
  const interestRows = await db.execute(
    `SELECT interests FROM leads WHERE interests IS NOT NULL AND interests != '[]' LIMIT 5000`
  );
  const interestCounts = /* @__PURE__ */ new Map();
  for (const row of interestRows.rows) {
    try {
      const list = JSON.parse(row.interests);
      for (const i of list) {
        if (i && i.topic) interestCounts.set(i.topic, (interestCounts.get(i.topic) ?? 0) + 1);
      }
    } catch {
    }
  }
  const topInterests = [...interestCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([topic, n]) => ({ topic, n }));
  return {
    byStatus: byStatus.rows,
    byCategory: byCategory.rows,
    byEmailType: byEmailType.rows,
    bySource: bySource.rows,
    byGrade: byGrade.rows,
    topInterests,
    totals: totals.rows[0],
    people: peopleCount.rows[0]?.people ?? 0
  };
}
async function recordRun(db, run) {
  await db.execute({
    sql: `INSERT INTO runs (id, target, source, started_at, finished_at, pages_crawled, leads_found, leads_verified, leads_invalid, errors)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.id,
      run.target,
      run.source,
      run.startedAt,
      run.finishedAt,
      run.pagesCrawled,
      run.leadsFound,
      run.verified,
      run.invalid,
      run.errors.length ? JSON.stringify(run.errors) : null
    ]
  });
}

// spider-leads/src/guess.ts
var LEARNED_PATTERN_BOOST = 0.35;
var PATTERN_PRIOR = {
  "first.last": 0.5,
  "firstlast": 0.18,
  "f.last": 0.1,
  "flast": 0.08,
  "first": 0.06,
  "first_last": 0.04,
  "firstl": 0.02,
  "last.first": 0.02
};
function learnPatterns(persons) {
  const counts = {};
  let total = 0;
  for (const p of persons) {
    const pat = patternOf(p.email, p.name);
    if (!pat) continue;
    counts[pat] = (counts[pat] ?? 0) + 1;
    total++;
  }
  return { counts, total };
}
function candidatesForPerson(person, domain, learned) {
  const name = person.name;
  const parts = splitName(name);
  if (!parts) return [];
  const base = asciiName(name);
  if (base.length < 4) return [];
  const ordered = rankPatterns(learned);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { pattern, score } of ordered) {
    const local = localPartFor(name, pattern);
    if (!local) continue;
    const email = local + "@" + domain;
    if (!isValidEmail(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      personName: name,
      domain,
      pattern,
      score: clamp(score),
      reason: score >= 0.6 ? "matches the domain's known convention (" + pattern + ")" : "common " + pattern + " pattern"
    });
  }
  return out;
}
function rankPatterns(learned) {
  const max = Math.max(1, learned.total);
  return [.../* @__PURE__ */ new Set([...Object.keys(learned.counts), ...PATTERN_LABELS])].map((pattern) => {
    const learnedScore = (learned.counts[pattern] ?? 0) / max;
    const prior = PATTERN_PRIOR[pattern] ?? 0.01;
    return { pattern, score: clamp(prior + learnedScore * LEARNED_PATTERN_BOOST) };
  }).sort((a, b) => b.score - a.score);
}
function clamp(n) {
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}
function guessLabel(score) {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// spider-leads/src/github.ts
var API = "https://api.github.com";
async function ghGet(path, base, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "spider-leads",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = "Bearer " + token;
  const resp = await fetch(base.replace(/\/$/, "") + path, { headers });
  if (resp.status === 404) return null;
  if (resp.status === 403 || resp.status === 429) {
    log.warn("GitHub API rate limit reached \u2014 skipping GitHub people discovery.");
    return null;
  }
  if (!resp.ok) {
    log.debug("GitHub API " + path + " failed (" + resp.status + ")");
    return null;
  }
  return await resp.json();
}
async function findGithubPeople(org, opts = {}) {
  const limit = opts.limit ?? 100;
  const base = opts.base ?? API;
  const members = await ghGet(`/orgs/${encodeURIComponent(org)}/members?per_page=${Math.min(limit, 100)}`, base, opts.token);
  if (!members || !Array.isArray(members)) return [];
  const profileCap = Math.min(limit, 25);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  let consecutiveMisses = 0;
  for (const m of members.slice(0, limit)) {
    if (out.length >= profileCap) break;
    const login = String(m.login ?? "");
    if (!login || seen.has(login)) continue;
    seen.add(login);
    const profile = await ghGet(`/users/${encodeURIComponent(login)}`, base, opts.token);
    if (!profile) {
      consecutiveMisses++;
      if (consecutiveMisses >= 3) break;
      continue;
    }
    consecutiveMisses = 0;
    const name = (profile.name ?? m.name ?? "").trim();
    const email = (profile.email ?? m.email ?? "").trim();
    if (!name && !email) continue;
    out.push({
      name: name || login,
      // fall back to login when no display name
      title: void 0,
      // GitHub does not expose titles for members
      email: email || void 0,
      github: "https://github.com/" + login,
      source: "github",
      notes: profile.bio ? profile.bio.slice(0, 200) : void 0
    });
  }
  return out;
}

// spider-leads/src/enrich.ts
var progress = (opts, msg) => {
  if (opts.onProgress) opts.onProgress(msg);
  else log.info(msg);
};
async function storePersons(db, domain, persons, company) {
  let newPeople = 0;
  for (const p of persons) {
    const outcome = await upsertPerson(db, domain, p, company);
    if (outcome === "new") newPeople++;
  }
  return { newPeople };
}
function publicEmailPersons(persons) {
  return persons.filter((p) => p.email && isValidEmail(p.email));
}
async function enrichDomain(db, cfg, domain, opts = {}) {
  const result = {
    domain,
    people: 0,
    candidatesGenerated: 0,
    candidatesVerified: 0,
    emailsFound: 0,
    invalid: 0,
    errors: [],
    emails: []
  };
  const perPerson = Math.max(1, opts.perPerson ?? 3);
  const verify = opts.verify !== false && !!cfg.plunkApiKey;
  const meta = { ...opts.meta ?? {} };
  if (!meta.company || !meta.category) {
    const existing = await firstLeadForDomain(db, domain);
    if (existing) {
      meta.company = meta.company ?? existing.company ?? domain;
      meta.category = meta.category ?? existing.category ?? void 0;
      meta.subcategory = meta.subcategory ?? existing.subcategory ?? void 0;
      meta.tier = meta.tier ?? existing.tier ?? void 0;
      meta.confidence = meta.confidence ?? existing.confidence ?? void 0;
      if (!meta.interests || meta.interests.length === 0) {
        try {
          const parsed = JSON.parse(existing.interests ?? "[]");
          if (Array.isArray(parsed) && parsed.length > 0) meta.interests = parsed;
        } catch {
        }
      }
    }
  }
  meta.company = meta.company ?? domain;
  const stored = await peopleForDomain(db, domain, { noEmail: true });
  const fresh = (opts.people ?? []).filter((p) => !p.email || !isValidEmail(p.email));
  if ((opts.people ?? []).length > 0 && !opts.dryRun) {
    const { newPeople } = await storePersons(db, domain, opts.people, meta.company ?? domain);
    result.people += newPeople;
  }
  let githubPeople = [];
  for (const org of opts.githubOrgs ?? []) {
    try {
      progress(opts, "GitHub: fetching public members of " + org);
      const members = await findGithubPeople(org, {
        token: opts.githubToken,
        base: opts.githubApiBase ?? cfg.githubApiBase
      });
      githubPeople = githubPeople.concat(members);
    } catch (err) {
      result.errors.push("github " + org + ": " + err.message);
      log.warn("GitHub " + org + ": " + err.message);
    }
  }
  if (githubPeople.length > 0 && !opts.dryRun) {
    const { newPeople } = await storePersons(db, domain, githubPeople, meta.company ?? domain);
    result.people += newPeople;
    for (const p of publicEmailPersons(githubPeople)) {
      await storePublicEmail(db, cfg, domain, p, opts, result, meta);
    }
  }
  const pool = dedupePersons([
    ...stored.map((r) => ({
      name: r.name,
      title: r.title ?? void 0,
      linkedin: r.linkedin ?? void 0,
      github: r.github ?? void 0,
      source: r.source,
      sourceUrl: r.source_url ?? void 0
    })),
    ...fresh,
    ...githubPeople.filter((p) => !p.email)
  ]);
  result.people = Math.max(result.people, pool.length);
  const noEmail = pool.filter((p) => !p.email || !isValidEmail(p.email));
  if (noEmail.length === 0) {
    progress(opts, domain + ": no people without emails \u2014 nothing to guess.");
    return result;
  }
  const known = await knownEmailsForDomain(db, domain);
  const learned = learnPatterns(known);
  if (learned.total > 0) {
    const top = Object.entries(learned.counts).sort((a, b) => b[1] - a[1])[0];
    progress(opts, domain + ": learned pattern '" + top[0] + "' from " + learned.total + " known email(s)");
  }
  const existingEmails = new Set(await emailsForDomain(db, domain));
  const invalidEmails = new Set(
    (await candidatesForDomain(db, domain, { status: "invalid", limit: 5e3 })).map((c2) => c2.email)
  );
  const candidates = [];
  const planned = /* @__PURE__ */ new Set();
  for (const person of noEmail) {
    const list = candidatesForPerson(person, domain, learned).slice(0, perPerson);
    for (const c2 of list) {
      if (planned.has(c2.email) || existingEmails.has(c2.email) || invalidEmails.has(c2.email)) continue;
      planned.add(c2.email);
      candidates.push(c2);
    }
  }
  result.candidatesGenerated = candidates.length;
  progress(opts, domain + ": " + noEmail.length + " person(s) \u2192 " + candidates.length + " candidate email(s)");
  if (candidates.length === 0) return result;
  if (!verify) {
    let persisted = 0;
    for (const c2 of candidates) {
      if (!opts.dryRun) {
        await upsertCandidate(db, c2);
        persisted++;
      }
    }
    if (persisted > 0) {
      log.warn("Verification skipped (no PLUNK_API_KEY or verify disabled) \u2014 candidates saved as pending.");
    }
    return result;
  }
  if (opts.dryRun) return result;
  progress(opts, "Verifying " + candidates.length + " candidate email(s) with Plunk\u2026");
  const byEmail = new Map(candidates.map((c2) => [c2.email, c2]));
  const titleByName = new Map(noEmail.map((p) => [p.name.toLowerCase(), p.title]));
  await verifyBatch(cfg, candidates.map((c2) => c2.email), {
    concurrency: opts.concurrency ?? 5,
    onResult: async (email, res, err) => {
      result.candidatesVerified++;
      const candidate = byEmail.get(email);
      if (!candidate) return;
      if (err) {
        result.errors.push(email + ": " + err.message);
        await upsertCandidate(db, candidate);
        await markCandidate(db, email, "error", err.message);
        return;
      }
      if (res.valid) {
        if (!opts.dryRun) {
          await upsertCandidate(db, candidate);
          await markCandidate(db, email, "valid", "Plunk verified");
          const personTitle = titleByName.get(candidate.personName.toLowerCase());
          const interests = meta.interests ?? [];
          const cls = classifyTitle(personTitle);
          const icp = icpMatch(meta.category, interests.map((i) => i.topic), cfg.icpCategories, cfg.icpInterests);
          const { score: lscore, grade } = scoreLead({
            emailValid: 1,
            emailScore: candidate.score,
            emailSource: "guessed",
            companyTier: meta.tier,
            companyConfidence: meta.confidence,
            icpMatch: icp,
            title: personTitle
          });
          await upsertLead(db, {
            email,
            emailType: classifyEmailType(email),
            emailSource: "guessed",
            emailPattern: candidate.pattern,
            emailScore: candidate.score,
            personName: candidate.personName,
            title: personTitle ?? null,
            phone: null,
            linkedin: null,
            company: meta.company ?? domain,
            domain,
            category: meta.category ?? null,
            subcategory: meta.subcategory ?? null,
            tier: meta.tier ?? null,
            confidence: meta.confidence ?? candidate.score,
            interests,
            department: cls.department,
            seniority: cls.seniority,
            decisionMaker: cls.decisionMaker,
            leadScore: lscore,
            leadTier: grade,
            icpMatch: icp,
            sourceUrl: null,
            source: "guess",
            raw: { guess: true, candidate }
          });
          await recordVerification(db, email, res);
          result.emails.push({
            email,
            personName: candidate.personName,
            pattern: candidate.pattern,
            score: candidate.score
          });
          log.ok("  \u2713 guessed " + email + " (" + candidate.pattern + ", " + candidate.score + ")");
          result.emailsFound++;
        }
      } else {
        await upsertCandidate(db, candidate);
        await markCandidate(db, email, "invalid", (res.reasons ?? []).join("; "));
        result.invalid++;
        log.debug("  \u2717 " + email + " invalid");
      }
    }
  });
  return result;
}
async function storePublicEmail(db, cfg, domain, person, opts, result, meta) {
  const email = person.email.toLowerCase().trim();
  if (!isValidEmail(email)) return;
  const lead = githubLead(email, person, domain, meta, cfg);
  if (opts.verify !== false && cfg.plunkApiKey) {
    try {
      const res = await verifyEmail(cfg, email);
      if (!res.valid) {
        result.invalid++;
        log.debug("  \u2717 github " + email + " invalid \u2014 not stored");
        return;
      }
      await upsertLead(db, lead);
      await recordVerification(db, email, res);
    } catch (err) {
      result.errors.push(email + ": " + err.message);
      return;
    }
  } else {
    await upsertLead(db, lead);
  }
  result.emails.push({
    email,
    personName: person.name,
    pattern: "published",
    score: 0.8
  });
  result.emailsFound++;
}
function githubLead(email, person, domain, meta, cfg) {
  const interests = meta.interests ?? [];
  const cls = classifyTitle(person.title);
  const icp = icpMatch(meta.category, interests.map((i) => i.topic), cfg.icpCategories, cfg.icpInterests);
  const { score, grade } = scoreLead({
    emailValid: null,
    emailScore: null,
    emailSource: "github",
    companyTier: meta.tier,
    companyConfidence: meta.confidence,
    icpMatch: icp,
    title: person.title
  });
  return {
    email,
    emailType: classifyEmailType(email),
    emailSource: "github",
    personName: person.name,
    title: person.title ?? null,
    phone: null,
    linkedin: person.linkedin ?? null,
    company: meta.company ?? domain,
    domain,
    category: meta.category ?? null,
    subcategory: meta.subcategory ?? null,
    tier: meta.tier ?? null,
    confidence: meta.confidence ?? 0.8,
    interests,
    department: cls.department,
    seniority: cls.seniority,
    decisionMaker: cls.decisionMaker,
    leadScore: score,
    leadTier: grade,
    icpMatch: icp,
    sourceUrl: person.sourceUrl ?? null,
    source: "github",
    raw: { github: true, person }
  };
}
function dedupePersons(persons) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of persons) {
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
async function emailsForDomain(db, domain) {
  try {
    const res = await db.execute({
      sql: "SELECT email FROM leads WHERE domain = ? AND email IS NOT NULL LIMIT 5000",
      args: [domain]
    });
    return res.rows.map((r) => r.email.toLowerCase());
  } catch {
    return [];
  }
}
async function firstLeadForDomain(db, domain) {
  try {
    const res = await db.execute({
      sql: `SELECT company, category, subcategory, tier, confidence, interests FROM leads
       WHERE domain = ? ORDER BY created_at DESC LIMIT 1`,
      args: [domain]
    });
    const row = res.rows[0];
    return row ?? null;
  } catch {
    return null;
  }
}

// spider-leads/src/hooks.ts
async function fireHook(plugins, hook, ctx, errors) {
  for (const p of plugins) {
    const fn = (p.hooks ?? {})[hook];
    if (typeof fn !== "function") continue;
    try {
      await fn(ctx);
    } catch (err) {
      const msg = "plugin " + p.id + " hook " + hook + ": " + err.message;
      errors.push(msg);
      log.warn(msg);
    }
  }
}

// spider-leads/src/pipeline.ts
var defaultRunOptions = (cfg) => ({
  limit: cfg.crawlLimit,
  depth: cfg.crawlDepth,
  mode: "smart",
  extract: cfg.spiderExtract,
  verify: cfg.verifyOnHunt,
  guessEmails: cfg.guessEmails,
  perPerson: cfg.guessPerPerson,
  dryRun: false,
  concurrency: 4
});
async function pMap(items, concurrency, fn) {
  const results = [];
  const errors = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        results.push(await fn(item));
      } catch (err) {
        errors.push(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
  return { results, errors };
}
function toRootUrl(target) {
  if (/^https?:\/\//.test(target)) {
    const u = new URL(target);
    return u.protocol + "//" + u.hostname;
  }
  return "https://" + target;
}
async function collectPages(cfg, rootUrl, urls, opts) {
  const targets = [rootUrl, ...urls.filter((u) => u !== rootUrl)];
  const { results, errors } = await pMap(
    targets,
    opts.concurrency,
    (url) => scrapePage(cfg, url, { mode: opts.mode })
  );
  return { pages: results.filter((p) => p.markdown.trim().length > 0), errors };
}
function normalizeContacts(contacts, pages) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const c2 of contacts) {
    const email = c2.email?.toLowerCase().trim() ?? "";
    const phone = c2.phone?.trim() ?? "";
    if (email && !isValidEmail(email)) continue;
    const name = c2.person_name?.trim() ?? "";
    if (!email && !phone && !(name && (c2.title || c2.linkedin))) continue;
    const key = email ? email : phone ? "p:" + phone : "n:" + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      email: email || void 0,
      person_name: name || (email ? emailNameHint(email) ?? void 0 : void 0),
      title: c2.title?.trim() || void 0,
      phone: phone || void 0,
      linkedin: c2.linkedin?.trim() || void 0,
      github: c2.github?.trim() || void 0
    });
  }
  return out;
}
async function verifyEmails(db, cfg, emails, opts = {}) {
  let verified = 0, invalid = 0, failed = 0, done = 0;
  const total = emails.length;
  await verifyBatch(cfg, emails, {
    concurrency: opts.concurrency ?? 5,
    onResult: async (email, res, err) => {
      done++;
      if (err) {
        failed++;
        log.warn("verify " + email + ": " + err.message);
      } else if (res.valid) {
        verified++;
        log.ok(email + " \u2014 valid");
      } else {
        invalid++;
        log.warn(email + " \u2014 INVALID");
      }
      await recordVerification(db, email, res, err);
      opts.onStatus?.(done, total, verified, invalid);
    }
  });
  return { verified, invalid, failed };
}
function emptyRun(target, source) {
  return {
    id: crypto.randomUUID(),
    target,
    source,
    pagesCrawled: 0,
    leadsFound: 0,
    leadsNew: 0,
    leadsUpdated: 0,
    leadsVerified: 0,
    leadsInvalid: 0,
    peopleFound: 0,
    guessesMade: 0,
    guessedEmailsFound: 0,
    guessedInvalid: 0,
    errors: []
  };
}
function mergeRun(target, src) {
  target.pagesCrawled += src.pagesCrawled;
  target.leadsFound += src.leadsFound;
  target.leadsNew += src.leadsNew;
  target.leadsUpdated += src.leadsUpdated;
  target.leadsVerified += src.leadsVerified;
  target.leadsInvalid += src.leadsInvalid;
  target.peopleFound += src.peopleFound;
  target.guessesMade += src.guessesMade;
  target.guessedEmailsFound += src.guessedEmailsFound;
  target.guessedInvalid += src.guessedInvalid;
  target.errors.push(...src.errors);
}
async function storeAndVerify(db, cfg, domain, company, cat, contacts, pages, opts, summary) {
  const leads = normalizeContacts(contacts, pages);
  summary.leadsFound += leads.filter((c2) => c2.email || c2.phone).length;
  const freshEmails = [];
  const persons = leads.filter((c2) => c2.person_name).map((c2) => ({
    name: c2.person_name,
    title: c2.title,
    linkedin: c2.linkedin,
    github: c2.github,
    email: c2.email,
    source: "page",
    sourceUrl: pages[0]?.url
  }));
  if (!opts.dryRun && persons.length > 0) {
    const { newPeople } = await storePersons(db, domain, persons, company);
    summary.peopleFound += newPeople;
  }
  for (const c2 of leads) {
    if (!c2.email && !c2.phone) continue;
    const interests = cat.interests ?? [];
    const cls = classifyTitle(c2.title);
    const icp = icpMatch(cat.category, interests.map((i) => i.topic), cfg.icpCategories, cfg.icpInterests);
    const { score, grade } = scoreLead({
      emailValid: null,
      emailScore: null,
      emailSource: c2.email ? "page" : "unknown",
      companyTier: cat.tier,
      companyConfidence: cat.confidence,
      icpMatch: icp,
      title: c2.title
    });
    const lead = {
      email: c2.email ?? null,
      emailType: c2.email ? classifyEmailType(c2.email) : null,
      emailSource: c2.email ? "page" : "unknown",
      personName: c2.person_name ?? null,
      title: c2.title ?? null,
      phone: c2.phone ?? null,
      linkedin: c2.linkedin ?? null,
      company: company || domain,
      domain,
      category: cat.category,
      subcategory: cat.subcategory,
      tier: cat.tier,
      confidence: cat.confidence,
      interests,
      department: cls.department,
      seniority: cls.seniority,
      decisionMaker: cls.decisionMaker,
      leadScore: score,
      leadTier: grade,
      icpMatch: icp,
      sourceUrl: pages[0]?.url ?? toRootUrl(domain),
      source: summary.source,
      raw: { contact: c2, category: cat }
    };
    if (opts.dryRun) {
      log.debug("[dry-run] would store " + (c2.email ?? c2.phone ?? "(no contact info)"));
      continue;
    }
    const outcome = await upsertLead(db, lead);
    if (outcome === "new") {
      summary.leadsNew++;
      if (c2.email && opts.verify) freshEmails.push(c2.email);
    } else {
      summary.leadsUpdated++;
    }
    if (opts.plugins && opts.plugins.length > 0) {
      await fireHook(opts.plugins, "onLead", { lead, outcome }, summary.errors);
    }
  }
  if (!opts.dryRun && cat.relations && cat.relations.length > 0) {
    for (const rel of cat.relations) {
      await upsertRelation(db, domain, rel, pages[0]?.url);
    }
    log.info("Relations: " + cat.relations.length + " recorded for " + domain);
  }
  if (opts.verify && !opts.dryRun && freshEmails.length > 0) {
    if (!cfg.plunkApiKey) {
      log.warn("VERIFY_ON_HUNT is enabled but PLUNK_API_KEY is not set \u2014 skipping verification.");
    } else {
      log.step("Verifying " + freshEmails.length + " new email(s) with Plunk\u2026");
      const { verified, invalid } = await verifyEmails(db, cfg, freshEmails, { concurrency: opts.concurrency });
      summary.leadsVerified += verified;
      summary.leadsInvalid += invalid;
    }
  }
  const peopleWithoutEmail = persons.filter((p) => !p.email);
  if (opts.guessEmails && !opts.dryRun && peopleWithoutEmail.length > 0) {
    if (!cfg.plunkApiKey) {
      log.warn("GUESS_EMAILS is on but PLUNK_API_KEY is not set \u2014 skipping email inference.");
    } else {
      log.step("Inferring employee emails for " + peopleWithoutEmail.length + " person(s) at " + domain + "\u2026");
      const res = await enrichDomain(db, cfg, domain, {
        people: peopleWithoutEmail,
        verify: true,
        perPerson: opts.perPerson,
        concurrency: opts.concurrency,
        githubOrgs: opts.githubOrgs,
        githubToken: cfg.githubToken,
        meta: { company, ...cat }
      });
      summary.peopleFound = Math.max(summary.peopleFound, res.people);
      summary.guessesMade += res.candidatesVerified;
      summary.guessedEmailsFound += res.emailsFound;
      summary.guessedInvalid += res.invalid;
      summary.errors.push(...res.errors);
      log.ok("Employee email inference: " + res.emailsFound + " found, " + res.invalid + " invalid.");
    }
  }
}
async function hunt(db, cfg, targets, opts) {
  requireSpiderKey(cfg);
  const merged = emptyRun(targets.join(", "), "hunt");
  for (const target of targets) {
    const run = await huntOne(db, cfg, target, opts);
    mergeRun(merged, run);
  }
  return merged;
}
async function huntOne(db, cfg, target, opts) {
  const summary = emptyRun(target, "hunt");
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const rootUrl = toRootUrl(target);
  const domain = domainOf(rootUrl);
  log.step("Hunting " + domain);
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "beforeRun", { source: "hunt", target: domain }, summary.errors);
  }
  const extraction = await extractContactsFromSite(cfg, target, opts);
  summary.errors.push(...extraction.errors);
  summary.pagesCrawled += extraction.pages.length;
  if (extraction.linksFound === 0) {
    log.warn("No links returned for " + domain);
    await recordRun(db, {
      id: summary.id,
      target: domain,
      source: "hunt",
      startedAt,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pagesCrawled: 0,
      leadsFound: 0,
      verified: 0,
      invalid: 0,
      errors: summary.errors
    });
    return summary;
  }
  const contacts = extraction.contacts;
  const pages = extraction.pages;
  const cat = await categorizeDomain(cfg, domain, pages.length > 0 ? pages : [{ url: rootUrl, markdown: "", status: 200 }]);
  log.info("Category: " + cat.category + " (" + cat.method + ", confidence " + cat.confidence.toFixed(2) + ")");
  await storeAndVerify(db, cfg, domain, domain, cat, contacts, pages, opts, summary);
  await recordRun(db, {
    id: summary.id,
    target: domain,
    source: "hunt",
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pagesCrawled: pages.length,
    leadsFound: summary.leadsFound,
    verified: summary.leadsVerified,
    invalid: summary.leadsInvalid,
    errors: summary.errors
  });
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "afterRun", { summary }, summary.errors);
  }
  return summary;
}
async function extractContactsFromSite(cfg, target, opts) {
  const rootUrl = toRootUrl(target);
  const domain = domainOf(rootUrl);
  const errors = [];
  const links = await getSiteLinks(cfg, rootUrl, { limit: Math.max(opts.limit * 5, 50), mode: opts.mode });
  log.info(links.length + " link(s) discovered for " + domain);
  if (links.length === 0) {
    return { contacts: [], pages: [], errors: [domain + ": no links returned"], linksFound: 0, linksSelected: 0, domain };
  }
  let selected = [];
  if (opts.urlFilter) {
    try {
      const re = new RegExp(opts.urlFilter, "i");
      selected = [...new Set(links.filter((u) => re.test(u)))];
    } catch {
      log.warn("Invalid --filter regex " + opts.urlFilter + "; ignoring");
    }
  }
  if (selected.length === 0) selected = filterContactUrls(links, opts.limit);
  log.info("Selected " + selected.length + " page(s) for extraction");
  const { pages, errors: scrapeErrors } = await collectPages(cfg, rootUrl, selected, opts);
  for (const e of scrapeErrors) errors.push(domain + ": " + e.message);
  log.info("Scraped " + pages.length + " page(s)");
  let contacts = [];
  if (opts.extract === "spider" || opts.extract === "auto") {
    try {
      contacts = await extractContactsSpider(cfg, rootUrl, { limit: opts.limit });
      log.info("Spider AI extraction returned " + contacts.length + " raw record(s)");
    } catch (err) {
      if (opts.extract === "spider") throw err;
      log.warn("Spider AI extraction unavailable (" + err.message + ") \u2014 using local extraction");
    }
  }
  if (contacts.length === 0) {
    contacts = await parseContacts(cfg, pages, domain);
    log.info("Local extraction found " + contacts.length + " contact record(s)");
  }
  return { contacts, pages, errors, linksFound: links.length, linksSelected: selected.length, domain };
}
async function huntSearch(db, cfg, query, opts) {
  requireSpiderKey(cfg);
  const summary = emptyRun(query, "search");
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "beforeRun", { source: "search", target: query }, summary.errors);
  }
  log.step("Searching: " + query);
  const pages = await searchPages(cfg, query, { limit: opts.limit, mode: opts.mode });
  summary.pagesCrawled = pages.length;
  log.info("Search returned " + pages.length + " page(s)");
  const byDomain = /* @__PURE__ */ new Map();
  for (const p of pages) {
    const d = domainOf(p.url);
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(p);
  }
  for (const [domain, domainPages] of byDomain) {
    log.step("Processing " + domain);
    const cat = await categorizeDomain(cfg, domain, domainPages);
    const contacts = await parseContacts(cfg, domainPages, domain);
    log.info(contacts.length + " contact(s), category " + cat.category);
    await storeAndVerify(db, cfg, domain, domain, cat, contacts, domainPages, opts, summary);
  }
  await recordRun(db, {
    id: summary.id,
    target: query,
    source: "search",
    startedAt,
    finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pagesCrawled: pages.length,
    leadsFound: summary.leadsFound,
    verified: summary.leadsVerified,
    invalid: summary.leadsInvalid,
    errors: summary.errors
  });
  if (opts.plugins && opts.plugins.length > 0) {
    await fireHook(opts.plugins, "afterRun", { summary }, summary.errors);
  }
  return summary;
}
async function verifyStored(db, cfg, opts) {
  if (!cfg.plunkApiKey) throw new Error("PLUNK_API_KEY is not set. Add it to .env to verify emails.");
  const emails = await unverifiedEmails(db, { limit: opts.limit, status: opts.status });
  if (emails.length === 0) {
    log.info("No unverified emails found.");
    return { checked: 0, verified: 0, invalid: 0, failed: 0 };
  }
  log.step("Verifying " + emails.length + " email(s) with Plunk\u2026");
  const res = await verifyEmails(db, cfg, emails, { concurrency: opts.concurrency ?? 5 });
  return { checked: emails.length, ...res };
}
async function ensureDb(cfg) {
  const db = openDb(cfg);
  await initSchema(db);
  return db;
}
var EMPLOYEE_AI_PROMPT = "Extract every team member and employee shown on this site: full name, job title, department (engineering/sales/marketing/product/operations/finance/hr/legal/other), LinkedIn URL, GitHub URL, and any published email. Include people WITHOUT an email (email stays null). Only include people actually listed on the site.";
var EMPLOYEE_SCHEMA = {
  name: "employees",
  description: "Team members and employees of the company",
  schema: {
    type: "object",
    properties: {
      employees: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            title: { type: "string" },
            department: { type: "string" },
            email: { type: ["string", "null"] },
            linkedin: { type: ["string", "null"] },
            github: { type: ["string", "null"] }
          }
        }
      }
    }
  }
};
async function extractEmployeesAiStudio(cfg, rootUrl, opts) {
  const errors = [];
  const pages = [];
  const contacts = [];
  const results = await aiStudioExtract(cfg, "crawl", rootUrl, EMPLOYEE_AI_PROMPT, {
    limit: opts.limit,
    metadata: true,
    schema: EMPLOYEE_SCHEMA
  });
  for (const r of results) {
    if (r.url) pages.push({ url: r.url, markdown: typeof r.content === "string" ? r.content : "", status: r.status });
    if (r.error) errors.push(String(r.error));
    const data = r.extractedData;
    const items = Array.isArray(data) ? data : Array.isArray(data?.employees) ? data.employees : Array.isArray(data?.people) ? data.people : [];
    for (const e of items) {
      if (!e?.name && !e?.email) continue;
      contacts.push({
        person_name: e.name ?? void 0,
        title: e.title ?? void 0,
        email: e.email ?? void 0,
        linkedin: e.linkedin ?? void 0,
        github: e.github ?? void 0
      });
    }
  }
  const domain = domainOf(rootUrl);
  return { contacts, pages, errors, linksFound: results.length, linksSelected: results.length, domain };
}
async function findEmployees(db, cfg, targets, opts) {
  requireSpiderKey(cfg);
  const merged = emptyRun(targets.join(", "), "employees");
  for (const target of targets) {
    const summary = emptyRun(target, "employees");
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const rootUrl = toRootUrl(target);
    const domain = domainOf(rootUrl);
    log.step("Employees: " + domain);
    let extraction;
    if (cfg.aiStudio) {
      log.info("Using AI Studio employee extraction (credits apply)");
      try {
        extraction = await extractEmployeesAiStudio(cfg, rootUrl, opts);
      } catch (err) {
        log.warn("AI Studio extraction failed (" + err.message + ") \u2014 falling back to standard extraction");
        extraction = await extractContactsFromSite(cfg, target, opts);
      }
    } else {
      extraction = await extractContactsFromSite(cfg, target, opts);
    }
    summary.errors.push(...extraction.errors);
    summary.pagesCrawled += extraction.pages.length;
    const contacts = extraction.contacts;
    const pages = extraction.pages;
    if (contacts.length === 0) {
      log.warn("No people found for " + domain);
      summary.errors.push(domain + ": no employees found");
      await recordRun(db, {
        id: summary.id,
        target: domain,
        source: "employees",
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        pagesCrawled: pages.length,
        leadsFound: 0,
        verified: 0,
        invalid: 0,
        errors: summary.errors
      });
      mergeRun(merged, summary);
      continue;
    }
    const people = contacts.filter((c2) => c2.person_name).length;
    log.info(people + " person(s) found on " + domain);
    const cat = await categorizeDomain(cfg, domain, pages.length > 0 ? pages : [{ url: rootUrl, markdown: "", status: 200 }]);
    await storeAndVerify(db, cfg, domain, domain, cat, contacts, pages, opts, summary);
    await recordRun(db, {
      id: summary.id,
      target: domain,
      source: "employees",
      startedAt,
      finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
      pagesCrawled: pages.length,
      leadsFound: summary.leadsFound,
      verified: summary.leadsVerified,
      invalid: summary.leadsInvalid,
      errors: summary.errors
    });
    mergeRun(merged, summary);
  }
  return merged;
}

// spider-leads/src/tools.ts
function def(t) {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  };
}
function toolDefs(tools) {
  return Object.values(tools).map(def);
}
var preview = (s, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);
function buildTools(cfg, db, opts = {}) {
  const limit = opts.limit ?? 10;
  const tools = {
    search_web: {
      name: "search_web",
      description: 'Search the web for a query and return matching pages with content previews. Use this to discover target companies/sites (e.g. "fintech companies in Austin").',
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          limit: { type: "integer", description: "Max results (default " + limit + ")" }
        },
        required: ["query"]
      },
      async run(args) {
        const pages = await searchPages(cfg, String(args.query ?? ""), { limit: Number(args.limit) || limit });
        return JSON.stringify({
          count: pages.length,
          results: pages.map((p) => ({ url: p.url, status: p.status, preview: preview(p.markdown) }))
        });
      }
    },
    crawl_site: {
      name: "crawl_site",
      description: "Crawl a website starting from a URL and return the discovered pages with content previews.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Starting URL (e.g. https://acme.com)" },
          limit: { type: "integer", description: "Max pages (default " + limit + ")" },
          depth: { type: "integer", description: "Link depth (default 2)" }
        },
        required: ["url"]
      },
      async run(args) {
        const pages = await crawlPages(cfg, String(args.url), {
          limit: Number(args.limit) || limit,
          depth: Number(args.depth) || 2
        });
        return JSON.stringify({
          count: pages.length,
          pages: pages.map((p) => ({ url: p.url, status: p.status, preview: preview(p.markdown) }))
        });
      }
    },
    get_links: {
      name: "get_links",
      description: "List internal links of a website without fetching full page content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Website URL" },
          limit: { type: "integer", description: "Max links (default 50)" }
        },
        required: ["url"]
      },
      async run(args) {
        const urls = await getSiteLinks(cfg, String(args.url), { limit: Number(args.limit) || 50 });
        return JSON.stringify({ count: urls.length, urls: urls.slice(0, 100) });
      }
    },
    extract_contacts: {
      name: "extract_contacts",
      description: "Extract contact information (emails, names, titles, phones, LinkedIn) from a company website. Crawls contact-likely pages (team/about/contact), then uses AI (or regex fallback). Each contact includes an email_type classification: corporate, business, student, or personal.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Company domain or URL, e.g. https://acme.com" },
          limit: { type: "integer", description: "Max pages to scrape (default " + limit + ")" }
        },
        required: ["url"]
      },
      async run(args) {
        const url = String(args.url ?? "");
        if (!/^https?:\/\//.test(url)) {
          return JSON.stringify({ error: "url must be absolute, e.g. https://acme.com" });
        }
        const extraction = await extractContactsFromSite(cfg, url, {
          limit: Number(args.limit) || limit,
          depth: 2,
          mode: "smart",
          extract: cfg.spiderExtract,
          verify: false,
          dryRun: false,
          concurrency: 4,
          guessEmails: false,
          perPerson: 3
        });
        return JSON.stringify({
          domain: extraction.domain,
          linksFound: extraction.linksFound,
          pagesScraped: extraction.pages.length,
          errors: extraction.errors,
          contacts: normalizeContacts(extraction.contacts, extraction.pages).map((c2) => ({
            email: c2.email ?? null,
            email_type: c2.email ? classifyEmailType(c2.email) : null,
            person_name: c2.person_name ?? null,
            title: c2.title ?? null,
            phone: c2.phone ?? null,
            linkedin: c2.linkedin ?? null
          }))
        });
      }
    },
    fetch_structured: {
      name: "fetch_structured",
      description: "Structured extraction via Spider's curated per-website scraper configs (Fetch API). Best for sites with public configs (zillow.com listings, indeed.com jobs, yelp.com businesses, news sites) \u2014 returns structured items, metadata, and links. Use scrape/crawl_site for plain pages, fetch_structured for marketplace data.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL or domain/path, e.g. https://zillow.com/homes/" },
          limit: { type: "integer", description: "Max pages to crawl (default 1, max 100)" },
          readability: { type: "boolean", description: "Strip navigation/ads (default false)" }
        },
        required: ["url"]
      },
      async run(args) {
        const url = String(args.url ?? "");
        if (!url) return JSON.stringify({ error: "url required" });
        try {
          const data = await fetchStructured(cfg, url, {
            limit: Number(args.limit) || 1,
            readability: !!args.readability
          });
          const items = Array.isArray(data.css_extracted) ? data.css_extracted.slice(0, 25) : data.css_extracted && typeof data.css_extracted === "object" ? data.css_extracted.items?.slice(0, 25) ?? [] : [];
          return JSON.stringify({
            url: data.url,
            status: data.status,
            metadata: data.metadata ?? null,
            items,
            links: (data.links ?? []).slice(0, 60),
            content: typeof data.content === "string" ? preview(data.content, 500) : null
          });
        } catch (err) {
          return JSON.stringify({ error: String(err.message) });
        }
      }
    },
    categorize_company: {
      name: "categorize_company",
      description: "Classify a company: industry category (SaaS, Agency, E-commerce\u2026), tier, confidence, and interest topics (e.g. AI / Machine Learning, Sustainability) derived from its website.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain, e.g. acme.com" }
        },
        required: ["domain"]
      },
      async run(args) {
        const domain = String(args.domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
        let pages = [];
        try {
          pages = [await scrapePage(cfg, toRoot(domain), { mode: "smart" })];
        } catch (err) {
          log.debug("categorize_company: could not scrape " + domain + ": " + err.message);
        }
        const cat = await categorizeDomain(cfg, domain, pages);
        return JSON.stringify(cat);
      }
    },
    verify_email: {
      name: "verify_email",
      description: "Verify a single email address with Plunk: validity, disposable/personal flags, MX records, typos. If the email is already stored, its verification status is updated in the database.",
      parameters: {
        type: "object",
        properties: { email: { type: "string", description: "Email address to verify" } },
        required: ["email"]
      },
      async run(args) {
        const email = String(args.email ?? "").toLowerCase().trim();
        if (!isValidEmail(email)) return JSON.stringify({ error: "invalid email address: " + email });
        if (!cfg.plunkApiKey) {
          return JSON.stringify({ error: "PLUNK_API_KEY is not set \u2014 cannot verify emails" });
        }
        const res = await verifyEmail(cfg, email);
        try {
          await recordVerification(db, email, res);
        } catch (err) {
          log.debug("verify_email: could not persist result: " + err.message);
        }
        return JSON.stringify(res);
      }
    },
    find_employees: {
      name: "find_employees",
      description: "Discover named employees at a company: crawls team/leadership/contact pages and returns people with name, title, LinkedIn and any published email. People without emails can then be fed to guess_emails to infer their addresses.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Company domain or URL, e.g. https://acme.com" },
          limit: { type: "integer", description: "Max pages to scrape (default " + limit + ")" }
        },
        required: ["url"]
      },
      async run(args) {
        const url = String(args.url ?? "");
        if (!/^https?:\/\//.test(url)) {
          return JSON.stringify({ error: "url must be absolute, e.g. https://acme.com" });
        }
        const extraction = await extractContactsFromSite(cfg, url, {
          limit: Number(args.limit) || limit,
          depth: 2,
          mode: "smart",
          extract: cfg.spiderExtract,
          verify: false,
          dryRun: false,
          concurrency: 4,
          guessEmails: false,
          perPerson: 3
        });
        const contacts = normalizeContacts(extraction.contacts, extraction.pages);
        const pageText = extraction.pages.map((p) => p.markdown).join("\n");
        const githubOrgs = extractGithubOrgs(pageText);
        const people = contacts.filter((c2) => c2.person_name).map((c2) => ({
          name: c2.person_name,
          title: c2.title,
          linkedin: c2.linkedin,
          github: c2.github,
          email: c2.email,
          source: "page",
          sourceUrl: extraction.pages[0]?.url
        }));
        return JSON.stringify({
          domain: extraction.domain,
          pagesScraped: extraction.pages.length,
          githubOrgs,
          people: people.map((p) => ({
            name: p.name,
            title: p.title ?? null,
            email: p.email ?? null,
            linkedin: p.linkedin ?? null
          })),
          peopleWithoutEmail: people.filter((p) => !p.email).length
        });
      }
    },
    guess_emails: {
      name: "guess_emails",
      description: "Infer employee emails for a company domain: takes named people (discovered via find_employees or already stored), generates candidate addresses using the domain's learned email convention (first.last, firstlast, \u2026), verifies them with Plunk, and stores valid ones as leads. Returns each found email with its pattern and confidence.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain, e.g. acme.com" },
          per_person: { type: "integer", description: "Max candidates per person (default 3)" },
          verify: { type: "boolean", description: "Verify candidates with Plunk (default true)" },
          github_orgs: { type: "string", description: "Comma-separated GitHub orgs for extra people" }
        },
        required: ["domain"]
      },
      async run(args) {
        const domain = String(args.domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (!domain) return JSON.stringify({ error: "domain required" });
        const githubOrgs = String(args.github_orgs ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const res = await enrichDomain(db, cfg, domain, {
          verify: args.verify !== false,
          perPerson: Number(args.per_person) || 3,
          githubOrgs,
          githubToken: cfg.githubToken,
          meta: { company: domain }
        });
        return JSON.stringify(res);
      }
    },
    extract_employees: {
      name: "extract_employees",
      description: "Employee scraper for a company site: extracts every person (name, title, department, LinkedIn/GitHub, published email) \u2014 via Spider AI Studio prompt\u2192JSON when enabled, otherwise via the standard contact pipeline. People without emails are stored and can be fed to guess_emails. Returns how many people/leads were found.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Company domain or URL, e.g. https://acme.com" },
          limit: { type: "integer", description: "Max pages to crawl (default 10)" },
          guess: { type: "boolean", description: "Also infer employee emails (default false)" }
        },
        required: ["url"]
      },
      async run(args) {
        const url = String(args.url ?? "");
        if (!url) return JSON.stringify({ error: "url required" });
        const opts2 = defaultRunOptions(cfg);
        opts2.limit = Number(args.limit) || 10;
        opts2.guessEmails = args.guess === true;
        opts2.verify = !!cfg.plunkApiKey;
        const summary = await findEmployees(db, cfg, [url], opts2);
        return JSON.stringify({
          target: summary.target,
          pagesCrawled: summary.pagesCrawled,
          peopleFound: summary.peopleFound,
          leadsFound: summary.leadsFound,
          leadsNew: summary.leadsNew,
          emailsVerified: summary.leadsVerified,
          emailsFoundGuessed: summary.guessedEmailsFound,
          errors: summary.errors
        });
      }
    },
    list_scrapers: {
      name: "list_scrapers",
      description: "Browse Spider's scraper-directory catalog (curated per-site scraper configs). Returns domains/paths with confidence + field counts so you can pick targets for fetch_structured. No API key needed.",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Filter by domain, e.g. zillow.com" },
          limit: { type: "integer", description: "Max rows (default 20)" }
        }
      },
      async run(args) {
        const configs = await listScraperDirectory({
          domain: args.domain ? String(args.domain) : void 0,
          limit: Number(args.limit) || 20
        });
        return JSON.stringify({
          count: configs.length,
          configs: configs.map((c2) => ({
            domain: c2.domain,
            path: c2.path_pattern,
            category: c2.category,
            confidence: c2.confidence_score,
            fields: c2.fields_count,
            description: (c2.display_name ?? c2.description ?? "").slice(0, 140)
          }))
        });
      }
    },
    score_leads: {
      name: "score_leads",
      description: "Recompute lead scores + role classification (department, seniority, decision maker, grade A-D) for stored leads, using the configured ICP rules when set. Returns the highest-scoring leads so the model can prioritize outreach.",
      parameters: {
        type: "object",
        properties: {
          min_score: { type: "integer", description: "Only return leads with score >= N (default 0)" },
          limit: { type: "integer", description: "Max rows (default 10)" }
        }
      },
      async run(args) {
        const rows = await listLeads(db, { limit: 2500 });
        let updated = 0;
        for (const r of rows) {
          if (!r.email) continue;
          let interests = [];
          try {
            const parsed = JSON.parse(r.interests ?? "[]");
            interests = Array.isArray(parsed) ? parsed.map((i) => typeof i === "string" ? i : i?.topic ?? "") : [];
          } catch {
          }
          const cls = classifyTitle(r.title);
          const icp = icpMatch(r.category, interests, cfg.icpCategories, cfg.icpInterests);
          const { score, grade } = scoreLead({
            emailValid: r.email_valid,
            emailScore: r.email_score,
            emailSource: r.email_source,
            companyTier: r.tier,
            companyConfidence: r.confidence,
            icpMatch: icp,
            title: r.title
          });
          await updateLeadScore(db, r.email, {
            department: cls.department,
            seniority: cls.seniority,
            decisionMaker: cls.decisionMaker,
            leadScore: score,
            leadTier: grade,
            icpMatch: icp
          });
          updated++;
        }
        const top = await listLeads(db, {
          minScore: Number(args.min_score) || 0,
          limit: Number(args.limit) || 10
        });
        return JSON.stringify({
          scored: updated,
          top: top.map((l) => ({
            email: l.email,
            person: l.person_name,
            title: l.title,
            company: l.company,
            department: l.department,
            seniority: l.seniority,
            decision_maker: l.decision_maker,
            score: l.lead_score,
            grade: l.lead_tier,
            icp_match: l.icp_match,
            status: l.status
          }))
        });
      }
    },
    find_relationships: {
      name: "find_relationships",
      description: "Discover company-to-company relationships for a domain (Partner, Client, Supplier, Competitor, Subsidiary, Parent, Investor) using AI over the company's pages, and persist them. Use this to expand a target account into its partner/client network (then query_leads or list related contacts).",
      parameters: {
        type: "object",
        properties: {
          domain: { type: "string", description: "Company domain, e.g. acme.com" }
        },
        required: ["domain"]
      },
      async run(args) {
        const domain = String(args.domain ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (!domain) return JSON.stringify({ error: "domain required" });
        let pages = [];
        try {
          pages = [await scrapePage(cfg, toRoot(domain), { mode: "smart" })];
        } catch {
        }
        const cat = await categorizeDomain(cfg, domain, pages);
        const relations = (cat.relations ?? []).slice(0, 25);
        for (const rel of relations) {
          try {
            await upsertRelation(db, domain, rel, pages[0]?.url);
          } catch {
          }
        }
        return JSON.stringify({ domain, category: cat.category, tier: cat.tier, relations });
      }
    },
    store_leads: {
      name: "store_leads",
      description: "Store leads in the Turso database (deduped by email). Accepts an array of leads with email (required for email leads), person_name, title, phone, linkedin, company, domain, category, interests (array of strings or {topic, confidence} objects), source_url. Emails are validated and classified (corporate/business/student/personal) automatically.",
      parameters: {
        type: "object",
        properties: {
          leads: {
            type: "array",
            description: "Leads to store",
            items: {
              type: "object",
              properties: {
                email: { type: "string" },
                person_name: { type: "string" },
                title: { type: "string" },
                phone: { type: "string" },
                linkedin: { type: "string" },
                company: { type: "string" },
                domain: { type: "string" },
                category: { type: "string" },
                interests: {
                  type: "array",
                  items: {
                    anyOf: [
                      { type: "string" },
                      { type: "object", properties: { topic: { type: "string" }, confidence: { type: "number" } } }
                    ]
                  }
                },
                source_url: { type: "string" }
              },
              required: ["email"]
            }
          }
        },
        required: ["leads"]
      },
      async run(args) {
        const raw = Array.isArray(args.leads) ? args.leads : [];
        if (raw.length === 0) return JSON.stringify({ error: "no leads provided" });
        let stored = 0, updated = 0, rejected = 0;
        const rejectedReasons = [];
        for (const l of raw) {
          const email = String(l.email ?? "").toLowerCase().trim();
          if (!email || !isValidEmail(email)) {
            rejected++;
            rejectedReasons.push((l.email ?? "?") + " (invalid or placeholder)");
            continue;
          }
          const interests = Array.isArray(l.interests) ? l.interests.map(
            (i) => typeof i === "string" ? { topic: i, confidence: 0.6 } : { topic: String(i?.topic ?? ""), confidence: Number(i?.confidence) || 0.6 }
          ).filter((i) => i.topic.length > 0) : [];
          const interestTopics = interests.map((i) => i.topic);
          const cls = classifyTitle(l.title ? String(l.title) : null);
          const icp = icpMatch(l.category ? String(l.category) : null, interestTopics, cfg.icpCategories, cfg.icpInterests);
          const { score, grade } = scoreLead({
            emailValid: null,
            emailScore: null,
            emailSource: "agent",
            companyTier: null,
            companyConfidence: null,
            icpMatch: icp,
            title: l.title ? String(l.title) : null
          });
          const lead = {
            email,
            emailType: classifyEmailType(email),
            emailSource: "agent",
            personName: l.person_name ? String(l.person_name) : null,
            title: l.title ? String(l.title) : null,
            phone: l.phone ? String(l.phone) : null,
            linkedin: l.linkedin ? String(l.linkedin) : null,
            company: l.company ? String(l.company) : null,
            domain: l.domain ? String(l.domain) : domainOf(email.split("@")[1] ? "https://" + email.split("@")[1] : email),
            category: l.category ? String(l.category) : null,
            subcategory: null,
            tier: null,
            confidence: null,
            interests,
            department: cls.department,
            seniority: cls.seniority,
            decisionMaker: cls.decisionMaker,
            leadScore: score,
            leadTier: grade,
            icpMatch: icp,
            sourceUrl: l.source_url ? String(l.source_url) : null,
            source: "agent",
            raw: { agent: true, input: l }
          };
          if (opts.dryRun) {
            stored++;
            continue;
          }
          const outcome = await upsertLead(db, lead);
          if (outcome === "new") stored++;
          else updated++;
        }
        return JSON.stringify({ stored, updated, rejected, rejectedReasons: rejectedReasons.slice(0, 10) });
      }
    },
    query_leads: {
      name: "query_leads",
      description: "Query stored leads from the database. Filters: status (new/verified/invalid), category, email_type (corporate/business/student/personal), email_source (page/guessed/github), interest (topic substring). Returns rows.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          category: { type: "string" },
          email_type: { type: "string" },
          email_source: { type: "string" },
          interest: { type: "string" },
          limit: { type: "integer", description: "Max rows (default 20)" }
        }
      },
      async run(args) {
        const rows = await listLeads(db, {
          status: args.status ? String(args.status) : void 0,
          category: args.category ? String(args.category) : void 0,
          emailType: args.email_type ? String(args.email_type) : void 0,
          emailSource: args.email_source ? String(args.email_source) : void 0,
          interest: args.interest ? String(args.interest) : void 0,
          limit: Number(args.limit) || 20
        });
        return JSON.stringify({ count: rows.length, rows });
      }
    }
  };
  return tools;
}

// spider-leads/src/agent.ts
var SYSTEM_PROMPT = "You are an autonomous B2B lead-generation agent. You have tools for web search, site crawling, employee extraction (an 'employee scraper' \u2014 names/titles/departments via AI Studio prompt\u2192JSON when enabled), contact extraction, employee discovery, email inference (pattern-based guessing + Plunk verification), company categorization (industry + interests + company relationships), lead scoring (department/seniority/grade), email verification (Plunk), storing leads (Turso), querying stored leads, scraper-catalog browsing, and structured fetching of marketplace/listing pages (Zillow, Indeed, Yelp).\nRules:\n- Use the tools to accomplish the user's objective. NEVER invent data: only report what tools return.\n- Typical flow: search_web to find targets \u2192 extract_contacts per target \u2192 find_employees to get names without emails \u2192 guess_emails to infer + verify their addresses \u2192 categorize_company \u2192 find_relationships to map partners/clients \u2192 score_leads \u2192 store_leads \u2192 verify_email for new emails (when verification is wanted).\n- fetch_structured is for curated configs / marketplace pages; extract_contacts is for company sites.\n- Never store fabricated emails. Email addresses must come from extraction results or from guess_emails (which verifies every inferred address with Plunk before storing).\n- Keep tool arguments minimal and correct; parse tool results before deciding next steps.\n- When the objective is complete (or blocked), reply with a concise final summary: targets examined, leads found/stored/updated, scores/grades, verified/invalid counts, categories + top interests + relationships, and any failures.";
function countToolCalls(calls) {
  return [...calls.entries()].map(([tool, count]) => ({ tool, count }));
}
async function runAgent(db, cfg, objective, opts = {}) {
  const maxTurns = opts.maxTurns ?? 20;
  const tools = buildTools(cfg, db, { dryRun: opts.dryRun, limit: opts.limit });
  for (const pt of opts.extraTools ?? []) {
    if (!pt || typeof pt.name !== "string" || !pt.name) continue;
    if (tools[pt.name]) {
      log.warn("Plugin tool '" + pt.name + "' collides with a built-in tool \u2014 skipping");
      continue;
    }
    tools[pt.name] = {
      name: pt.name,
      description: pt.description,
      parameters: pt.parameters,
      run: (args, ctx) => Promise.resolve(pt.run(args, ctx))
    };
  }
  const defs = toolDefs(tools);
  const calls = /* @__PURE__ */ new Map();
  const errors = [];
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: objective }
  ];
  let final = "";
  let rounds = 0;
  let stored = 0, updated = 0, verified = 0, invalid = 0;
  for (let round = 0; round < maxTurns; round++) {
    rounds = round + 1;
    log.step("Agent turn " + rounds + "/" + maxTurns);
    let resp;
    try {
      resp = await chatWithTools(cfg, messages, defs);
    } catch (err) {
      const msg = err.message;
      errors.push(msg);
      if (/tool|function/i.test(msg) && /400|invalid|not supported|unknown/i.test(msg)) {
        final = "The AI provider rejected function calling: " + msg + " \u2014 use a function-calling-capable model (OpenAI, DeepSeek deepseek-chat / deepseek-v4-flash, Groq) or the hunt/search commands instead.";
      } else {
        final = "Agent stopped after an AI error: " + msg;
      }
      break;
    }
    if (resp.toolCalls.length === 0) {
      final = resp.content || "(no summary returned)";
      break;
    }
    for (const call of resp.toolCalls) {
      const result = await executeToolCall(tools, call, calls, errors, cfg, db);
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
          }
        ]
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
      if (call.name === "verify_email") {
        try {
          const parsed = JSON.parse(result);
          if (parsed.valid === true) verified++;
          else if (parsed.valid === false) invalid++;
        } catch {
        }
      }
      if (call.name === "store_leads") {
        try {
          const parsed = JSON.parse(result);
          stored += Number(parsed.stored ?? 0);
          updated += Number(parsed.updated ?? 0);
        } catch {
        }
      }
    }
  }
  if (!final) final = "(turn budget reached after " + rounds + " rounds)";
  log.info("Agent finished: " + final.slice(0, 200));
  return {
    objective,
    final,
    turns: rounds,
    toolCalls: countToolCalls(calls),
    stored,
    updated,
    verified,
    invalid,
    errors
  };
}
async function executeToolCall(tools, call, calls, errors, cfg, db) {
  calls.set(call.name, (calls.get(call.name) ?? 0) + 1);
  const tool = tools[call.name];
  if (!tool) {
    const msg = "unknown tool: " + call.name;
    errors.push(msg);
    return JSON.stringify({ error: msg });
  }
  log.info("  \u2192 " + call.name + " " + JSON.stringify(call.args ?? {}).slice(0, 160));
  try {
    return await tool.run(call.args ?? {}, { cfg, db });
  } catch (err) {
    const msg = call.name + ": " + err.message;
    errors.push(msg);
    log.warn("Tool error: " + msg);
    return JSON.stringify({ error: msg });
  }
}

// spider-leads/src/json-plugin.ts
function isAllowedExternalUrl(url) {
  const u = url.trim();
  if (!/^https:\/\//i.test(u)) {
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(u);
  }
  return true;
}
function pluginDataUrls(manifest) {
  const urls = [];
  if (manifest.hooks?.onLead?.url) urls.push(manifest.hooks.onLead.url);
  if (manifest.hooks?.afterRun?.url) urls.push(manifest.hooks.afterRun.url);
  for (const t of manifest.tools ?? []) {
    if (t.action?.type === "http" && typeof t.action.url === "string") urls.push(t.action.url);
  }
  return [...new Set(urls)];
}
function validateJsonPlugin(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Plugin must be a JSON string" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON: " + (text.length > 80 ? text.slice(0, 80) + "\u2026" : text) };
  }
  const m = parsed;
  if (typeof m !== "object" || m === null) return { ok: false, error: "Plugin must be a JSON object" };
  if (!m.id || typeof m.id !== "string") return { ok: false, error: "Missing 'id' (string)" };
  if (!/^[a-z0-9][a-z0-9-_.]{0,63}$/.test(m.id)) return { ok: false, error: "'id' must be lowercase alphanumeric with dashes (e.g. my-plugin)" };
  if (!m.name || typeof m.name !== "string") return { ok: false, error: "Missing 'name' (string)" };
  if (!m.version || typeof m.version !== "string") return { ok: false, error: "Missing 'version' (string)" };
  if (m.tools !== void 0 && !Array.isArray(m.tools)) return { ok: false, error: "'tools' must be an array" };
  if (m.exporters !== void 0 && !Array.isArray(m.exporters)) return { ok: false, error: "'exporters' must be an array" };
  const bad = pluginDataUrls(m).filter((u) => !isAllowedExternalUrl(u));
  if (bad.length > 0) {
    return { ok: false, error: "plugin sends data to non-HTTPS URL(s): " + bad.slice(0, 3).join(", ") + " (only https:// or localhost are allowed)" };
  }
  return { ok: true, manifest: m };
}
function substitute(template, vars) {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key) => vars[key] ?? "");
}
function getPath(obj, path) {
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === void 0 || typeof cur !== "object") return void 0;
    cur = cur[part];
  }
  return cur;
}
function hnHtmlToText(html) {
  let applyUrl = null;
  const linkMatch = String(html).match(/href="([^"]+)"/i);
  if (linkMatch) {
    const decoded = linkMatch[1].replace(/&#x27;|&#39;/gi, "'").replace(/&#x2F;/gi, "/").replace(/&amp;/gi, "&");
    if (/^https?:\/\//i.test(decoded) && !/news\.ycombinator\.com|hn\.algolia\.com/.test(decoded)) {
      applyUrl = decoded;
    }
  }
  let text = String(html).replace(/<p\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/gi, "'").replace(/&#x2F;/gi, "/").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
  return { text, applyUrl };
}
function parseHnComment(rawHtml) {
  const { text, applyUrl } = hnHtmlToText(rawHtml);
  const parts = text.split(" | ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { company: "", title: null, location: null, remote: false, meta: [], description: "", applyUrl };
  }
  const company = parts[0];
  const description = parts.length > 1 ? parts.slice(-1)[0] : "";
  const meta = parts.length > 2 ? parts.slice(1, -1) : parts.length === 2 ? parts.slice(1, -1) : [];
  const all = (meta.join(" ") + " " + description).toLowerCase();
  const remote = /\b(remote|fully remote|distributed)\b/.test(all);
  let title = null;
  let location = null;
  if (meta.length >= 1) {
    const first = meta[0];
    if (first.length <= 60 && !/^(https?:|\/)/.test(first)) title = first;
  }
  if (meta.length >= 2) location = meta[1];
  if (meta.length === 1 && !title) location = meta[0];
  return { company, title, location, remote, meta, description, applyUrl };
}
async function builtinFetchHnJobs(args) {
  const limit = Math.min(Number(args.limit) || 25, 100);
  const minCreated = Math.floor(Date.now() / 1e3) - 45 * 24 * 3600;
  try {
    const search = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=story,author_whoishiring&query=hiring&hitsPerPage=1&numericFilters=created_at_i%3E" + minCreated
    );
    if (!search.ok) return JSON.stringify({ error: "HN search: HTTP " + search.status });
    const searchData = await search.json();
    const story = searchData?.hits?.[0];
    if (!story?.objectID) return JSON.stringify({ error: "no recent 'Who is hiring?' thread found" });
    const items = await fetch("https://hn.algolia.com/api/v1/items/" + story.objectID);
    if (!items.ok) return JSON.stringify({ error: "HN items: HTTP " + items.status });
    const itemData = await items.json();
    const children = Array.isArray(itemData.children) ? itemData.children : [];
    const jobs = children.slice(0, limit).map((c2) => {
      const parsed = parseHnComment(String(c2.text ?? ""));
      return {
        company: parsed.company,
        title: parsed.title,
        location: parsed.location,
        remote: parsed.remote,
        meta: parsed.meta,
        description: parsed.description,
        applyUrl: parsed.applyUrl,
        hnUrl: "https://news.ycombinator.com/item?id=" + c2.objectID,
        author: c2.author ?? ""
      };
    }).filter((j) => j.company.length > 0);
    return JSON.stringify({
      thread: { id: story.objectID, title: story.title ?? "", url: "https://news.ycombinator.com/item?id=" + story.objectID },
      totalPosts: children.length,
      count: jobs.length,
      jobs
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
async function builtinFetchUrl(cfg, args) {
  const url = String(args.url ?? "");
  if (!url) return JSON.stringify({ error: "url is required" });
  if (!cfg?.spiderApiKey) return JSON.stringify({ error: "Spider API key not configured \u2014 fetch_url needs it" });
  try {
    const page = await scrapePage(cfg, url, { mode: "smart" });
    return JSON.stringify({ url: page.url, status: page.status, content: page.markdown.slice(0, 4e3) });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
async function builtinSearchWeb(cfg, args) {
  const query = String(args.query ?? "");
  if (!query) return JSON.stringify({ error: "query is required" });
  if (!cfg?.spiderApiKey) return JSON.stringify({ error: "Spider API key not configured \u2014 search_web needs it" });
  try {
    const pages = await searchPages(cfg, query, { limit: Math.min(Number(args.limit) || 5, 20) });
    return JSON.stringify({
      count: pages.length,
      results: pages.map((p) => ({ url: p.url, status: p.status, preview: p.markdown.replace(/\s+/g, " ").trim().slice(0, 300) }))
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
async function builtinFetchJobs(args) {
  const company = String(args.company ?? "");
  const platform = String(args.platform ?? "");
  const limit = Math.min(Number(args.limit) || 10, 50);
  if (!company) return JSON.stringify({ error: "company is required" });
  const out = [];
  try {
    if (platform === "greenhouse") {
      const res = await fetch("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(company) + "/jobs");
      if (!res.ok) return JSON.stringify({ error: "greenhouse: HTTP " + res.status });
      const data = await res.json();
      for (const j of (Array.isArray(data.jobs) ? data.jobs : []).slice(0, limit)) {
        out.push({ title: j.title, location: j.location?.name ?? null, url: j.absolute_url, updated: j.updated_at });
      }
    } else if (platform === "lever") {
      const res = await fetch("https://api.lever.co/v0/postings/" + encodeURIComponent(company) + "?mode=json");
      if (!res.ok) return JSON.stringify({ error: "lever: HTTP " + res.status });
      const data = await res.json();
      for (const p of (Array.isArray(data) ? data : []).slice(0, limit)) {
        out.push({ title: p.text, location: p.categories?.location ?? null, url: p.hostedUrl, updated: p.createdAt });
      }
    } else if (platform === "ashby") {
      const res = await fetch("https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(company), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      if (!res.ok) return JSON.stringify({ error: "ashby: HTTP " + res.status });
      const data = await res.json();
      for (const j of (Array.isArray(data.jobs) ? data.jobs : []).slice(0, limit)) {
        out.push({ title: j.title, location: j.location ?? null, url: j.jobUrl, updated: j.publishedAt });
      }
    } else {
      return JSON.stringify({ error: "platform must be greenhouse | lever | ashby" });
    }
    return JSON.stringify({ count: out.length, jobs: out });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}
function makeHttpTool(tool) {
  const action = tool.action;
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async run(args) {
      const vars = {};
      for (const [k, v] of Object.entries(args ?? {})) vars[k] = String(v ?? "");
      const url = substitute(action.url, vars);
      const method = (action.method ?? "GET").toUpperCase();
      const headers = { ...action.headers ?? {} };
      if (action.body !== void 0 && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      const body = action.body !== void 0 ? JSON.stringify(substituteJson(action.body, vars)) : void 0;
      try {
        const resp = await fetch(url, { method, headers, body });
        const text = await resp.text();
        if (!resp.ok) return JSON.stringify({ error: "HTTP " + resp.status + ": " + text.slice(0, 200) });
        let parsed = text;
        try {
          parsed = JSON.parse(text);
        } catch {
        }
        const extracted = action.extract ? getPath(parsed, action.extract) : parsed;
        return typeof extracted === "string" ? extracted : JSON.stringify(extracted ?? null);
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }
  };
}
function substituteJson(value, vars) {
  if (typeof value === "string") return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteJson(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteJson(v, vars);
    return out;
  }
  return value;
}
function makeTool(cfg, tool) {
  const action = tool.action;
  if (action.type === "http") return makeHttpTool(tool);
  const builtin = action.id;
  const params = { ...action.params ?? {} };
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    async run(args) {
      const merged = { ...params, ...args ?? {} };
      if (builtin === "fetch_url") return builtinFetchUrl(cfg, merged);
      if (builtin === "search_web") return builtinSearchWeb(cfg, merged);
      if (builtin === "fetch_jobs") return builtinFetchJobs(merged);
      if (builtin === "fetch_hn_jobs") return builtinFetchHnJobs(merged);
      return JSON.stringify({ error: "unknown builtin action: " + builtin });
    }
  };
}
function makeWebhookHook(def2) {
  return async (ctx) => {
    const lead = ctx.lead ?? {};
    const vars = {
      email: String(lead.email ?? ""),
      company: String(lead.company ?? ""),
      title: String(lead.title ?? ""),
      outcome: String(ctx.outcome ?? ""),
      source: String(lead.source ?? ""),
      domain: String(lead.domain ?? "")
    };
    const body = def2.bodyTemplate ? substitute(def2.bodyTemplate, vars) : JSON.stringify({ event: "lead", outcome: ctx.outcome ?? "", lead });
    try {
      await fetch(def2.url, {
        method: def2.method ?? "POST",
        headers: { "Content-Type": "application/json", ...def2.headers ?? {} },
        body
      });
    } catch (err) {
      log.warn("plugin webhook to " + def2.url + " failed: " + err.message);
    }
  };
}
function makeExporter(def2) {
  return {
    id: def2.id,
    label: def2.label ?? def2.id,
    export(rows) {
      if (def2.format === "jsonl") {
        return { content: rows.map((r) => JSON.stringify(r)).join("\n") + "\n", filename: "leads.jsonl", mime: "application/x-ndjson" };
      }
      if (def2.format === "json") {
        return { content: JSON.stringify(rows, null, 2) + "\n", filename: "leads.json", mime: "application/json" };
      }
      const cols = def2.columns ?? (rows[0] ? Object.keys(rows[0]) : []);
      const esc = (v) => {
        const str = String(v ?? "");
        return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      const lines = [cols.map(esc).join(","), ...rows.map((r) => cols.map((c2) => esc(r[c2])).join(","))];
      return { content: lines.join("\n") + "\n", filename: "leads.csv", mime: "text/csv" };
    }
  };
}
function compileJsonPlugin(manifest, cfg) {
  const hooks = {};
  if (manifest.hooks?.onLead) hooks.onLead = makeWebhookHook(manifest.hooks.onLead);
  if (manifest.hooks?.afterRun) hooks.afterRun = makeWebhookHook(manifest.hooks.afterRun);
  registerRuleSets(manifest.id, manifest.rules);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    dir: "json",
    entry: "plugin.json",
    tools: (manifest.tools ?? []).map((t) => makeTool(cfg, t)),
    hooks,
    exporters: (manifest.exporters ?? []).map(makeExporter),
    filters: manifest.filters
  };
}

// spider-leads/src/career.ts
function asStr(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}
function asNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : fallback;
}
async function buildProfile(cfg, resumeText, extraContext = "") {
  const fallback = {
    fullName: "",
    title: "",
    summary: "",
    skills: [],
    experience: [],
    education: [],
    projects: []
  };
  if (!hasAiKey(cfg)) {
    log.warn("No AI key configured \u2014 profile will only contain the raw resume text");
    return { ...fallback, raw: resumeText.slice(0, 2e4) };
  }
  const system = 'You extract structured professional profiles from resumes. Return ONLY JSON matching this exact schema: {"fullName": string, "title": string, "summary": string, "contact": {"email": string, "phone": string, "linkedin": string, "location": string, "website": string}, "skills": string[], "experience": [{"role": string, "company": string, "period": string, "highlights": string[]}], "education": [{"degree": string, "school": string, "period": string}], "projects": [{"name": string, "description": string, "link": string}], "certifications": string[], "languages": string[]}. Keep every fact exactly as written in the resume. NEVER invent skills, employers, or dates. Use null/empty arrays for anything not present.';
  const user = "RESUME:\n" + resumeText.slice(0, 3e4) + (extraContext ? "\n\nEXTRA CONTEXT:\n" + extraContext.slice(0, 3e3) : "");
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 3e3));
    return {
      fullName: asStr(json.fullName) || void 0,
      title: asStr(json.title) || void 0,
      summary: asStr(json.summary) || void 0,
      contact: json.contact && typeof json.contact === "object" ? {
        email: asStr(json.contact.email) || void 0,
        phone: asStr(json.contact.phone) || void 0,
        linkedin: asStr(json.contact.linkedin) || void 0,
        location: asStr(json.contact.location) || void 0,
        website: asStr(json.contact.website) || void 0
      } : void 0,
      skills: Array.isArray(json.skills) ? json.skills.map((x) => asStr(x)).filter(Boolean) : [],
      experience: Array.isArray(json.experience) ? json.experience.map((e) => ({
        role: asStr(e?.role),
        company: asStr(e?.company),
        period: asStr(e?.period) || void 0,
        highlights: Array.isArray(e?.highlights) ? e.highlights.map((h) => asStr(h)).filter(Boolean) : []
      })).filter((e) => e.role || e.company) : [],
      education: Array.isArray(json.education) ? json.education.map((e) => ({ degree: asStr(e?.degree), school: asStr(e?.school), period: asStr(e?.period) || void 0 })).filter((e) => e.degree || e.school) : [],
      projects: Array.isArray(json.projects) ? json.projects.map((p) => ({ name: asStr(p?.name), description: asStr(p?.description) || void 0, link: asStr(p?.link) || void 0 })).filter((p) => p.name) : [],
      certifications: Array.isArray(json.certifications) ? json.certifications.map((x) => asStr(x)).filter(Boolean) : [],
      languages: Array.isArray(json.languages) ? json.languages.map((x) => asStr(x)).filter(Boolean) : []
    };
  } catch (err) {
    log.warn("buildProfile AI failed: " + err.message);
    return { ...fallback, raw: resumeText.slice(0, 2e4) };
  }
}
function aiError(op, err) {
  return new Error(op + " failed: " + err.message + " \u2014 check the AI key/model in Settings (an OpenAI-compatible endpoint like DeepSeek/OpenAI/Ollama is required)");
}
async function tailorResume(cfg, profile, job) {
  const system = `You are a professional resume writer. Tailor a candidate's REAL profile to a specific job posting. Return ONLY JSON: {"resumeMarkdown": string (complete one-page resume in Markdown, reordered and reworded to emphasize the most relevant experience for THIS job; EVERY fact must come from the profile \u2014 never invent employers, titles, dates, or skills), "coverLetter": string (3-4 short paragraphs, specific to the company and role, referencing real achievements), "talkingPoints": string[] (6-8 one-line interview points connecting profile to job), "keywords": string[] (12-15 terms from the job description to weave in naturally)}.`;
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 4e3));
    return {
      resumeMarkdown: asStr(json.resumeMarkdown, "No resume generated."),
      coverLetter: asStr(json.coverLetter, ""),
      talkingPoints: Array.isArray(json.talkingPoints) ? json.talkingPoints.map((x) => asStr(x)).filter(Boolean) : [],
      keywords: Array.isArray(json.keywords) ? json.keywords.map((x) => asStr(x)).filter(Boolean) : []
    };
  } catch (err) {
    throw aiError("tailorResume", err);
  }
}
async function draftOutreach(cfg, profile, job, channel) {
  const system = channel === "email" ? `Write a professional cold application email from a candidate applying to a job. Return ONLY JSON: {"subject": string, "body": string}. Body: 3-4 short paragraphs \u2014 who you are (from the profile), why this company/role (from the job), 2-3 specific real achievements that fit, and a clear call to action. Sign off with the candidate's real name and contact details from the profile. Never invent facts.` : 'Write a short, professional LinkedIn message (max 250 words, no subject) from a candidate reaching out about a job. Return ONLY JSON: {"body": string}. Reference 1-2 REAL achievements from the profile and why this role interests them. Never invent facts.';
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 2e3));
    return {
      channel,
      subject: channel === "email" ? asStr(json.subject) || void 0 : void 0,
      body: asStr(json.body, "")
    };
  } catch (err) {
    throw aiError("draftOutreach", err);
  }
}
async function scoreFit(cfg, profile, job) {
  const system = 'Score how well a candidate profile fits a job posting. Return ONLY JSON: {"score": number (0-100), "strengths": string[], "gaps": string[], "questions": string[]}. Be honest and specific.';
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 1500));
    return {
      score: asNum(json.score, 50),
      strengths: Array.isArray(json.strengths) ? json.strengths.map((x) => asStr(x)).filter(Boolean) : [],
      gaps: Array.isArray(json.gaps) ? json.gaps.map((x) => asStr(x)).filter(Boolean) : [],
      questions: Array.isArray(json.questions) ? json.questions.map((x) => asStr(x)).filter(Boolean) : []
    };
  } catch (err) {
    throw aiError("scoreFit", err);
  }
}
export {
  CATEGORIES,
  EMPLOYEE_AI_PROMPT,
  PATTERN_LABELS,
  aiStudioExtract,
  buildProfile,
  buildTools,
  candidatesForDomain,
  candidatesForPerson,
  categorizeDomain,
  chatWithTools,
  classifyEmailType,
  classifyTitle,
  compileJsonPlugin,
  crawlPages,
  dbStats,
  defaultRunOptions,
  domainOf,
  draftOutreach,
  emailNameHint,
  enrichDomain,
  ensureDb,
  extractContactsFromSite,
  extractContactsSpider,
  extractEmails,
  extractGithubOrgs,
  extractGithubUsers,
  extractNamedPeople,
  fetchPathFromUrl,
  fetchStructured,
  findEmployees,
  findGithubPeople,
  getSiteLinks,
  gradeLabel,
  guessLabel,
  hunt,
  huntSearch,
  icpMatch,
  initSchema,
  isValidEmail,
  knownEmailsForDomain,
  leadsRelatedTo,
  learnPatterns,
  listLeads,
  listPeople,
  listScraperDirectory,
  markCandidate,
  openDb,
  parseContacts,
  patternOf,
  peopleForDomain,
  pluginDataUrls,
  rankPatterns,
  recordVerification,
  registerRuleSets,
  relatedDomainsFor,
  relationsForDomain,
  runAgent,
  scoreFit,
  scoreLead,
  scrapePage,
  searchPages,
  splitName,
  storePersons,
  tailorResume,
  toolDefs,
  unverifiedEmails,
  updateLeadScore,
  upsertCandidate,
  upsertLead,
  upsertPerson,
  upsertRelation,
  validateJsonPlugin,
  verifyEmail,
  verifyStored
};
//# sourceMappingURL=leads-core.js.map
