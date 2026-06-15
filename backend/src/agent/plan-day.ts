import Anthropic from "@anthropic-ai/sdk";
import { PLAN_DAY_SYSTEM_PROMPT } from "./prompts.js";
import { TOOL_DEFS, executeTool, enrichSuggestions, isTaskInActiveFocus, type RawSuggestion } from "./tools.js";

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 10;

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Runs the Plan-my-day agent loop. Mirrors runSuggestAgent but terminates
 *  on return_plan (3-5 picks) and prompts the model to consider stuck tasks.
 *  `signal` propagates client disconnects: aborting it short-circuits the
 *  loop and cancels the in-flight Anthropic call so we don't keep spending
 *  tokens for a response no one will read. */
export async function runPlanDayAgent(signal?: AbortSignal) {
  if (!isAgentConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Plan today's focus. Use the tools — start by checking stuck tasks and goals behind pace, then read today's calendar and recent completions. Return 3-5 picks via return_plan.",
    },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal?.aborted) throw new Error("aborted");
    const response = await client.messages.create(
      {
        model: MODEL,
        // 16k headroom: adaptive thinking + 3-5 picks + multi-tool roundtrips
        // need more budget than Suggest's fixed-3 flow. 4k was triggering
        // max_tokens stops before the model called return_plan.
        max_tokens: 16384,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: PLAN_DAY_SYSTEM_PROMPT,
        tools: TOOL_DEFS as unknown as Anthropic.Tool[],
        messages,
      },
      { signal },
    );

    // Distinguish budget-exhaustion (retryable; usually settles on rerun)
    // from "model gave up without calling a tool" (refusal/end_turn — not
    // retryable from the same prompt). Both used to throw the same opaque
    // error, hiding which one happened.
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "Agent exceeded the per-turn token budget (16k). Try again — the model usually settles on retry.",
      );
    }
    if (response.stop_reason !== "tool_use") {
      throw new Error(`Agent stopped without calling a tool (stop_reason=${response.stop_reason}).`);
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const terminal = toolUses.find((t) => t.name === "return_plan");
    if (terminal) {
      const raw = ((terminal.input ?? {}) as { picks?: RawSuggestion[] }).picks ?? [];
      // Server-side backstop on the "no re-picking what's already in focus"
      // rule. The prompt asks the model to skip these too, but compliance
      // is probabilistic — drop them here so a strayed pick can't surface
      // as a stale duplicate in the modal. Picks without task_id are new
      // tasks (free-form title) and can't be already-in-focus.
      const filtered = raw.filter(
        (p) => !p.task_id || !isTaskInActiveFocus(p.task_id),
      );
      if (filtered.length < raw.length) {
        console.warn(
          `[plan-day] dropped ${raw.length - filtered.length} pick(s) already in active focus`,
        );
      }
      return enrichSuggestions(filtered);
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: JSON.stringify(executeTool(tu.name, tu.input)),
    }));
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`Agent exceeded ${MAX_ITERATIONS} iterations without finishing.`);
}
