// Example plugin: fetch_jobs agent tool using public ATS APIs (no auth).
import type { Plugin } from "../../src/types.ts";

interface JobHit {
  title: string;
  location: string | null;
  url: string;
  updated: string | null;
  description: string;
}

async function greenhouse(company: string, limit: number): Promise<JobHit[]> {
  const res = await fetch("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(company) + "/jobs");
  if (!res.ok) throw new Error("greenhouse: HTTP " + res.status);
  const data: any = await res.json();
  const jobs: any[] = Array.isArray(data.jobs) ? data.jobs.slice(0, limit) : [];
  const out: JobHit[] = [];
  for (const j of jobs) {
    let desc = "";
    try {
      const d = await fetch("https://boards-api.greenhouse.io/v1/boards/" + encodeURIComponent(company) + "/jobs/" + j.id).then((r) => r.json());
      desc = String(d.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
    } catch { /* keep empty */ }
    out.push({ title: String(j.title ?? ""), location: j.location?.name ?? null, url: String(j.absolute_url ?? ""), updated: j.updated_at ?? null, description: desc });
  }
  return out;
}

async function lever(company: string, limit: number): Promise<JobHit[]> {
  const res = await fetch("https://api.lever.co/v0/postings/" + encodeURIComponent(company) + "?mode=json");
  if (!res.ok) throw new Error("lever: HTTP " + res.status);
  const data: any[] = await res.json();
  return (Array.isArray(data) ? data.slice(0, limit) : []).map((p) => ({
    title: String(p.text ?? ""),
    location: p.categories?.location ?? null,
    url: String(p.hostedUrl ?? ""),
    updated: p.createdAt ?? null,
    description: String(p.descriptionPlain ?? "").slice(0, 600),
  }));
}

async function ashby(company: string, limit: number): Promise<JobHit[]> {
  const res = await fetch("https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(company), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error("ashby: HTTP " + res.status);
  const data: any = await res.json();
  const jobs: any[] = Array.isArray(data.jobs) ? data.jobs.slice(0, limit) : [];
  return jobs.map((j) => ({
    title: String(j.title ?? ""),
    location: j.location ?? null,
    url: String(j.jobUrl ?? ""),
    updated: j.publishedAt ?? null,
    description: String(j.descriptionPlain ?? "").slice(0, 600),
  }));
}

const plugin: Partial<Plugin> = {
  tools: [
    {
      name: "fetch_jobs",
      description:
        "Fetch current job openings from a company's public job board. Supports Greenhouse, Lever, and Ashby " +
        "platforms (no authentication). Returns title, location, apply URL, and description preview per role.",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company slug on the board (e.g. 'airbnb', 'stripe')" },
          platform: { type: "string", enum: ["greenhouse", "lever", "ashby"], description: "ATS platform" },
          limit: { type: "integer", description: "Max jobs (default 10)" },
        },
        required: ["company", "platform"],
      },
      async run(args: any) {
        const company = String(args.company ?? "").trim();
        const platform = String(args.platform ?? "").trim();
        const limit = Math.min(Number(args.limit) || 10, 50);
        if (!company) return JSON.stringify({ error: "company is required" });
        let jobs: JobHit[];
        if (platform === "greenhouse") jobs = await greenhouse(company, limit);
        else if (platform === "lever") jobs = await lever(company, limit);
        else if (platform === "ashby") jobs = await ashby(company, limit);
        else return JSON.stringify({ error: "platform must be greenhouse | lever | ashby" });
        return JSON.stringify({ count: jobs.length, jobs });
      },
    },
  ],
};

export default plugin;
