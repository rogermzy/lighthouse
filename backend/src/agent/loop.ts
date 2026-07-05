import Anthropic from "@anthropic-ai/sdk";
import { MODEL, isAgentConfigured } from "./config.js";
import { TOOL_DEFS, executeTool, enrichSuggestions, type RawSuggestion } from "./tools.js";

export { isAgentConfigured };

/** Typed error a route can map to a clean user-facing message instead of a
 *  generic 500 "agent failed". Carries a stable `code` string so the route
 *  can switch on intent without parsing prose. */
export class AgentLoopError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "AgentLoopError";
  }
}

function isValidRawSuggestion(x: unknown): x is RawSuggestion {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.goal_id === "string" && typeof o.reason === "string";
}

/** Shared agent loop for runSuggestAgent / runPlanDayAgent. Both follow the
 *  same pattern: send a tool-using request, on tool_use execute and append
 *  results, on terminal-tool extract the raw picks list, otherwise iterate
 *  until maxIterations. The diff between the two callers is parameters
 *  (system prompt, opening message, terminal tool name, budget, iteration
 *  cap, optional post-filter), so they all live in opts. Keeps the
 *  Anthropic SDK plumbing (stop_reason handling, signal threading, thinking
 *  config) in one place so a fix in one path can't regress the other.
 *
 *  Returns the enriched suggestion list — what the modals consume. */
export async function runAgentLoop(opts: {
  system: string;
  openingMessage: string;
  terminalToolName: string;
  maxTokens?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  /** Drop picks that shouldn't reach the UI (e.g. already-in-focus tasks
   *  for plan-day). Runs after shape-validation, before enrichSuggestions.
   *  Throw AgentLoopError from here to surface a typed message; returning
   *  an empty array also surfaces an `all_filtered` error so the modal
   *  doesn't silently render blank. */
  filterRaw?: (raw: RawSuggestion[]) => RawSuggestion[];
}) {
  if (!isAgentConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const {
    system, openingMessage, terminalToolName,
    maxTokens = 16384, maxIterations = 10, signal, filterRaw,
  } = opts;

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: openingMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) throw new AgentLoopError("aborted", "aborted");
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
      throw new AgentLoopError(
        "max_tokens",
        `Agent exceeded the per-turn token budget (${maxTokens}). Try again — the model usually settles on retry.`,
      );
    }
    if (response.stop_reason !== "tool_use") {
      throw new AgentLoopError(
        "no_tool_call",
        `Agent stopped without calling a tool (stop_reason=${response.stop_reason}).`,
      );
    }

    // Preserve the FULL assistant turn — Anthropic requires that thinking
    // blocks round-trip alongside tool_use blocks when the next turn is a
    // tool_result. Stripping or filtering response.content will make the
    // very next iteration's messages.create return 400 "thinking blocks
    // must be preserved with tool_use." Don't "optimize" this push.
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const terminal = toolUses.find((t) => t.name === terminalToolName);
    if (terminal) {
      // Both terminal tools (return_plan, return_suggestions) wrap their
      // payload in `{ picks: RawSuggestion[] }` — schema is enforced
      // server-side via the tools.ts input_schema, but the model can still
      // emit a malformed value that satisfies the SDK type. Validate
      // explicitly so a downstream selectMonthlyById.get({id: undefined})
      // can't crash with a cryptic node:sqlite error.
      const rawInput = (terminal.input ?? {}) as Record<string, unknown>;
      const rawPicks = rawInput.picks;
      if (!Array.isArray(rawPicks)) {
        throw new AgentLoopError(
          "malformed_picks",
          `Agent's ${terminalToolName} call returned non-array picks.`,
        );
      }
      const raw = rawPicks.filter(isValidRawSuggestion);
      if (raw.length === 0) {
        throw new AgentLoopError(
          "malformed_picks",
          `Agent's ${terminalToolName} returned no picks with required goal_id + reason.`,
        );
      }
      const finalRaw = filterRaw ? filterRaw(raw) : raw;
      if (filterRaw && finalRaw.length < raw.length) {
        console.warn(
          `[agent] filtered ${raw.length - finalRaw.length} of ${raw.length} pick(s) from ${terminalToolName}`,
        );
      }
      // If the post-filter drops EVERY pick, the modal would render blank
      // with no error — distinguish this from "the agent had nothing to
      // say" so the route can show a useful message ("everything you
      // picked is already in focus" etc.).
      if (finalRaw.length === 0) {
        throw new AgentLoopError(
          "all_filtered",
          "Every pick was filtered out — likely all already in active focus.",
        );
      }
      const enriched = enrichSuggestions(finalRaw);
      // enrichSuggestions drops picks whose goal_id doesn't resolve to a
      // monthly goal with an intact annual chain — a second silent-blank
      // hazard the guard above can't see. Surface it the same way instead
      // of returning a 200 with an empty modal.
      if (enriched.length === 0) {
        throw new AgentLoopError(
          "all_filtered",
          "No pick resolved to a monthly goal with an intact goal ladder.",
        );
      }
      return enriched;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: JSON.stringify(executeTool(tu.name, tu.input)),
    }));
    messages.push({ role: "user", content: toolResults });
  }

  throw new AgentLoopError(
    "max_iterations",
    `Agent exceeded ${maxIterations} iterations without finishing.`,
  );
}
