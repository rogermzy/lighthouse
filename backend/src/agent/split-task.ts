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
const selectParent = db.prepare("SELECT parent_task_id FROM tasks WHERE id = :id");

// Breakdown is multi-level: a big task splits into a few high-level chunks,
// and any chunk can be broken down again into finer steps. Cap the nesting so
// it can't run away and the roll-up loop stays bounded. A task at this depth
// (root = 0) can no longer be broken down — handle its steps directly.
export const MAX_BREAKDOWN_DEPTH = 4;

/** Number of ancestors above `id` (root = 0). Bounded walk up parent_task_id. */
export function taskDepth(id: string): number {
  let depth = 0;
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 32) {
    const row = selectParent.get({ id: cur }) as { parent_task_id: string | null } | undefined;
    if (!row || !row.parent_task_id) break;
    depth++;
    cur = row.parent_task_id;
  }
  return depth;
}

const SYSTEM = `You break ONE task into 2–8 next-actions for an ADHD user who stalls on
big tasks. Match the ALTITUDE to the task's size:
• If the work is large or multi-phase, return a few HIGH-LEVEL CHUNKS
  (phases/milestones) — each can itself be broken down further later. Don't
  cram 15 tiny steps into one list; that overwhelms. Coarse is correct here.
• If the task is already a small sub-part, return concrete single-sitting
  steps (5–60 min each).
Always 2–8 items, each starting with a verb and independently checkable. Do
NOT restate the parent. Call return_subtasks exactly once.`;

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
  const depth = taskDepth(taskId);
  if (depth >= MAX_BREAKDOWN_DEPTH) {
    throw new SplitTaskError("too_deep", "this is nested deep enough — handle these steps directly");
  }

  const profile = getProfileContext();
  // Steer altitude by depth: top-level can be coarse phases; deeper levels
  // should be concrete single-sitting steps.
  const altitudeHint = depth === 0
    ? "If this is large or multi-phase, return high-level chunks that can each be broken down further — not fine steps."
    : "This is already a sub-part — return concrete, single-sitting steps.";
  const opening =
    `Break down this task. ${altitudeHint}\n\nTitle: ${task.title}\n` +
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
