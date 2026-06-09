import Anthropic from "@anthropic-ai/sdk";
import { PLAN_DAY_SYSTEM_PROMPT } from "./prompts.js";
import { TOOL_DEFS, executeTool, enrichSuggestions, type RawSuggestion } from "./tools.js";

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 10;

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Runs the Plan-my-day agent loop. Mirrors runSuggestAgent but terminates
 *  on return_plan (3-5 picks) and prompts the model to consider stuck tasks. */
export async function runPlanDayAgent() {
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
    const response = await client.messages.create({
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
    });

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
      return enrichSuggestions(raw);
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
