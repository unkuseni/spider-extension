// Mock API server for local end-to-end testing — mimics Spider Cloud, Plunk, and an OpenAI-compatible chat API.
// Usage: node scripts/mock-api.ts   (listens on PORT, default 8787)
// Then run the CLI with:
//   SPIDER_API_BASE=http://127.0.0.1:8787 PLUNK_API_BASE=http://127.0.0.1:8787
//   OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=test TURSO_URL=file:demo.db ...

import http from "node:http";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 8787);

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function pageContent(url: string): string {
  const host = hostnameOf(url);
  const path = new URL(url).pathname.toLowerCase();
  if (host.endsWith(".edu") || host.includes("university") || host.includes("college")) {
    return `# ${host}

Stanford University — Department of Computer Science.
Student researcher: m.lee@${host}
Professor: j.smith@${host}
Admissions: admissions@${host}
`;
  }
  if (path.includes("team")) {
    return `# Team at ${host}

## Leadership
- Sarah Chen — VP Engineering — sarah.chen@${host}
- James Ruiz — Head of Sales — james.ruiz@${host} — +1 (415) 555-0192
- Priya Kapoor — CTO — priya.kapoor@${host} — https://linkedin.com/in/priya-kapoor

## Engineers
- Mike Williams — m.williams@${host}
`;
  }
  if (path.includes("contact")) {
    return `# Contact ${host}

General: hello@${host} · +1 (800) 555-0100
Support: support@${host}
Address: 100 Market St, San Francisco, CA
`;
  }
  if (path.includes("about") || path.includes("careers")) {
    return `# About ${host}

${host} builds cloud infrastructure software for developers.
Hiring: careers@${host}
Founder: Alex Nguyen — alex@${host}
Community: alex.nguyen.dev@gmail.com
`;
  }
  if (path.includes("blog") || path.includes("product") || path === "/") {
    return `# ${host}

Welcome to ${host}. We are a B2B SaaS company providing API tooling,
automation, and developer platforms. Learn more about our platform and pricing.
Contact our sales team to book a demo.
`;
  }
  return `# ${host} — ${path}

Some generic page content about products and services.
`;
}

function linksFor(url: string): { url: string }[] {
  const host = hostnameOf(url);
  return [
    { url: `https://${host}/` },
    { url: `https://${host}/about` },
    { url: `https://${host}/team` },
    { url: `https://${host}/contact` },
    { url: `https://${host}/careers` },
    { url: `https://${host}/blog` },
    { url: `https://${host}/products` },
  ];
}

export function createMockHandler() {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
  await sleep(50); // simulate network latency
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  try {
    if (method === "POST" && url === "/links") {
      const body = await readBody(req);
      return json(res, 200, linksFor(body.url ?? ""));
    }
    if (method === "POST" && url === "/crawl") {
      const body = await readBody(req);
      const links = linksFor(body.url ?? "");
      return json(res, 200, links.slice(0, body.limit ?? 10).map((l) => ({
        url: l.url,
        status: 200,
        content: pageContent(l.url),
        error: null,
        costs: { total_cost: 0.00002, total_cost_formatted: "0.00002" },
      })));
    }
    if (method === "POST" && url === "/scrape") {
      const body = await readBody(req);
      const u = body.url ?? "https://example.com/";
      return json(res, 200, [{
        url: u,
        status: 200,
        content: pageContent(u),
        error: null,
        costs: { total_cost: 0.00001, total_cost_formatted: "0.00001" },
      }]);
    }
    if (method === "POST" && url === "/search") {
      const body = await readBody(req);
      const results = ["acme.com", "globex.io", "initech.dev"].map((host) => ({
        url: `https://${host}/about`,
        status: 200,
        content: pageContent(`https://${host}/about`),
        error: null,
      }));
      return json(res, 200, { content: results.slice(0, body.limit ?? 10) });
    }
    if (method === "POST" && url === "/v1/pipeline/extract-contacts") {
      const body = await readBody(req);
      const host = hostnameOf(body.url ?? "example.com");
      return json(res, 200, [
        { email: `sarah.chen@${host}`, person_name: "Sarah Chen", title: "VP Engineering", phone: "+1 (415) 555-0192" },
        { email: `james.ruiz@${host}`, person_name: "James Ruiz", title: "Head of Sales" },
        { email: `priya.kapoor@${host}`, person_name: "Priya Kapoor", title: "CTO", linkedin: `https://linkedin.com/in/priya-kapoor` },
        { email: `hello@${host}`, title: "General" },
      ]);
    }
    if (method === "POST" && url === "/v1/verify") {
      const body = await readBody(req);
      const email = body.email ?? "";
      const domain = email.split("@")[1] ?? "";
      const data = {
        email,
        valid: true,
        isDisposable: false,
        isAlias: false,
        isTypo: false,
        isPlusAddressed: false,
        isPersonalEmail: false,
        domainExists: true,
        hasWebsite: true,
        hasMxRecords: true,
        reasons: ["Email appears to be valid"],
      };
      if (domain === "mailinator.com" || domain === "tempmail.com") {
        return json(res, 200, { success: true, data: { ...data, isDisposable: true, reasons: ["Disposable email detected"] } });
      }
      if (domain === "gmail.com") {
        return json(res, 200, { success: true, data: { ...data, isPersonalEmail: true, reasons: ["Email appears to be valid"] } });
      }
      if (domain === "nonexistent.fake") {
        return json(res, 200, { success: true, data: { ...data, valid: false, hasMxRecords: false, reasons: ["Domain does not accept email"] } });
      }
      return json(res, 200, { success: true, data });
    }
        if (method === "POST" && url === "/v1/chat/completions") {
      const body = await readBody(req);
      const all = (body.messages ?? []).map((m: any) => m.content ?? "").join("\n");

      // --- Agent mode: request includes tools → respond with tool_calls ---
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        const toolNames = body.tools.map((t: any) => t.function?.name).filter(Boolean);
        const priorCalls = (body.messages ?? []).filter((msg: any) => Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0).length;
        const pick = (name: string, args: any) => ({
          id: "call_" + (priorCalls + 1),
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        });
        let toolCalls: any[] = [];
        if (priorCalls === 0 && toolNames.includes("browser_action")) {
          toolCalls = [pick("browser_action", { action: "navigate", target: "https://example.com/jobs/123", reason: "open the job posting" })];
        } else if (priorCalls === 1 && toolNames.includes("browser_action")) {
          toolCalls = [pick("browser_action", { action: "fill_form", fields: { fullName: "Sarah Chen", email: "sarah.chen@acme.com" }, reason: "fill the application form" })];
        } else if (priorCalls === 2 && toolNames.includes("browser_action")) {
          return json(res, 200, {
            choices: [{ message: { role: "assistant", content: "Done: opened the posting and filled the form from your profile. Review the form and click Submit yourself." } }],
          });
        } else if (priorCalls === 0 && toolNames.includes("fetch_jobs")) {
          toolCalls = [pick("fetch_jobs", { company: "airbnb", platform: "greenhouse", limit: 2 })];
        } else if (priorCalls === 0 && toolNames.includes("search_web")) {
          toolCalls = [pick("search_web", { query: "b2b saas companies interested in AI", limit: 3 })];
        } else if (priorCalls === 1 && toolNames.includes("extract_contacts")) {
          toolCalls = [pick("extract_contacts", { url: "https://acme.com", limit: 5 })];
        } else if (priorCalls === 2 && toolNames.includes("store_leads")) {
          toolCalls = [pick("store_leads", { leads: [
            { email: "sarah.chen@acme.com", person_name: "Sarah Chen", title: "VP Engineering", company: "acme.com", source_url: "https://acme.com/team" },
            { email: "james.ruiz@acme.com", person_name: "James Ruiz", title: "Head of Sales", company: "acme.com" },
          ] })];
        } else if (priorCalls === 3 && toolNames.includes("verify_email")) {
          toolCalls = [pick("verify_email", { email: "sarah.chen@acme.com" })];
        } else {
          return json(res, 200, {
            choices: [{
              message: {
                role: "assistant",
                content: "Done. I searched for B2B SaaS companies interested in AI, extracted 2 contacts from acme.com, stored them, and verified sarah.chen@acme.com. Summary: 2 leads stored, 1 verified, categories: SaaS / Software, interests: AI / Machine Learning.",
              },
            }],
          });
        }
        return json(res, 200, {
          choices: [{ message: { role: "assistant", content: null, tool_calls: toolCalls } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
      }

      let content: string;
      if (/professional profile/i.test(all)) {
        content = JSON.stringify({
          fullName: "Sarah Chen", title: "VP Engineering",
          contact: { email: "sarah.chen@acme.com", linkedin: "https://linkedin.com/in/sarah-chen", location: "San Francisco" },
          summary: "Engineering leader with 10+ years in cloud platforms.",
          skills: ["TypeScript", "Python", "Kubernetes", "AWS", "Team Leadership", "System Design"],
          experience: [{ role: "VP Engineering", company: "Acme Inc", period: "2021-present", highlights: ["Scaled platform to 4M users", "Built 3 teams"] }],
          education: [{ degree: "BS Computer Science", school: "MIT" }],
          projects: [{ name: "Open-source crawler", description: "Rust web crawler" }],
        });
      } else if (/professional resume writer|Tailor a candidate/i.test(all)) {
        content = JSON.stringify({
          resumeMarkdown: "# Sarah Chen\n\n## Summary\nEngineering leader...\n\n## Experience\n**VP Engineering, Acme Inc** — built AI infrastructure (tailored to the job).\n\n## Skills\n- Kubernetes, AWS, TypeScript",
          coverLetter: "Dear Hiring Team,\n\nI am applying for the role...",
          talkingPoints: ["Scaled platform to 4M users", "Led AI platform team"],
          keywords: ["machine learning", "cloud", "leadership"],
        });
      } else if (/cold application email/i.test(all) || /LinkedIn message/i.test(all)) {
        content = JSON.stringify({
          subject: "Application: Senior Platform Engineer — Sarah Chen",
          body: "Hi,\n\nI'm Sarah Chen, VP Engineering at Acme Inc...\n\nBest, Sarah",
        });
      } else if (/Score how well/i.test(all)) {
        content = JSON.stringify({ score: 82, strengths: ["Cloud experience"], gaps: ["No ML ops"], questions: ["Team size?"] });
      } else if (/plugin is a SINGLE JSON|generate Spider extension plugins/i.test(all)) {
        content = JSON.stringify({
          id: "ai-generated-demo", name: "AI Generated Demo", version: "1.0.0",
          description: "Generated by the AI plugin builder",
          rules: { interests: [{ match: "sustainability|green", topic: "Sustainability" }] },
          exporters: [{ id: "jsonl", label: "JSON Lines", format: "jsonl" }],
        });
      } else if (/Classify this company/i.test(all)) {
        content = JSON.stringify({
          category: "SaaS / Software",
          subcategory: "Developer tools",
          tier: "SMB",
          confidence: 0.92,
          reason: "mock: company content describes an API/developer platform",
          interests: [
            { topic: "AI / Machine Learning", confidence: 0.9 },
            { topic: "Cloud / DevOps", confidence: 0.85 },
            { topic: "Developer Tools", confidence: 0.8 },
          ],
        });
      } else {
        const companyMatch = all.match(/Company:\s*([^\n]+)/);
        const company = companyMatch ? companyMatch[1].trim() : "acme.com";
        const host = company.replace(/^https?:\/\//, "").replace(/\/$/, "");
        content = JSON.stringify({
          contacts: [
            { email: "sarah.chen@" + host, person_name: "Sarah Chen", title: "VP Engineering", phone: "+1 (415) 555-0192", linkedin: "https://linkedin.com/in/sarah-chen" },
            { email: "james.ruiz@" + host, person_name: "James Ruiz", title: "Head of Sales" },
            { email: "hello@" + host, title: "General" },
          ],
        });
      }
      return json(res, 200, {
        choices: [{ message: { role: "assistant", content } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    }
    return json(res, 404, { error: `mock: no route for ${method} ${url}` });
  } catch (err) {
    return json(res, 500, { error: String(err) });
  }
  };
}

export interface MockApi {
  url: string;
  close: () => Promise<void>;
}

/** Start the mock on an ephemeral (or given) port. */
export async function startMockApi(port = 0): Promise<MockApi> {
  const server = http.createServer(createMockHandler());
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  return {
    url: "http://127.0.0.1:" + actual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Direct execution: node scripts/mock-api.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startMockApi(Number(process.env.PORT ?? 8787));
  console.log("Mock API listening on " + url + " (spider+plunk+openai)");
}