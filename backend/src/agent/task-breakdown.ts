import Anthropic from "@anthropic-ai/sdk";
import { db, runTx } from "../db/client.js";
import { getProfileContext } from "../api/profile.js";
import { MODEL, isAgentConfigured } from "./config.js";

type MonthlyRow = {
  id: string; parent: string; title: string; progress: number; next_step: string | null;
};
type QuarterlyRow = {
  id: string; parent: string | null; title: string; progress: number;
};
type AnnualRow = {
  id: string; title: string; intent: string | null; context: string | null;
};
type ExistingTask = {
  id: string; title: string; note: string | null; lane: string;
};
type CandidateTask = {
  id: string; title: string; project: string | null;
  theme: string | null; weight: number | null; lane: string;
};

export type ExistingTaskLink = {
  id: string;
  title: string;
  project: string | null;
  lane: string;
  reasoning: string;
};

const VALID_TAGS = ["deep", "shallow", "admin", "comms", "personal", "errand"] as const;
type Tag = typeof VALID_TAGS[number];

const VALID_DUES = ["today", "tomorrow", "this week", null] as const;
type Due = typeof VALID_DUES[number];

export type TaskProposal = {
  title: string;
  note: string;
  estimateMin: number;
  tag: Tag;
  due: Due;
  reasoning: string;
};

export type TaskBreakdownResult = {
  monthly: { id: string; title: string };
  parent: {
    quarterly?: { id: string; title: string };
    annual?:    { id: string; title: string };
  };
  // New tasks proposed by the agent (user accepts → created).
  tasks: TaskProposal[];
  // Existing tasks the agent thinks already contribute to this milestone
  // (user accepts → link via primary_goal_id, no new tasks created).
  relatedExisting: ExistingTaskLink[];
};

export const isTaskBreakdownConfigured = isAgentConfigured;

const TASK_BREAKDOWN_TOOL: Anthropic.Tool = {
  name: "return_tasks",
  description:
    "Return (a) 3-7 NEW concrete tasks for this milestone, AND (b) any EXISTING tasks from the candidate list that already contribute to this milestone (so the user can link them with one click instead of duplicating work).",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 3,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description:
                "Imperative phrase, sentence case, no trailing period. Something a user could check off (e.g. 'Draft the cold-outreach template', 'Set up Stripe test account'). Avoid vague verbs like 'plan' or 'think about'.",
            },
            note: {
              type: "string",
              description:
                "1-2 sentences of detail or sub-steps to make 'done' unambiguous. Plain text — no markdown.",
            },
            estimate_min: {
              type: "integer",
              description:
                "Realistic minutes to complete. Round to one of: 10, 25, 50, 90. Don't propose anything over 90 — break it down further if needed.",
              enum: [10, 25, 50, 90],
            },
            tag: {
              type: "string",
              enum: ["deep", "shallow", "admin", "comms", "personal", "errand"],
              description:
                "Best-fit category. 'deep' = uninterrupted focus work. 'shallow' = small focused chunks. 'admin' = paperwork/setup. 'comms' = email/slack/calls. 'personal' = non-work. 'errand' = quick external thing.",
            },
            due: {
              type: ["string", "null"],
              enum: ["today", "tomorrow", "this week", null],
              description:
                "Suggested relative deadline based on dependency order. Use null if it can wait. Most tasks should be 'this week' or null; reserve 'today'/'tomorrow' for genuine urgency.",
            },
            reasoning: {
              type: "string",
              description:
                "≤ 20 words explaining why this task moves the milestone forward. Visible to the user as they review.",
            },
          },
          required: ["title", "note", "estimate_min", "tag", "due", "reasoning"],
        },
      },
      related_existing: {
        type: "array",
        description:
          "IDs of EXISTING tasks (from the candidate list in the user message) that already contribute to this milestone. Only include tasks that genuinely ladder to this goal — don't be loose. Empty array if nothing in the candidate list applies.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Exact task id from the candidate list. Must match — anything else is dropped.",
            },
            reasoning: {
              type: "string",
              description: "≤ 20 words: how does this existing task contribute to the milestone?",
            },
          },
          required: ["id", "reasoning"],
        },
      },
    },
    required: ["tasks", "related_existing"],
  },
};

const SYSTEM_PROMPT = `You are the planning brain inside Lighthouse, breaking a monthly goal into concrete actionable tasks.

Your job has TWO parts:

PART A — Propose 3-7 NEW concrete next-step tasks for this milestone.
  - Action-verb-starting titles ("Draft", "Ship", "Send"). Never "plan to X".
  - Each small enough that 'done' is unambiguous in one sitting.
  - Order in dependency sequence: the thing you must do first comes first.
  - Match the user's situation via their About-me + goal-context inputs.
  - Avoid duplicating tasks that already exist (you'll see those listed).

PART B — Scan the candidate-task list. Identify any EXISTING tasks that already
contribute to this milestone but aren't yet linked (no primary_goal_id, or
linked to a different goal). Return their IDs in \`related_existing\`. The
user reviews and one-clicks "link" instead of creating duplicate work.

Be CONSERVATIVE on Part B: only include a candidate if you're confident it
genuinely ladders to this milestone. False positives create clutter. When in
doubt, leave it out — the user can manually link later.

Always call return_tasks exactly once with both \`tasks\` and \`related_existing\`
(can be empty). Do not ask clarifying questions.`;

function pickMonthly(id: string): MonthlyRow | undefined {
  return db.prepare("SELECT * FROM goals_monthly WHERE id = :id").get({ id }) as MonthlyRow | undefined;
}

function pickQuarterly(id: string): QuarterlyRow | undefined {
  return db.prepare("SELECT * FROM goals_quarterly WHERE id = :id").get({ id }) as QuarterlyRow | undefined;
}

function pickAnnual(id: string): AnnualRow | undefined {
  return db.prepare("SELECT * FROM goals_annual WHERE id = :id").get({ id }) as AnnualRow | undefined;
}

function pickExistingTasks(monthlyId: string): ExistingTask[] {
  // Tasks already linked to this monthly via the enrichment agent's
  // primary_goal_id (or via direct linked_task_id in goals_monthly).
  // We exclude done tasks since those aren't future commitments to duplicate.
  return db.prepare(`
    SELECT DISTINCT t.id, t.title, t.note, t.lane
    FROM tasks t
    LEFT JOIN task_enrichment e ON e.task_id = t.id
    WHERE t.done_at IS NULL
      AND (e.primary_goal_id = :id
           OR t.id IN (SELECT linked_task_id FROM goals_monthly WHERE id = :id AND linked_task_id IS NOT NULL))
  `).all({ id: monthlyId }) as ExistingTask[];
}

// Candidate pool: open tasks NOT already linked to this milestone. Capped
// at 50 by weight desc so the prompt doesn't bloat for users with hundreds
// of tasks. The agent decides which of these (if any) actually ladder to
// the milestone. Anything below 0.3 weight is unlikely to be a real
// contributor — exclude to keep signal high.
function pickCandidateTasks(monthlyId: string): CandidateTask[] {
  return db.prepare(`
    SELECT t.id, t.title, t.project, t.lane, e.theme, e.weight
    FROM tasks t
    LEFT JOIN task_enrichment e ON e.task_id = t.id
    WHERE t.done_at IS NULL
      AND t.lane != 'now'
      AND (e.primary_goal_id IS NULL OR e.primary_goal_id != :id)
      AND (e.weight IS NULL OR e.weight >= 0.3)
    ORDER BY (e.weight IS NULL), e.weight DESC, t.created_at DESC
    LIMIT 50
  `).all({ id: monthlyId }) as CandidateTask[];
}

function daysRemainingInMonth(now: Date): number {
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));
}

export async function runTaskBreakdownAgent(monthlyId: string, signal?: AbortSignal): Promise<TaskBreakdownResult> {
  if (!isTaskBreakdownConfigured()) throw new Error("ANTHROPIC_API_KEY not set");

  const monthly = pickMonthly(monthlyId);
  if (!monthly) throw new Error(`monthly goal ${monthlyId} not found`);

  // Walk up the goal tree. The monthly's parent may be a quarterly OR
  // (in unusual cases) an annual directly — handle both.
  const quarterlyParent = pickQuarterly(monthly.parent);
  const annualParent = quarterlyParent
    ? pickAnnual(quarterlyParent.parent ?? "")
    : pickAnnual(monthly.parent);

  const existingTasks = pickExistingTasks(monthlyId);
  const candidateTasks = pickCandidateTasks(monthlyId);
  const profileContext = getProfileContext();

  const now = new Date();
  const daysLeft = daysRemainingInMonth(now);
  const weeksLeft = Math.max(1, Math.round(daysLeft / 7));

  const existingBlock = existingTasks.length > 0
    ? `\nAlready-linked tasks for this milestone (DO NOT duplicate, DO NOT include in related_existing):\n${existingTasks.map((t) => `- "${t.title}" (lane: ${t.lane})`).join("\n")}`
    : "";

  const candidateBlock = candidateTasks.length > 0
    ? `\nCandidate existing tasks (any that already contribute to this milestone? List their IDs in related_existing. Be conservative — only confident matches):\n${candidateTasks.map((t) => {
        const meta = [t.project, t.theme, t.weight != null ? `weight ${t.weight.toFixed(2)}` : null].filter(Boolean).join(" · ");
        return `- id: ${t.id} — "${t.title}"${meta ? ` [${meta}]` : ""}`;
      }).join("\n")}`
    : "";

  const userMessage = [
    `Today is ${now.toISOString().slice(0, 10)}. The current month has ~${daysLeft} days / ~${weeksLeft} weeks remaining.`,
    ``,
    profileContext
      ? `About the user (standing context):\n${profileContext}\n`
      : null,
    annualParent ? `Annual goal: ${annualParent.title}` : null,
    annualParent?.intent ? `  Intent: ${annualParent.intent}` : null,
    annualParent?.context ? `  Context for this annual goal:\n  ${annualParent.context.replace(/\n/g, "\n  ")}\n` : null,
    quarterlyParent ? `Quarterly milestone: ${quarterlyParent.title}` : null,
    ``,
    `MILESTONE TO BREAK DOWN:`,
    `  Title: ${monthly.title}`,
    monthly.next_step ? `  Next step (user's note): ${monthly.next_step}` : null,
    `  Progress so far: ${Math.round(monthly.progress * 100)}%`,
    existingBlock,
    candidateBlock,
    ``,
    `Two outputs required:`,
    `  1) tasks: 3-7 NEW concrete tasks for this milestone (action-verb-starting, dependency-ordered, scoped to ${daysLeft} days).`,
    `  2) related_existing: array of candidate task ids that already contribute to this milestone (or empty if none).`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
    tools: [TASK_BREAKDOWN_TOOL],
    tool_choice: { type: "tool", name: "return_tasks" },
    messages: [{ role: "user", content: userMessage }],
  }, { signal });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "return_tasks",
  );
  if (!toolUse) throw new Error("agent did not call return_tasks");

  // Defensive parse — same pattern as the goal breakdown agent.
  const rawInput = toolUse.input as Record<string, unknown> | null | undefined;
  let parsed: { tasks?: unknown; related_existing?: unknown } = rawInput ?? {};
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const rawRelated = Array.isArray(parsed.related_existing) ? parsed.related_existing : [];
  if (rawTasks.length === 0 && rawRelated.length === 0) {
    console.warn("[task-breakdown] empty/malformed tool input:", JSON.stringify(rawInput).slice(0, 600));
    throw new Error("agent returned no task proposals or related existing tasks");
  }

  const tasks: TaskProposal[] = (rawTasks as Array<{
    title: string; note: string; estimate_min: number; tag: string; due: string | null; reasoning: string;
  }>).map((t) => ({
    title: String(t.title || "").trim(),
    note: String(t.note || "").trim(),
    estimateMin: typeof t.estimate_min === "number" ? t.estimate_min : 25,
    tag: (VALID_TAGS as readonly string[]).includes(t.tag) ? (t.tag as Tag) : "shallow",
    due: ((VALID_DUES as readonly (string | null)[]).includes(t.due) ? (t.due as Due) : null),
    reasoning: String(t.reasoning || "").trim(),
  })).filter((t) => t.title.length > 0);

  // Resolve related_existing IDs back to the candidate-task data so the
  // modal can show titles/projects/lanes for the user to review. Drop any
  // hallucinated IDs (not in the candidate list) — anti-confabulation.
  const candidateById = new Map(candidateTasks.map((c) => [c.id, c]));
  const relatedExisting: ExistingTaskLink[] = (rawRelated as Array<{ id: string; reasoning: string }>)
    .map((r) => {
      const cand = candidateById.get(String(r.id));
      if (!cand) return null;
      return {
        id: cand.id,
        title: cand.title,
        project: cand.project,
        lane: cand.lane,
        reasoning: String(r.reasoning || "").trim(),
      };
    })
    .filter((x): x is ExistingTaskLink => x !== null);

  return {
    monthly: { id: monthly.id, title: monthly.title },
    parent: {
      quarterly: quarterlyParent ? { id: quarterlyParent.id, title: quarterlyParent.title } : undefined,
      annual:    annualParent    ? { id: annualParent.id,    title: annualParent.title    } : undefined,
    },
    tasks,
    relatedExisting,
  };
}

/* ─── Commit: create the user-selected tasks ──────────────────────────── */

const insertTask = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, lane, big_rock, position, done_at, created_at, updated_at)
  VALUES
    (:id, 'self', NULL, :title, :note, NULL, :tag, :estimate_min, :due, :lane, 0,
     (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = :lane),
     NULL, :now, :now)
`);

// user_linked = 1: both commit paths are explicit user decisions, so the
// enrichment loop must preserve primary_goal_id on these rows (see enrich.ts).
const upsertEnrichment = db.prepare(`
  INSERT INTO task_enrichment (task_id, theme, primary_goal_id, weight, reasoning, hash, enriched_at, user_linked)
  VALUES (:task_id, :theme, :primary_goal_id, :weight, :reasoning, :hash, :enriched_at, 1)
  ON CONFLICT(task_id) DO UPDATE SET
    theme           = excluded.theme,
    primary_goal_id = excluded.primary_goal_id,
    weight          = excluded.weight,
    reasoning       = excluded.reasoning,
    hash            = excluded.hash,
    enriched_at     = excluded.enriched_at,
    user_linked     = 1
`);

export type TaskToCommit = {
  title: string; note: string; estimateMin: number; tag: string; due: string | null;
  reasoning: string;
};

const selectExistingEnrichment = db.prepare(
  "SELECT theme, weight, reasoning FROM task_enrichment WHERE task_id = :task_id"
);

const selectTaskExists = db.prepare("SELECT 1 AS x FROM tasks WHERE id = :id");

export function commitTasksForMilestone(
  monthlyId: string,
  monthlyTitle: string,
  picks: TaskToCommit[],
  linkExistingIds: string[] = [],
): { created: string[]; linked: string[]; skippedLinks: string[] } {
  const now = new Date().toISOString();

  // Re-validate server-side — the proposal round-trips through an editable
  // client, so field shapes/values can't be trusted (same rule as the
  // breakdown/commit endpoint in api/tasks.ts).
  const clean = picks
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .map((t) => ({
      title: String(t.title).trim().slice(0, 500),
      note: typeof t.note === "string" && t.note ? t.note.slice(0, 2000) : null,
      tag: (VALID_TAGS as readonly string[]).includes(t.tag) ? t.tag : "shallow",
      estimate_min: Number.isFinite(t.estimateMin)
        ? Math.max(5, Math.min(120, Math.round(t.estimateMin)))
        : 25,
      due: (VALID_DUES as readonly (string | null)[]).includes(t.due) ? t.due : null,
      reasoning: typeof t.reasoning === "string" ? t.reasoning : "",
    }));

  const created: string[] = [];
  const linked: string[] = [];
  const skippedLinks: string[] = [];

  // One transaction: a failure mid-loop (e.g. an FK violation) must not leave
  // half the picks committed behind a 500.
  runTx(() => {
    for (const t of clean) {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      insertTask.run({
        id,
        title: t.title,
        note: t.note,
        tag: t.tag,
        estimate_min: t.estimate_min,
        due: t.due,
        lane: "this_week",
        now,
      });
      // Pre-populate enrichment so the task shows up in This week ranked
      // correctly from the moment it's created — no need to wait for the
      // 5-min enrichment loop to catch up. Theme = monthly title keeps the
      // milestone-grouped view coherent.
      upsertEnrichment.run({
        task_id: id,
        theme: monthlyTitle,
        primary_goal_id: monthlyId,
        weight: 0.75,             // user-committed, ladders to a goal — high confidence
        reasoning: t.reasoning || `From milestone: ${monthlyTitle}`,
        hash: `seeded-${id}`,     // re-enrichment recomputes theme/weight; user_linked keeps the goal
        enriched_at: now,
      });
      created.push(id);
    }

    // Link existing tasks to this milestone by writing primary_goal_id to
    // their enrichment record (creating one if missing). Preserves theme +
    // weight from any prior enrichment so we don't blow away the agent's
    // earlier classification — only the goal-link is updated. Ids that don't
    // resolve to a real task (stale proposal, hallucination that survived
    // client review) are skipped, not fatal — enrichment has an FK on tasks.
    for (const taskId of linkExistingIds) {
      if (!selectTaskExists.get({ id: taskId })) {
        skippedLinks.push(taskId);
        continue;
      }
      const prior = selectExistingEnrichment.get({ task_id: taskId }) as
        | { theme: string | null; weight: number | null; reasoning: string | null } | undefined;
      upsertEnrichment.run({
        task_id: taskId,
        theme: prior?.theme || monthlyTitle,
        primary_goal_id: monthlyId,
        weight: prior?.weight ?? 0.6,  // keep prior signal; fallback to mid weight
        reasoning: prior?.reasoning || `Linked to milestone: ${monthlyTitle}`,
        hash: `linked-${taskId}-${monthlyId}`,
        enriched_at: now,
      });
      linked.push(taskId);
    }
  });

  return { created, linked, skippedLinks };
}
