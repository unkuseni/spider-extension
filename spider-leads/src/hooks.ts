// Browser-safe hook dispatcher (no node imports — safe for the extension bundle).
import type { PipelineHooks, Plugin } from "./types.ts";
import { log } from "./log.ts";

/** Fire a named hook across plugins, collecting (but not throwing) errors. */
export async function fireHook(
  plugins: Plugin[],
  hook: keyof PipelineHooks,
  ctx: any,
  errors: string[]
): Promise<void> {
  for (const p of plugins) {
    const fn = (p.hooks ?? {})[hook];
    if (typeof fn !== "function") continue;
    try {
      await (fn as any)(ctx);
    } catch (err) {
      const msg = "plugin " + p.id + " hook " + hook + ": " + (err as Error).message;
      errors.push(msg);
      log.warn(msg);
    }
  }
}
