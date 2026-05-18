import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { getProfileContext } from "../api/profile.js";

const MODEL = "claude-opus-4-7";

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
  tasks: TaskProposal[];
};

export function isTaskBreakdownConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const TASK_BREAKDOWN_TOOL: Anthropic.Tool = {
  name: "return_tasks",
  description:
    "Return 3 to 7 concrete, action-verb-starting tasks the user could ship in the time remaining for this monthly milestone. Each task should be small enough that 'done' is unambiguous and the user could finish it in one sitting.",
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
    },
    required: ["tasks"],
  },
};

const SYSTEM_PROMPT = `You are the planning brain inside Lighthouse, breaking a monthly goal into concrete actionable tasks.

Your job: take a single monthly milestone and propose 3-7 concrete next-step tasks the user can ship in the time remaining. The user reviews and checks the ones they want to commit.

Principles:
- Action-verb-starting titles. "Draft", "Send", "Set up", "Review", "Write", "Call", "Book". Never "plan to X" or "think about Y".
- Each task should be small enough that 'done' is unambiguous in one sitting. If something would take more than 90 minutes, split it.
- Order matters: propose tasks in dependency order (the thing you have to do first comes first).
- Match the user's actual situation (you have their About-me context + the goal's own context). Don't propose tasks that assume team / budget / tools they don't have.
- Be specific. "Email Maya about Friday demo" beats "follow up on demo." Specificity is what makes tasks actually shippable.
- Avoid corporate filler ("alignment", "synergize", "leverage"). Write the way a thoughtful friend would describe the next step.

If the user has already created tasks for this milestone, DON'T propose duplicates — propose things that complement what's there.

Always call return_tasks exactly once. Do not ask clarifying questions — work with what you have.`;

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

function daysRemainingInMonth(now: Date): number {
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));
}

export async function runTaskBreakdownAgent(monthlyId: string): Promise<TaskBreakdownResult> {
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
  const profileContext = getProfileContext();

  const now = new Date();
  const daysLeft = daysRemainingInMonth(now);
  const weeksLeft = Math.max(1, Math.round(daysLeft / 7));

  const existingBlock = existingTasks.length > 0
    ? `\nAlready-created tasks for this milestone (DO NOT duplicate):\n${existingTasks.map((t) => `- "${t.title}" (lane: ${t.lane})`).join("\n")}`
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
    ``,
    `Propose 3-7 concrete tasks the user could ship in the ${daysLeft} days remaining this month. Action-verb-starting titles, specific scope, dependency-ordered.`,
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
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "return_tasks",
  );
  if (!toolUse) throw new Error("agent did not call return_tasks");

  // Defensive parse — same pattern as the goal breakdown agent.
  const rawInput = toolUse.input as Record<string, unknown> | null | undefined;
  let parsed: { tasks?: unknown } = rawInput ?? {};
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  if (rawTasks.length === 0) {
    console.warn("[task-breakdown] empty/malformed tool input:", JSON.stringify(rawInput).slice(0, 600));
    throw new Error("agent returned no task proposals");
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

  return {
    monthly: { id: monthly.id, title: monthly.title },
    parent: {
      quarterly: quarterlyParent ? { id: quarterlyParent.id, title: quarterlyParent.title } : undefined,
      annual:    annualParent    ? { id: annualParent.id,    title: annualParent.title    } : undefined,
    },
    tasks,
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

const upsertEnrichment = db.prepare(`
  INSERT INTO task_enrichment (task_id, theme, primary_goal_id, weight, reasoning, hash, enriched_at)
  VALUES (:task_id, :theme, :primary_goal_id, :weight, :reasoning, :hash, :enriched_at)
  ON CONFLICT(task_id) DO UPDATE SET
    theme           = excluded.theme,
    primary_goal_id = excluded.primary_goal_id,
    weight          = excluded.weight,
    reasoning       = excluded.reasoning,
    hash            = excluded.hash,
    enriched_at     = excluded.enriched_at
`);

export type TaskToCommit = {
  title: string; note: string; estimateMin: number; tag: string; due: string | null;
  reasoning: string;
};

export function commitTasksForMilestone(
  monthlyId: string,
  monthlyTitle: string,
  picks: TaskToCommit[],
): string[] {
  const now = new Date().toISOString();
  const created: string[] = [];
  for (const t of picks) {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    insertTask.run({
      id,
      title: t.title.slice(0, 500),
      note: t.note ? t.note.slice(0, 2000) : null,
      tag: t.tag,
      estimate_min: t.estimateMin,
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
      hash: `seeded-${id}`,     // marks as "manually seeded" so re-enrichment will recompute
      enriched_at: now,
    });
    created.push(id);
  }
  return created;
}
