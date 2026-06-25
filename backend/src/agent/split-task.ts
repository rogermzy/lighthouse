import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { getProfileContext } from "../api/profile.js";
import { MODEL, isAgentConfigured } from "./config.js";

export { isAgentConfigured };

// Named "split-task" to avoid collision with the goal-decomposition agents
// breakdown.ts (annual→quarterly→monthly) and task-breakdown.ts (monthly→tasks),
// which operate on the goals tree. This one operates on a single `tasks` row.

const VALID_TAGS = ["deep", "shallow", "admin", "comms", "personal", "errand"] as const;
type Tag = typeof VALID_TAGS[number];

export type SubtaskProposal = {
  title: string;
  estimateMin: number;
  note: string;
  tag: Tag;
  reasoning: string;
};

type TaskRow = {
  id: string; title: string; note: string | null;
  project: string | null; estimate_min: number | null; parent_task_id: string | null;
};

const selectTask = db.prepare(
  "SELECT id, title, note, project, estimate_min, parent_task_id FROM tasks WHERE id = :id",
);

const SYSTEM = `You break ONE oversized task into 2–8 small, concrete next-actions for an
ADHD user who stalls on big tasks. Each subtask must be a single sitting
(5–60 min), start with a verb, and be independently checkable. Do NOT restate
the parent; produce the actual steps. Prefer fewer, real steps over padding.
Call return_subtasks exactly once.`;

const TOOL: Anthropic.Tool = {
  name: "return_subtasks",
  description: "Return the breakdown of the task into small subtasks.",
  input_schema: {
    type: "object",
    properties: {
      subtasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:       { type: "string" },
            estimateMin: { type: "number" },
            note:        { type: "string" },
            tag:         { type: "string", enum: [...VALID_TAGS] },
            reasoning:   { type: "string" },
          },
          required: ["title", "estimateMin", "reasoning"],
        },
      },
    },
    required: ["subtasks"],
  },
};

/** Typed error a route can map to a clean status/message. */
export class SplitTaskError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SplitTaskError";
  }
}

/** Returns 2–8 validated proposals. Writes nothing. */
export async function runSplitTaskAgent(
  taskId: string,
  signal?: AbortSignal,
): Promise<SubtaskProposal[]> {
  if (!isAgentConfigured()) throw new Error("ANTHROPIC_API_KEY not set");

  const task = selectTask.get({ id: taskId }) as TaskRow | undefined;
  if (!task) throw new SplitTaskError("not_found", `task ${taskId} not found`);
  if (task.parent_task_id) {
    throw new SplitTaskError("is_subtask", "subtasks can't be broken down further");
  }

  const profile = getProfileContext();
  const opening =
    `Break down this task.\n\nTitle: ${task.title}\n` +
    (task.note ? `Notes: ${task.note}\n` : "") +
    (task.project ? `Project: ${task.project}\n` : "") +
    (task.estimate_min ? `Current estimate: ${task.estimate_min}m\n` : "") +
    `\nUser context:\n${profile}`;

  const client = new Anthropic();
  // Forced tool_choice is incompatible with `thinking` (CLAUDE.md gotcha), so
  // there is no thinking block here — unlike the loop.ts agents.
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: "high" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "return_subtasks" },
      messages: [{ role: "user", content: opening }],
    },
    { signal },
  );

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "return_subtasks",
  );
  const raw = (block?.input as { subtasks?: unknown })?.subtasks;
  if (!Array.isArray(raw)) {
    throw new SplitTaskError("malformed", "agent returned no subtasks array");
  }

  // Mechanical enforcement — the prompt is a hint, code is the contract.
  const clean = raw
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.title === "string" && x.title.trim().length > 0)
    .map((x): SubtaskProposal => ({
      title: (x.title as string).trim().slice(0, 200),
      estimateMin: clampEstimate(x.estimateMin),
      note: typeof x.note === "string" ? x.note.trim() : "",
      tag: (VALID_TAGS as readonly string[]).includes(x.tag as string)
        ? (x.tag as Tag)
        : "shallow",
      reasoning: typeof x.reasoning === "string" ? x.reasoning.trim() : "",
    }))
    .slice(0, 8);

  if (clean.length < 2) {
    throw new SplitTaskError("too_few", "couldn't split into 2+ subtasks");
  }
  return clean;
}

function clampEstimate(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 15;
  return Math.max(5, Math.min(120, n));
}
