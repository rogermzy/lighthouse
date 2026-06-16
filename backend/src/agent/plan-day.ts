import { PLAN_DAY_SYSTEM_PROMPT } from "./prompts.js";
import { isTaskInActiveFocus } from "./tools.js";
import { runAgentLoop, isAgentConfigured } from "./loop.js";

export { isAgentConfigured };

/** Plan-my-day: returns 3-5 picks via return_plan. Differs from Suggest in
 *  the terminal tool, the system prompt (stuck-task framing), the 10-iteration
 *  cap (vs 8) for the larger pick set, and the server-side post-filter that
 *  drops picks already in active focus. Anthropic SDK plumbing lives in
 *  runAgentLoop. */
export async function runPlanDayAgent(signal?: AbortSignal) {
  return runAgentLoop({
    system: PLAN_DAY_SYSTEM_PROMPT,
    openingMessage:
      "Plan today's focus. Use the tools — start by checking stuck tasks and goals behind pace, then read today's calendar and recent completions. Return 3-5 picks via return_plan.",
    terminalToolName: "return_plan",
    maxIterations: 10,
    signal,
    // Backstop on the "no re-picking what's already in focus" rule. The
    // prompt asks the model to skip these too, but LLM compliance is
    // probabilistic; this filter makes the invariant mechanical. Picks
    // without a non-empty task_id string are new tasks (free-form title)
    // and can't be already-in-focus — guard the type explicitly so the
    // model emitting task_id="" doesn't slip past as "no task_id".
    filterRaw: (raw) => raw.filter((p) => {
      if (typeof p.task_id !== "string" || p.task_id.length === 0) return true;
      return !isTaskInActiveFocus(p.task_id);
    }),
  });
}
