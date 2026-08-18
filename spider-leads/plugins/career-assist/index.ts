// Career Assist plugin — agent tools wrapping the shared career module.
import type { Plugin } from "../../src/types.ts";
import { buildProfile, tailorResume, draftOutreach, scoreFit } from "../../src/career.ts";

const cfgOf = (ctx: any): any => ctx?.cfg;

const plugin: Partial<Plugin> = {
  tools: [
    {
      name: "build_profile",
      description:
        "Turn a resume (paste the full text) into a structured professional profile: contact info, skills, " +
        "experience, education, projects. Use before tailoring or drafting outreach.",
      parameters: {
        type: "object",
        properties: {
          resume_text: { type: "string", description: "Full resume text" },
          extra_context: { type: "string", description: "Optional extra context (e.g. target industry)" },
        },
        required: ["resume_text"],
      },
      async run(args: any, ctx: any) {
        const cfg = cfgOf(ctx);
        if (!cfg) return JSON.stringify({ error: "career-assist needs a configured session" });
        const profile = await buildProfile(cfg, String(args.resume_text ?? ""), String(args.extra_context ?? ""));
        return JSON.stringify(profile);
      },
    },
    {
      name: "tailor_resume",
      description:
        "Generate a job-specific resume (Markdown), cover letter, interview talking points, and keywords " +
        "from the candidate profile and the job description. Every fact stays true to the profile.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "object", description: "The structured profile from build_profile" },
          job_title: { type: "string" },
          job_description: { type: "string", description: "Paste the job posting" },
          company: { type: "string" },
        },
        required: ["profile", "job_description"],
      },
      async run(args: any, ctx: any) {
        const cfg = cfgOf(ctx);
        if (!cfg) return JSON.stringify({ error: "career-assist needs a configured session" });
        const packet = await tailorResume(cfg, args.profile ?? {}, {
          title: String(args.job_title ?? ""),
          company: String(args.company ?? ""),
          description: String(args.job_description ?? ""),
        });
        return JSON.stringify(packet);
      },
    },
    {
      name: "draft_outreach",
      description:
        "Draft a personalized cold email (channel 'email') or LinkedIn message (channel 'linkedin') for a " +
        "job application. The user reviews and sends it themselves.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "object" },
          job_description: { type: "string" },
          job_title: { type: "string" },
          company: { type: "string" },
          contact_name: { type: "string" },
          contact_email: { type: "string" },
          channel: { type: "string", enum: ["email", "linkedin"] },
        },
        required: ["profile", "job_description", "channel"],
      },
      async run(args: any, ctx: any) {
        const cfg = cfgOf(ctx);
        if (!cfg) return JSON.stringify({ error: "career-assist needs a configured session" });
        const draft = await draftOutreach(cfg, args.profile ?? {}, {
          title: String(args.job_title ?? ""),
          company: String(args.company ?? ""),
          description: String(args.job_description ?? ""),
          contactName: String(args.contact_name ?? ""),
          contactEmail: String(args.contact_email ?? ""),
        }, args.channel === "linkedin" ? "linkedin" : "email");
        return JSON.stringify(draft);
      },
    },
    {
      name: "score_fit",
      description:
        "Score how well the candidate profile fits a job description (0-100) with strengths, gaps, and " +
        "questions to research.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "object" },
          job_description: { type: "string" },
          job_title: { type: "string" },
        },
        required: ["profile", "job_description"],
      },
      async run(args: any, ctx: any) {
        const cfg = cfgOf(ctx);
        if (!cfg) return JSON.stringify({ error: "career-assist needs a configured session" });
        return JSON.stringify(await scoreFit(cfg, args.profile ?? {}, {
          title: String(args.job_title ?? ""),
          description: String(args.job_description ?? ""),
        }));
      },
    },
  ],
};

export default plugin;
