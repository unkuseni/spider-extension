// Lead-level classification + scoring: turn a raw contact (title, email
// veracity, company tier) into a structured, Hunter.io-style lead grade.
// Browser-safe (no node imports). Rules-first (zero AI cost); AI stays for
// company categorization + relationships.

export type Department = "engineering" | "sales" | "marketing" | "product" | "operations" | "finance" | "hr" | "legal" | "other";
export type Seniority = "exec" | "head" | "director" | "manager" | "ic" | "unknown";
export type LeadGrade = "A" | "B" | "C" | "D";

export interface LeadClass {
  department: Department;
  seniority: Seniority;
  decisionMaker: boolean;
}

const EXEC_KEYWORDS = /\b(ceo|cto|coo|cfo|cmo|cio|cro|founder|co-founder|cofounder|owner|principal|partner|president|chairman|chair|managing director|md|vp|vice president|evp|svp|chief)\b/i;
const HEAD_KEYWORDS = /\b(head|lead)\b\s+(of|\s)|head\s+of|head of|team lead|lead engineer|lead designer|lead developer|lead recruiter|lead\b\s+(sales|marketing|product|engineering|design|recruiting|talent|people|success|support|operations|finance|growth|business)/i;
const DIRECTOR_KEYWORDS = /\b(director|board member|trustee|regional manager|gm)\b/i;
const MANAGER_KEYWORDS = /\b(manager|supervisor|coordinator|lead team|team manager)\b/i;

const SALES_KEYWORDS = /\b(sales|account executive|ae\b|sdr|bdr|business development|account manager|growth|partnerships|revenue|inside sales|sales development|customer success|success manager|renewals|closer|quota)\b/i;
const ENGINEERING_KEYWORDS = /\b(engineer(?:ing)?|developer|software|devops|sre|platform|architect|backend|frontend|full[- ]?stack|data engineer|ml|machine learning|ai|infrastructure|qa)\b/i;
const MARKETING_KEYWORDS = /\b(marketing|seo|content|campaign|brand|growth|social media|digital|creat(?:ive|ion)?|copywriter|pr|communications|community|demand gen|performance)\b/i;
const PRODUCT_KEYWORDS = /\b(product|pm\b|ux|ui|designer|design|researcher|project manager|program manager)\b/i;
const FINANCE_KEYWORDS = /\b(finance|accountant|accounting|controller|treasurer|analyst|budget|bookkeeper)\b/i;
const HR_KEYWORDS = /\b(hr|human resources|people ops|talent|recruiter|recruiting|people partner|headcount|onboarding|training)\b/i;
const LEGAL_KEYWORDS = /\b(legal|counsel|attorney|lawyer|compliance|paralegal)\b/i;
const OPERATIONS_KEYWORDS = /\b(operations|ops\b|office manager|admin|administrator|support|success|logistics|procurement|facilities|front desk|reception)\b/i;

/** Classify a job title into department, seniority, and decision-maker flag. */
export function classifyTitle(title?: string | null): LeadClass {
  const t = (title ?? "").trim();
  const lower = t.toLowerCase();
  if (!t) return { department: "other", seniority: "unknown", decisionMaker: false };

  let seniority: Seniority = "unknown";
  if (EXEC_KEYWORDS.test(t)) seniority = "exec";
  else if (HEAD_KEYWORDS.test(t)) seniority = "head";
  else if (DIRECTOR_KEYWORDS.test(t)) seniority = "director";
  else if (MANAGER_KEYWORDS.test(t)) seniority = "manager";
  else if (/\b(engineer|developer|designer|analyst|associate|specialist|coordinator|representative|writer|researcher|recruiter|consultant|advisor|architect|scientist)\b/i.test(t)) seniority = "ic";
  else seniority = "unknown";

  // Department by keyword hit counting (engineering > marketing > sales wins
  // ties: "Sales Engineer" → engineering, "Growth Marketing Manager" → marketing).
  const deptHits: [RegExp, Department][] = [
    [ENGINEERING_KEYWORDS, "engineering"],
    [MARKETING_KEYWORDS, "marketing"],
    [SALES_KEYWORDS, "sales"],
    [PRODUCT_KEYWORDS, "product"],
    [FINANCE_KEYWORDS, "finance"],
    [HR_KEYWORDS, "hr"],
    [LEGAL_KEYWORDS, "legal"],
    [OPERATIONS_KEYWORDS, "operations"],
  ];
  let bestDept: Department = "other";
  let bestHits = 0;
  for (const [re, dept] of deptHits) {
    const hits = (lower.match(re) ?? []).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestDept = dept;
    }
  }
  const department = bestDept;

  const decisionMaker = seniority === "exec" || seniority === "head" || seniority === "director"
    || /\b(owner|founder|ceo|cto|coo|cfo|president|vp|chief|director|head of|partner)\b/i.test(t)
    || /\b(purchasing|procurement|decision|buyer)\b/i.test(t)
    || (seniority === "manager" && /\b(sales|business development|growth)\b/i.test(t));

  return { department, seniority, decisionMaker };
}

// ---------------------------------------------------------------------------
// Composite lead score (0-100) — Hunter-style confidence for the whole record
// ---------------------------------------------------------------------------

export interface ScoreInput {
  /** Email validation state: 1 valid, 0 invalid, null unknown. */
  emailValid: number | null | undefined;
  /** 0-1 confidence for inferred (guessed) addresses. */
  emailScore?: number | null;
  /** How the address was obtained. */
  emailSource?: string | null;
  /** Company tier from categorization (Enterprise/Mid-market/SMB/Unknown). */
  companyTier?: string | null;
  /** Company categorization confidence 0-1. */
  companyConfidence?: number | null;
  /** Human-specified ICP match (true/false/null when ICP rules are unset). */
  icpMatch?: boolean | null;
  title?: string | null;
}

function seniorityWeight(s: Seniority): number {
  switch (s) {
    case "exec": return 1.0;
    case "head": return 0.92;
    case "director": return 0.86;
    case "manager": return 0.78;
    case "ic": return 0.66;
    default: return 0.6;
  }
}

function tierWeight(tier?: string | null): number {
  const t = (tier ?? "").toLowerCase();
  if (t.includes("enterprise")) return 1.0;
  if (t.includes("mid")) return 0.9;
  if (t.includes("smb") || t.includes("small")) return 0.8;
  return 0.72;
}

/**
 * Score a lead 0-100: email veracity dominates (a real, verified address is
 * the whole point), then seniority, then company tier, then ICP fit. Guessed
 * addresses stay below published ones even when deliverable: the person↔address
 * mapping is inferred, and the confidence score reflects that.
 */
export function scoreLead(input: ScoreInput): { score: number; grade: LeadGrade } {
  // Email veracity factor 0..1
  let emailFactor: number;
  if (input.emailValid === 0) {
    // Invalid emails are dead leads — leave the score but near-zero.
    return { score: 0, grade: "D" };
  } else if (input.emailSource === "guessed" && typeof input.emailScore === "number") {
    emailFactor = 0.55 + 0.45 * Math.min(1, Math.max(0, input.emailScore));
  } else if (input.emailSource === "github") {
    emailFactor = 0.95;
  } else if (input.emailSource === "page") {
    emailFactor = input.emailValid === 1 ? 1.0 : 0.75;
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
  const grade: LeadGrade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";
  return { score, grade };
}

/** Grade → bucket label for UIs and reports. */
export function gradeLabel(grade: LeadGrade | string | null): string {
  switch (grade) {
    case "A": return "Hot";
    case "B": return "Warm";
    case "C": return "Cool";
    default: return "Cold";
  }
}

/** Does a lead's company/category/interest set fit the ICP rules? */
export function icpMatch(
  category: string | null | undefined,
  interests: string[],
  icpCategories: string[],
  icpInterests: string[]
): boolean | null {
  if (icpCategories.length === 0 && icpInterests.length === 0) return null; // ICP not configured
  const cat = (category ?? "").toLowerCase();
  if (icpCategories.length > 0 && icpCategories.some((c) => cat.includes(c.toLowerCase()))) return true;
  if (icpCategories.length > 0 && cat) return false;
  if (icpInterests.length > 0) {
    const hay = interests.join(" ").toLowerCase();
    return icpInterests.some((t) => hay.includes(t.toLowerCase()));
  }
  return false;
}
