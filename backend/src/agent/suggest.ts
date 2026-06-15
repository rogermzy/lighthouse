import Anthropic from "@anthropic-ai/sdk";
import { SUGGEST_SYSTEM_PROMPT } from "./prompts.js";
import { TOOL_DEFS, executeTool, enrichSuggestions, type RawSuggestion } from "./tools.js";

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 8;

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function runSuggestAgent() {
  if (!isAgentConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Pick today's three. Use the tools to read goals, today's calendar, pending tasks, and recent completions, then call return_suggestions with exactly three picks.",
    },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      // 16k headroom — same failure mode plan-day.ts hit at 4k (model
      // stopping with stop_reason=max_tokens before calling its terminal
      // tool). Keep parity so a fix in one doesn't silently regress the
      // other.
      max_tokens: 16384,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SUGGEST_SYSTEM_PROMPT,
      tools: TOOL_DEFS as unknown as Anthropic.Tool[],
      messages,
    });

    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "Agent exceeded the per-turn token budget (16k). Try again — the model usually settles on retry.",
      );
    }
    if (response.stop_reason !== "tool_use") {
      throw new Error(`Agent stopped without calling a tool (stop_reason=${response.stop_reason}).`);
    }

    // Preserve the full assistant turn — required for thinking + tool_use blocks.
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    const terminal = toolUses.find((t) => t.name === "return_suggestions");
    if (terminal) {
      const raw = ((terminal.input ?? {}) as { suggestions?: RawSuggestion[] }).suggestions ?? [];
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
