// Integration-test helpers: mock API + pipeline config + temp DB.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function startMock() {
  const { startMockApi } = await import("../../spider-leads/scripts/mock-api.ts");
  return startMockApi(0); // ephemeral port
}

/** Build a Config pointing at the mock, with a fresh temp file DB. */
export async function testCfg(mockUrl) {
  const { loadConfig } = await import("../../spider-leads/src/config.ts");
  const cfg = loadConfig();
  cfg.spiderApiKey = "test";
  cfg.spiderApiBase = mockUrl;
  cfg.openaiApiKey = "test";
  cfg.openaiBaseUrl = mockUrl + "/v1";
  cfg.openaiModel = "mock-gpt";
  cfg.plunkApiKey = "sk_test";
  cfg.plunkApiBase = mockUrl;
  cfg.spiderExtract = "local";
  cfg.crawlLimit = 6;
  cfg.crawlDepth = 2;
  return cfg;
}

export function tempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), "spider-test-"));
  return { dir, db: join(dir, "test.db") };
}

export function cleanupDb(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}
