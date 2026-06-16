import { db } from "../db/client.js";

type EventRow = {
  id: string; title: string; start_min: number; end_min: number; kind: string | null; color: string | null;
};

function computeFreeBlocks(events: EventRow[], dayStart: number, dayEnd: number) {
  const sorted = [...events].sort((a, b) => a.start_min - b.start_min);
  const blocks: { start: number; end: number }[] = [];
  let cursor = dayStart;
  for (const ev of sorted) {
    if (ev.start_min > cursor) blocks.push({ start: cursor, end: ev.start_min });
    cursor = Math.max(cursor, ev.end_min);
  }
  if (cursor < dayEnd) blocks.push({ start: cursor, end: dayEnd });
  return blocks;
}

const selectGoalsAnnual    = db.prepare("SELECT * FROM goals_annual");
const selectGoalsQuarterly = db.prepare("SELECT * FROM goals_quarterly");
const selectGoalsMonthly   = db.prepare("SELECT * FROM goals_monthly");
const selectPendingTasks   = db.prepare(`
  SELECT id, source, title, note, project, tag, estimate_min, due, lane, big_rock, pinned
  FROM tasks WHERE done_at IS NULL
`);
const selectEvents = db.prepare(`
  SELECT id, title, start_min, end_min, kind, color FROM calendar_events ORDER BY start_min ASC
`);
const selectMeta = db.prepare(`
  SELECT day_start_min, day_end_min FROM calendar_meta WHERE id = 1
`);
const selectCompletions = db.prepare(`
  SELECT task_id, done_at, source, est_min FROM completions_log
  WHERE done_at >= :since ORDER BY done_at DESC
`);
// "Stuck" = still open, still in an active lane (today/this_week), but
// has been around for ≥ N days. Uses created_at as the age proxy — sync
// touches updated_at on every poll, so it's noisy; created_at is stable
// and means "you've been carrying this around for a while."
const selectStuckTasks = db.prepare(`
  SELECT id, source, title, lane, project, tag, estimate_min, due, pinned,
         created_at, updated_at
  FROM tasks
  WHERE done_at IS NULL
    AND lane IN ('today', 'this_week')
    AND created_at < :before
  ORDER BY created_at ASC
`);

export const TOOL_DEFS = [
  {
    name: "list_goals",
    description: "List goals at a horizon. Annual = year-long bets; quarterly = milestones; monthly = current-month initiatives with linked next-step tasks (the usual source of today's three).",
    input_schema: {
      type: "object",
      properties: { horizon: { type: "string", enum: ["annual", "quarterly", "monthly"] } },
      required: ["horizon"],
    },
  },
  {
    name: "list_pending_tasks",
    description: "All not-yet-done tasks across every lane (now/today/this_week/this_month/backlog). Returns id, title, lane, source, project, tag, estimate_min, due, big_rock, pinned. `lane` and `pinned` (0/1) together identify already-in-focus tasks (now, today, or pinned this_week).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_calendar_today",
    description: "Today's events plus computed free pockets and the longest deep-work window. Use to right-size suggestions to the day's shape.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_completions",
    description: "What the user actually finished in the last N days. Don't suggest something already done.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number" } },
      required: ["days"],
    },
  },
  {
    name: "return_suggestions",
    description: "Final answer: three suggestions. Calling this terminates the loop.",
    input_schema: {
      type: "object",
      properties: {
        // Shared key with return_plan so the loop can extract picks uniformly
        // without the caller threading a payload-key string through opts.
        picks: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              goal_id: { type: "string", description: "The monthly goal id this suggestion ladders to." },
              task_id: { type: ["string", "null"], description: "Concrete task id if one exists; null otherwise." },
              reason: { type: "string", description: "One-sentence reason shown to the user (≤120 chars)." },
            },
            required: ["goal_id", "reason"],
          },
        },
      },
      required: ["picks"],
    },
  },
  {
    name: "list_stuck_tasks",
    description: "Open tasks sitting in today/this_week that have been around for `days` or more (default 7). These are candidates for momentum picks — Roger has been carrying them without finishing.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Minimum age in days. Default 7." } },
    },
  },
  {
    name: "return_plan",
    description: "Final answer for Plan-my-day: 3-5 picks for today's focus. Each may reference an existing task (task_id) or just a goal + free-form title (goal_id + title). Calling this terminates the loop.",
    input_schema: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              goal_id: { type: "string", description: "The monthly goal id this pick ladders to." },
              task_id: { type: ["string", "null"], description: "Concrete task id if one exists; null otherwise." },
              title:   { type: ["string", "null"], description: "Free-form title when no task_id (creating a new task)." },
              reason:  { type: "string", description: "One-sentence reason shown to the user (≤120 chars). Mention if it's a stuck-task pickup." },
            },
            required: ["goal_id", "reason"],
          },
        },
      },
      required: ["picks"],
    },
  },
] as const;

export function executeTool(name: string, input: unknown): unknown {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "list_goals": {
      const horizon = String(args.horizon);
      if (horizon === "annual")    return selectGoalsAnnual.all();
      if (horizon === "quarterly") return selectGoalsQuarterly.all();
      if (horizon === "monthly")   return selectGoalsMonthly.all();
      return { error: `unknown horizon: ${horizon}` };
    }
    case "list_pending_tasks":
      return selectPendingTasks.all();
    case "get_calendar_today": {
      const events = selectEvents.all() as EventRow[];
      const meta = (selectMeta.get() as { day_start_min: number; day_end_min: number } | undefined)
        ?? { day_start_min: 8 * 60 + 30, day_end_min: 18 * 60 + 30 };
      const freeBlocks = computeFreeBlocks(events, meta.day_start_min, meta.day_end_min);
      const freeTotal = freeBlocks.reduce((a, b) => a + (b.end - b.start), 0);
      const bestBlock = freeBlocks.length > 0
        ? freeBlocks.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a)
        : null;
      return { events, freeBlocks, freeTotal, bestBlock, dayWindow: meta };
    }
    case "get_recent_completions": {
      const days = Math.max(1, Number(args.days) || 7);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      return selectCompletions.all({ since });
    }
    case "list_stuck_tasks": {
      const days = Math.max(1, Number(args.days) || 7);
      const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      return selectStuckTasks.all({ before });
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

export type RawSuggestion = { goal_id: string; task_id?: string | null; title?: string | null; reason: string };

// Server-side backstop for the plan-day "don't re-pick what's already in focus"
// rule. Used by runPlanDayAgent to drop picks before they reach the modal —
// the prompt asks the model to skip them too, but LLM compliance is
// probabilistic and this filter makes the invariant mechanical.
const selectTaskFocusState = db.prepare(
  "SELECT lane, pinned FROM tasks WHERE id = :id"
);
export function isTaskInActiveFocus(taskId: string): boolean {
  const row = selectTaskFocusState.get({ id: taskId }) as
    | { lane: string; pinned: number }
    | undefined;
  if (!row) return false;
  if (row.lane === "now" || row.lane === "today") return true;
  if (row.lane === "this_week" && row.pinned === 1) return true;
  return false;
}

const selectMonthlyById   = db.prepare("SELECT * FROM goals_monthly WHERE id = :id");
const selectQuarterlyById = db.prepare("SELECT * FROM goals_quarterly WHERE id = :id");
const selectAnnualById    = db.prepare("SELECT * FROM goals_annual WHERE id = :id");
const selectTaskById      = db.prepare(`
  SELECT id, source, title, note, project, tag, estimate_min, due, lane, big_rock
  FROM tasks WHERE id = :id
`);

type MonthlyRow = { id: string; parent: string; title: string; progress: number; next_step: string | null; linked_task_id: string | null };
type QuarterlyRow = { id: string; parent: string | null; title: string; progress: number; weeks_left: number | null };
type AnnualRow = { id: string; title: string; color: string | null; intent: string | null; target: string | null; progress: number; trend: string | null };
type TaskRow = {
  id: string; source: string; title: string; note: string | null; project: string | null;
  tag: string | null; estimate_min: number | null; due: string | null; lane: string; big_rock: number;
};

/** Builds the wire shape SuggestionModal expects from compact agent output. */
export function enrichSuggestions(raw: RawSuggestion[]) {
  return raw.flatMap((s) => {
    const goal = selectMonthlyById.get({ id: s.goal_id }) as MonthlyRow | undefined;
    if (!goal) return [];

    const quarter = selectQuarterlyById.get({ id: goal.parent }) as QuarterlyRow | undefined;
    const annualId = quarter ? quarter.parent : goal.parent;
    const annual = annualId ? selectAnnualById.get({ id: annualId }) as AnnualRow | undefined : undefined;
    if (!annual) return [];

    const task = s.task_id
      ? (selectTaskById.get({ id: s.task_id }) as TaskRow | undefined)
      : undefined;

    // Plan-day picks may set `title` instead of `task_id` (no existing
    // task yet). Surface it on the wire `task` field with a synthetic
    // null id so the modal can render the title; the accept flow checks
    // for `task.id` to decide PATCH-existing vs create-new.
    const wireTask = task
      ? {
          id: task.id, title: task.title, source: task.source,
          project: task.project ?? undefined, tag: task.tag ?? undefined,
          estimate: task.estimate_min ?? undefined, due: task.due ?? undefined,
          bigRock: task.big_rock === 1 ? true : undefined,
        }
      : (s.title ? { id: null, title: s.title } : null);

    return [{
      goal: {
        id: goal.id, title: goal.title, progress: goal.progress, parent: goal.parent,
        nextStep: goal.next_step, linkedTaskId: goal.linked_task_id,
      },
      quarter: quarter ? {
        id: quarter.id, parent: quarter.parent, title: quarter.title,
        progress: quarter.progress, weeksLeft: quarter.weeks_left,
      } : null,
      annual,
      task: wireTask,
      reason: s.reason,
    }];
  });
}
