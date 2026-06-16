import { SUGGEST_SYSTEM_PROMPT } from "./prompts.js";
import { runAgentLoop, isAgentConfigured } from "./loop.js";

export { isAgentConfigured };

/** Suggest: returns exactly three suggestions via return_suggestions. The
 *  Anthropic SDK plumbing lives in runAgentLoop; this wrapper just supplies
 *  the system prompt, opening message, terminal tool, and iteration cap. */
export async function runSuggestAgent(signal?: AbortSignal) {
  return runAgentLoop({
    system: SUGGEST_SYSTEM_PROMPT,
    openingMessage:
      "Pick today's three. Use the tools to read goals, today's calendar, pending tasks, and recent completions, then call return_suggestions with exactly three picks.",
    terminalToolName: "return_suggestions",
    payloadKey: "suggestions",
    maxIterations: 8,
    signal,
  });
}
