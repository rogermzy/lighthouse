import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFS, executeTool, enrichSuggestions, type RawSuggestion } from "./tools.js";

const MODEL = "claude-opus-4-7";

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Shared agent loop for runSuggestAgent / runPlanDayAgent. Both follow the
 *  same pattern: send a tool-using request, on tool_use execute and append
 *  results, on terminal-tool extract the raw picks list, otherwise iterate
 *  until MAX_ITERATIONS. The diff between the two callers is parameters
 *  (system prompt, opening message, terminal tool name, payload key, budget,
 *  iteration cap, optional post-filter), so they all live in opts. Keeps the
 *  Anthropic SDK plumbing (stop_reason handling, signal threading, thinking
 *  config) in one place so a fix in one path can't regress the other.
 *
 *  Returns the enriched suggestion list — what the modals consume. */
export async function runAgentLoop(opts: {
  system: string;
  openingMessage: string;
  terminalToolName: string;
  payloadKey: string; // e.g. "picks" or "suggestions" inside terminal-tool input
  maxTokens?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  /** Drop picks that shouldn't reach the UI (e.g. already-in-focus tasks
   *  for plan-day). Runs after the model picks, before enrichSuggestions. */
  filterRaw?: (raw: RawSuggestion[]) => RawSuggestion[];
}) {
  if (!isAgentConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const {
    system, openingMessage, terminalToolName, payloadKey,
    maxTokens = 16384, maxIterations = 10, signal, filterRaw,
  } = opts;

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: openingMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) throw new Error("aborted");
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system,
        tools: TOOL_DEFS as unknown as Anthropic.Tool[],
        messages,
      },
      { signal },
    );

    // Distinguish budget-exhaustion (retryable; usually settles on rerun)
    // from "model gave up without calling a tool" (refusal/end_turn — not
    // retryable from the same prompt).
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Agent exceeded the per-turn token budget (${maxTokens}). Try again — the model usually settles on retry.`,
      );
    }
    if (response.stop_reason !== "tool_use") {
      throw new Error(`Agent stopped without calling a tool (stop_reason=${response.stop_reason}).`);
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const terminal = toolUses.find((t) => t.name === terminalToolName);
    if (terminal) {
      const raw = ((terminal.input ?? {}) as Record<string, RawSuggestion[]>)[payloadKey] ?? [];
      const finalRaw = filterRaw ? filterRaw(raw) : raw;
      if (filterRaw && finalRaw.length < raw.length) {
        console.warn(
          `[agent] filtered ${raw.length - finalRaw.length} pick(s) from ${terminalToolName}`,
        );
      }
      return enrichSuggestions(finalRaw);
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: JSON.stringify(executeTool(tu.name, tu.input)),
    }));
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${maxIterations} iterations without finishing.`);
}
