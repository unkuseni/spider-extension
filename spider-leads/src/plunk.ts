// Plunk email verification client (https://docs.useplunk.com/api-reference/public-api/verifyEmail)
// POST /v1/verify  →  { success, data: { valid, isDisposable, isAlias, isTypo, isPlusAddressed,
//                                    isPersonalEmail, domainExists, hasWebsite, hasMxRecords, reasons } }

import type { Config } from "./config.ts";
import type { VerificationResult } from "./types.ts";
import { log } from "./log.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function verifyEmail(cfg: Config, email: string): Promise<VerificationResult> {
  if (!cfg.plunkApiKey) throw new Error("PLUNK_API_KEY is not set");
  const resp = await fetch(cfg.plunkApiBase.replace(/\/$/, "") + "/v1/verify", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.plunkApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (resp.status === 429) {
    const retryAfter = Number(resp.headers.get("retry-after") ?? 2);
    log.debug(`plunk 429 — waiting ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return verifyEmail(cfg, email); // simple retry; caller rate-limits concurrency anyway
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
    } catch { /* keep text */ }
    throw new Error(`Plunk verify failed (${resp.status}): ${msg}`);
  }
  const body: any = await resp.json();
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
    checkedAt: new Date().toISOString(),
  };
}

/** Verify a batch of emails with bounded concurrency, calling onResult per email. */
export async function verifyBatch(
  cfg: Config,
  emails: string[],
  opts: { concurrency?: number; onResult?: (email: string, res: VerificationResult, err?: Error) => void } = {}
): Promise<void> {
  const concurrency = opts.concurrency ?? 5;
  let cursor = 0;
  const worker = async () => {
    while (cursor < emails.length) {
      const email = emails[cursor++];
      try {
        const res = await verifyEmail(cfg, email);
        // Await onResult: callers persist results / count stats inside it.
        await opts.onResult?.(email, res);
      } catch (err) {
        await opts.onResult?.(email, null as unknown as VerificationResult, err as Error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(emails.length, 1)) }, worker));
}
