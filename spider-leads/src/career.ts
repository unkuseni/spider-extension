// Career assist: build a structured profile from a resume, tailor it to a job,
// draft outreach, and score fit. Browser-safe (used by the extension UI and the
// career-assist plugin). AI via any OpenAI-compatible endpoint.

import type { Config } from "./config.ts";
import { chatJson, parseJsonObject, hasAiKey } from "./ai.ts";
import { log } from "./log.ts";

export interface CareerProfile {
  fullName?: string;
  title?: string;
  summary?: string;
  contact?: { email?: string; phone?: string; linkedin?: string; location?: string; website?: string };
  skills: string[];
  experience: { role: string; company: string; period?: string; highlights: string[] }[];
  education: { degree: string; school: string; period?: string }[];
  projects: { name: string; description?: string; link?: string }[];
  certifications?: string[];
  languages?: string[];
}

export interface JobContext {
  title?: string;
  company?: string;
  description: string;
  url?: string;
  contactName?: string;
  contactEmail?: string;
}

export interface TailoredPacket {
  resumeMarkdown: string;
  coverLetter: string;
  talkingPoints: string[];
  keywords: string[];
}

export interface OutreachDraft {
  channel: "email" | "linkedin";
  subject?: string;
  body: string;
}

export interface FitScore {
  score: number;
  strengths: string[];
  gaps: string[];
  questions: string[];
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNum(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : fallback;
}

// ---------------------------------------------------------------------------
// buildProfile — resume text → structured profile
// ---------------------------------------------------------------------------

export async function buildProfile(cfg: Config, resumeText: string, extraContext = ""): Promise<CareerProfile> {
  const fallback: CareerProfile = {
    fullName: "",
    title: "",
    summary: "",
    skills: [],
    experience: [],
    education: [],
    projects: [],
  };
  if (!hasAiKey(cfg)) {
    log.warn("No AI key configured — profile will only contain the raw resume text");
    return { ...fallback, raw: resumeText.slice(0, 20000) } as CareerProfile;
  }
  const system =
    "You extract structured professional profiles from resumes. Return ONLY JSON matching this exact schema: " +
    '{"fullName": string, "title": string, "summary": string, "contact": {"email": string, "phone": string, ' +
    '"linkedin": string, "location": string, "website": string}, "skills": string[], "experience": ' +
    '[{"role": string, "company": string, "period": string, "highlights": string[]}], "education": ' +
    '[{"degree": string, "school": string, "period": string}], "projects": [{"name": string, "description": string, ' +
    '"link": string}], "certifications": string[], "languages": string[]}. ' +
    "Keep every fact exactly as written in the resume. NEVER invent skills, employers, or dates. " +
    "Use null/empty arrays for anything not present.";
  const user = "RESUME:\n" + resumeText.slice(0, 30000) + (extraContext ? "\n\nEXTRA CONTEXT:\n" + extraContext.slice(0, 3000) : "");
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 3000));
    return {
      fullName: asStr(json.fullName) || undefined,
      title: asStr(json.title) || undefined,
      summary: asStr(json.summary) || undefined,
      contact: json.contact && typeof json.contact === "object"
        ? {
            email: asStr(json.contact.email) || undefined,
            phone: asStr(json.contact.phone) || undefined,
            linkedin: asStr(json.contact.linkedin) || undefined,
            location: asStr(json.contact.location) || undefined,
            website: asStr(json.contact.website) || undefined,
          }
        : undefined,
      skills: Array.isArray(json.skills) ? json.skills.map((x: any) => asStr(x)).filter(Boolean) : [],
      experience: Array.isArray(json.experience)
        ? json.experience.map((e: any) => ({
            role: asStr(e?.role),
            company: asStr(e?.company),
            period: asStr(e?.period) || undefined,
            highlights: Array.isArray(e?.highlights) ? e.highlights.map((h: any) => asStr(h)).filter(Boolean) : [],
          })).filter((e: any) => e.role || e.company)
        : [],
      education: Array.isArray(json.education)
        ? json.education.map((e: any) => ({ degree: asStr(e?.degree), school: asStr(e?.school), period: asStr(e?.period) || undefined })).filter((e: any) => e.degree || e.school)
        : [],
      projects: Array.isArray(json.projects)
        ? json.projects.map((p: any) => ({ name: asStr(p?.name), description: asStr(p?.description) || undefined, link: asStr(p?.link) || undefined })).filter((p: any) => p.name)
        : [],
      certifications: Array.isArray(json.certifications) ? json.certifications.map((x: any) => asStr(x)).filter(Boolean) : [],
      languages: Array.isArray(json.languages) ? json.languages.map((x: any) => asStr(x)).filter(Boolean) : [],
    };
  } catch (err) {
    log.warn("buildProfile AI failed: " + (err as Error).message);
    return { ...fallback, raw: resumeText.slice(0, 20000) } as CareerProfile;
  }
}

// ---------------------------------------------------------------------------
// tailorResume — profile + job → tailored resume, cover letter, talking points
// ---------------------------------------------------------------------------

function aiError(op: string, err: unknown): Error {
  return new Error(op + " failed: " + (err as Error).message +
    " — check the AI key/model in Settings (an OpenAI-compatible endpoint like DeepSeek/OpenAI/Ollama is required)");
}

export async function tailorResume(cfg: Config, profile: CareerProfile, job: JobContext): Promise<TailoredPacket> {
  const system =
    "You are a professional resume writer. Tailor a candidate's REAL profile to a specific job posting. " +
    "Return ONLY JSON: {\"resumeMarkdown\": string (complete one-page resume in Markdown, reordered and " +
    "reworded to emphasize the most relevant experience for THIS job; EVERY fact must come from the profile " +
    "— never invent employers, titles, dates, or skills), \"coverLetter\": string (3-4 short paragraphs, " +
    "specific to the company and role, referencing real achievements), \"talkingPoints\": string[] (6-8 " +
    "one-line interview points connecting profile to job), \"keywords\": string[] (12-15 terms from the " +
    "job description to weave in naturally)}.";
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 4000));
    return {
      resumeMarkdown: asStr(json.resumeMarkdown, "No resume generated."),
      coverLetter: asStr(json.coverLetter, ""),
      talkingPoints: Array.isArray(json.talkingPoints) ? json.talkingPoints.map((x: any) => asStr(x)).filter(Boolean) : [],
      keywords: Array.isArray(json.keywords) ? json.keywords.map((x: any) => asStr(x)).filter(Boolean) : [],
    };
  } catch (err) {
    throw aiError("tailorResume", err);
  }
}

// ---------------------------------------------------------------------------
// draftOutreach — profile + job → cold email or LinkedIn message (human sends)
// ---------------------------------------------------------------------------

export async function draftOutreach(
  cfg: Config,
  profile: CareerProfile,
  job: JobContext,
  channel: "email" | "linkedin"
): Promise<OutreachDraft> {
  const system =
    channel === "email"
      ? "Write a professional cold application email from a candidate applying to a job. Return ONLY JSON: " +
        '{"subject": string, "body": string}. Body: 3-4 short paragraphs — who you are (from the profile), why ' +
        "this company/role (from the job), 2-3 specific real achievements that fit, and a clear call to action. " +
        "Sign off with the candidate's real name and contact details from the profile. Never invent facts."
      : "Write a short, professional LinkedIn message (max 250 words, no subject) from a candidate reaching " +
        "out about a job. Return ONLY JSON: {\"body\": string}. Reference 1-2 REAL achievements from the profile " +
        "and why this role interests them. Never invent facts.";
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 2000));
    return {
      channel,
      subject: channel === "email" ? asStr(json.subject) || undefined : undefined,
      body: asStr(json.body, ""),
    };
  } catch (err) {
    throw aiError("draftOutreach", err);
  }
}

// ---------------------------------------------------------------------------
// scoreFit — profile vs job description
// ---------------------------------------------------------------------------

export async function scoreFit(cfg: Config, profile: CareerProfile, job: JobContext): Promise<FitScore> {
  const system =
    "Score how well a candidate profile fits a job posting. Return ONLY JSON: {\"score\": number (0-100), " +
    "\"strengths\": string[], \"gaps\": string[], \"questions\": string[]}. Be honest and specific.";
  const user = "PROFILE:\n" + JSON.stringify(profile, null, 1) + "\n\nJOB:\n" + JSON.stringify(job, null, 1);
  try {
    const json = parseJsonObject(await chatJson(cfg, system, user, 1500));
    return {
      score: asNum(json.score, 50),
      strengths: Array.isArray(json.strengths) ? json.strengths.map((x: any) => asStr(x)).filter(Boolean) : [],
      gaps: Array.isArray(json.gaps) ? json.gaps.map((x: any) => asStr(x)).filter(Boolean) : [],
      questions: Array.isArray(json.questions) ? json.questions.map((x: any) => asStr(x)).filter(Boolean) : [],
    };
  } catch (err) {
    throw aiError("scoreFit", err);
  }
}