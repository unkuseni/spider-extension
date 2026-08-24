// Autonomous lead-generation agent: the LLM drives search → crawl → extract →
// categorize → verify → store by calling tools. OpenAI-compatible function calling
// (OpenAI, DeepSeek chat, Groq, Ollama with tool support).

import type { Client } from "@libsql/client";
import type { Config } from "./config.ts";
import { chatWithTools, type ToolCallMsg } from "./ai.ts";
import { buildTools, toolDefs, type Tool } from "./tools.ts";
import type { PluginTool } from "./types.ts";
import { log } from "./log.ts";

export interface AgentOptions {
  maxTurns?: number;
  limit?: number;
  dryRun?: boolean;
  /** Extra tools contributed by plugins. */
  extraTools?: PluginTool[];
}

export interface AgentResult {
  objective: string;
  final: string;
  turns: number;
  toolCalls: { tool: string; count: number }[];
  stored: number;
  updated: number;
  verified: number;
  invalid: number;
  errors: string[];
}

const SYSTEM_PROMPT =
  "You are an autonomous B2B lead-generation agent. You have tools for web search, " +
  "site crawling, employee extraction (an 'employee scraper' — names/titles/departments " +
  "via AI Studio prompt→JSON when enabled), contact extraction, employee discovery, " +
  "email inference (pattern-based guessing + Plunk verification), company categorization " +
  "(industry + interests + company relationships), lead scoring (department/seniority/grade), " +
  "email verification (Plunk), storing leads (Turso), querying stored leads, scraper-catalog " +
  "browsing, and structured fetching of marketplace/listing pages (Zillow, Indeed, Yelp).\n" +
  "Rules:\n" +
  "- Use the tools to accomplish the user's objective. NEVER invent data: only report what tools return.\n" +
  "- Typical flow: search_web to find targets → extract_contacts per target → " +
  "find_employees to get names without emails → guess_emails to infer + verify their addresses → " +
  "categorize_company → find_relationships to map partners/clients → score_leads → " +
  "store_leads → verify_email for new emails (when verification is wanted).\n" +
  "- fetch_structured is for curated configs / marketplace pages; extract_contacts is for company sites.\n" +
  "- Never store fabricated emails. Email addresses must come from extraction results or from " +
  "guess_emails (which verifies every inferred address with Plunk before storing).\n" +
  "- Keep tool arguments minimal and correct; parse tool results before deciding next steps.\n" +
  "- When the objective is complete (or blocked), reply with a concise final summary: " +
  "targets examined, leads found/stored/updated, scores/grades, verified/invalid counts, " +
  "categories + top interests + relationships, and any failures.";

function countToolCalls(calls: Map<string, number>): { tool: string; count: number }[] {
  return [...calls.entries()].map(([tool, count]) => ({ tool, count }));
}

/**
 * Run the agent loop: chat → tool calls → execute → feed results back → until the
 * model answers without tool calls or the turn budget is exhausted.
 */
export async function runAgent(
  db: Client,
  cfg: Config,
  objective: string,
  opts: AgentOptions = {}
): Promise<AgentResult> {
  const maxTurns = opts.maxTurns ?? 20;
  const tools = buildTools(cfg, db, { dryRun: opts.dryRun, limit: opts.limit });
  // Merge plugin tools (built-ins win on name collision — plugins are warned).
  for (const pt of opts.extraTools ?? []) {
    if (!pt || typeof pt.name !== "string" || !pt.name) continue;
    if (tools[pt.name]) {
      log.warn("Plugin tool '" + pt.name + "' collides with a built-in tool — skipping");
      continue;
    }
    tools[pt.name] = {
      name: pt.name,
      description: pt.description,
      parameters: pt.parameters,
      run: (args, ctx) => Promise.resolve(pt.run(args, ctx)),
    };
  }
  const defs = toolDefs(tools);
  const calls = new Map<string, number>();
  const errors: string[] = [];

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: objective },
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
      const msg = (err as Error).message;
      errors.push(msg);
      // If the provider rejects the tools payload, surface a clear explanation.
      if (/tool|function/i.test(msg) && /400|invalid|not supported|unknown/i.test(msg)) {
        final = "The AI provider rejected function calling: " + msg +
          " — use a function-calling-capable model (OpenAI, DeepSeek deepseek-chat / deepseek-v4-flash, Groq) or the hunt/search commands instead.";
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
      // Feed the call + its result back into the conversation.
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          },
        ],
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
      // Track verification/store outcomes reported by tools.
      if (call.name === "verify_email") {
        try {
          const parsed = JSON.parse(result);
          if (parsed.valid === true) verified++;
          else if (parsed.valid === false) invalid++;
        } catch { /* ignore */ }
      }
      if (call.name === "store_leads") {
        try {
          const parsed = JSON.parse(result);
          stored += Number(parsed.stored ?? 0);
          updated += Number(parsed.updated ?? 0);
        } catch { /* ignore */ }
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
    errors,
  };
}

async function executeToolCall(
  tools: Record<string, Tool>,
  call: ToolCallMsg,
  calls: Map<string, number>,
  errors: string[],
  cfg: Config,
  db: Client
): Promise<string> {
  calls.set(call.name, (calls.get(call.name) ?? 0) + 1);
  const tool = tools[call.name];
  if (!tool) {
    const msg = "unknown tool: " + call.name;
    errors.push(msg);
    return JSON.stringify({ error: msg });
  }
  log.info("  → " + call.name + " " + JSON.stringify(call.args ?? {}).slice(0, 160));
  try {
    return await tool.run(call.args ?? {}, { cfg, db });
  } catch (err) {
    const msg = call.name + ": " + (err as Error).message;
    errors.push(msg);
    log.warn("Tool error: " + msg);
    return JSON.stringify({ error: msg });
  }
}