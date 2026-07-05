/**
 * Task enrichment agent.
 *
 * Reads on-deck tasks + the goals tree, asks Claude to assign each task a
 * semantic theme, a primary goal it ladders to, and a 0-1 weight for
 * importance. Results are cached by a content hash so re-syncs that don't
 * change the task body are free.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { db, nowIso } from "../db/client.js";
import { MODEL, isAgentConfigured } from "./config.js";

const BATCH_SIZE = 20;

type TaskForEnrichment = {
  id: string;
  title: string;
  project: string | null;
  note: string | null;
  source: string;
  due: string | null;
};

type Goal = { id: string; title: string; horizon: "annual" | "quarterly" | "monthly" };

type EnrichmentResult = {
  task_id: string;
  theme: string;
  primary_goal_id: string | null;
  weight: number;
  reasoning: string;
};

export const isEnrichmentConfigured = isAgentConfigured;

function loadGoals(): Goal[] {
  const annual = db.prepare("SELECT id, title FROM goals_annual ORDER BY id").all() as { id: string; title: string }[];
  const quarterly = db.prepare("SELECT id, title FROM goals_quarterly ORDER BY id").all() as { id: string; title: string }[];
  const monthly = db.prepare("SELECT id, title FROM goals_monthly ORDER BY id").all() as { id: string; title: string }[];
  return [
    ...annual.map((g) => ({ ...g, horizon: "annual" as const })),
    ...quarterly.map((g) => ({ ...g, horizon: "quarterly" as const })),
    ...monthly.map((g) => ({ ...g, horizon: "monthly" as const })),
  ];
}

function goalsSignature(goals: Goal[]): string {
  // Any goal title or id change shifts this — and that invalidates every
  // cached enrichment, which is what we want.
  const sig = goals.map((g) => `${g.horizon}:${g.id}:${g.title}`).join("|");
  return createHash("sha1").update(sig).digest("hex").slice(0, 12);
}

function taskHash(t: TaskForEnrichment, goalsSig: string): string {
  // `due` is part of the classification prompt, so a due-date change must
  // invalidate the cache like any other input change.
  const key = `${t.title}|${t.project ?? ""}|${t.note ?? ""}|${t.due ?? ""}|${goalsSig}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

// When the enrichment prompt itself changes (not just the input data),
// existing rows look "fresh" by content hash but were actually classified
// by the old prompt. loadAllOpenTasks bypasses the hash check so a manual
// re-rank pass can reclassify everything under the current prompt.
function loadAllOpenTasks(): TaskForEnrichment[] {
  const rows = db.prepare(`
    SELECT t.id, t.title, t.project, t.note, t.source, t.due
    FROM tasks t
    WHERE t.done_at IS NULL
  `).all() as TaskForEnrichment[];
  return rows;
}

function loadStaleTasks(goalsSig: string): TaskForEnrichment[] {
  // Pull undone tasks from every lane — focus/today/ondeck/someday. The UI
  // currently only groups OnDeck, but enriching the full pool is cheap and
  // future-proofs Focus/Today views.
  const rows = db.prepare(`
    SELECT t.id, t.title, t.project, t.note, t.source, t.due,
           e.hash AS prior_hash
    FROM tasks t
    LEFT JOIN task_enrichment e ON e.task_id = t.id
    WHERE t.done_at IS NULL
  `).all() as (TaskForEnrichment & { prior_hash: string | null })[];

  return rows.filter((r) => {
    const want = taskHash(r, goalsSig);
    return r.prior_hash !== want;
  });
}

// user_linked rows keep their goal link: the user explicitly tied the task to
// a milestone (commitTasksForMilestone), and a human decision outranks the
// classifier — which is prompted to default toward null. Theme/weight still
// refresh, and the hash update stops the row from re-reading as stale forever.
const upsertEnrichment = db.prepare(`
  INSERT INTO task_enrichment (task_id, theme, primary_goal_id, weight, reasoning, hash, enriched_at)
  VALUES (:task_id, :theme, :primary_goal_id, :weight, :reasoning, :hash, :enriched_at)
  ON CONFLICT(task_id) DO UPDATE SET
    theme = excluded.theme,
    primary_goal_id = CASE WHEN user_linked = 1 THEN primary_goal_id ELSE excluded.primary_goal_id END,
    weight = excluded.weight,
    reasoning = CASE WHEN user_linked = 1 THEN reasoning ELSE excluded.reasoning END,
    hash = excluded.hash,
    enriched_at = excluded.enriched_at
`);

function buildSystemPrompt(goals: Goal[]): string {
  const goalLines = goals.map((g) => `  [${g.id}] (${g.horizon}) ${g.title}`).join("\n") || "  (no goals defined)";
  return `You triage a personal task list for an ADHD-friendly dashboard. The user has these goals across three horizons:

${goalLines}

For each task you receive, return:
- theme: a short semantic cluster label (2-4 words, Title Case). Examples: "Baby Tree SEO", "Eon Client Comms", "Personal Errands", "Lighthouse Build", "Email Triage". Cluster by what the task is ABOUT, not where it came from. Use the SAME theme string across tasks in the same cluster.
- primary_goal_id: the goal id (e.g. "a1", "q2", "m3") this task DIRECTLY contributes to, or null. Be conservative — default to null unless completing this task would visibly move a specific goal forward. Housekeeping, comms, admin, ambient maintenance, and "plausibly related" work should be null. Prefer the most specific horizon (monthly > quarterly > annual) when a real ladder exists. False positives clutter the milestone view, so erring on null is the right tradeoff.
- weight: 0.0 to 1.0. Use the full range honestly.
  * 0.8-1.0 = direct, concrete next step on a goal
  * 0.5-0.8 = supports a goal but indirect
  * 0.2-0.5 = housekeeping, comms, low-leverage
  * 0.0-0.2 = noise / nice-to-have / probably defer
- reasoning: ≤ 15 words explaining the weight.

Be honest. Many synced tasks (auto-imported emails, calendar holds, low-priority ClickUp items) deserve 0.1-0.3. The user needs sharp signal, not flattery.`;
}

const ENRICHMENT_TOOL: Anthropic.Tool = {
  name: "return_enrichments",
  description: "Return one enrichment entry per task you were given.",
  input_schema: {
    type: "object",
    properties: {
      enrichments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            theme: { type: "string" },
            primary_goal_id: { type: ["string", "null"] },
            weight: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string" },
          },
          required: ["task_id", "theme", "primary_goal_id", "weight", "reasoning"],
        },
      },
    },
    required: ["enrichments"],
  },
};

async function enrichBatch(
  client: Anthropic,
  systemPrompt: string,
  batch: TaskForEnrichment[],
): Promise<EnrichmentResult[]> {
  const taskBlock = batch
    .map((t) => `- id: ${t.id}\n  title: ${t.title}\n  source: ${t.source}${t.project ? `\n  project: ${t.project}` : ""}${t.due ? `\n  due: ${t.due}` : ""}${t.note ? `\n  note: ${t.note.slice(0, 200)}` : ""}`)
    .join("\n\n");

  // Forced tool use is incompatible with thinking — skip thinking here.
  // Classification is straightforward enough that this is a fine trade.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [ENRICHMENT_TOOL],
    tool_choice: { type: "tool", name: "return_enrichments" },
    messages: [{ role: "user", content: `Classify these ${batch.length} tasks:\n\n${taskBlock}` }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "return_enrichments",
  );
  if (!toolUse) {
    throw new Error(`enrich: model did not call return_enrichments (stop=${response.stop_reason})`);
  }

  const input = (toolUse.input ?? {}) as { enrichments?: EnrichmentResult[] };
  return input.enrichments ?? [];
}

let runningPromise: Promise<{ enriched: number; skipped: number }> | null = null;

/**
 * Enrich all stale on-deck tasks. Idempotent — re-running with no changes
 * is a no-op (returns enriched=0). Coalesces concurrent invocations.
 */
export async function runEnrichment(force = false): Promise<{ enriched: number; skipped: number }> {
  if (!isEnrichmentConfigured()) return { enriched: 0, skipped: 0 };
  // A forced re-rank must not coalesce into an in-flight normal run (which
  // would skip the hash bypass and silently no-op) — queue it behind instead.
  if (runningPromise) {
    if (!force) return runningPromise;
    return runningPromise.then(() => runEnrichment(true));
  }

  runningPromise = (async () => {
    try {
      const goals = loadGoals();
      const goalsSig = goalsSignature(goals);
      // force=true bypasses the content-hash check, treating every open
      // task as stale. Used by manual "re-rank" after a prompt change.
      const stale = force ? loadAllOpenTasks() : loadStaleTasks(goalsSig);
      if (stale.length === 0) return { enriched: 0, skipped: 0 };

      const client = new Anthropic();
      const systemPrompt = buildSystemPrompt(goals);

      let enriched = 0;
      const validGoalIds = new Set(goals.map((g) => g.id));

      for (let i = 0; i < stale.length; i += BATCH_SIZE) {
        const batch = stale.slice(i, i + BATCH_SIZE);
        const results = await enrichBatch(client, systemPrompt, batch);

        // Index results by task_id so we can match even if the model reorders.
        const byId = new Map(results.map((r) => [r.task_id, r]));
        const now = nowIso();

        for (const task of batch) {
          const r = byId.get(task.id);
          if (!r) continue; // model skipped this one; will retry next tick
          const goalId = r.primary_goal_id && validGoalIds.has(r.primary_goal_id) ? r.primary_goal_id : null;
          // The schema is a hint, not a contract: a non-numeric weight would
          // become NaN → NULL, violating NOT NULL and aborting the whole batch
          // on every tick. Default mid-low instead.
          const weight = Number.isFinite(r.weight) ? Math.max(0, Math.min(1, r.weight)) : 0.3;
          upsertEnrichment.run({
            task_id: task.id,
            theme: r.theme || "Misc",
            primary_goal_id: goalId,
            weight,
            reasoning: r.reasoning ?? "",
            hash: taskHash(task, goalsSig),
            enriched_at: now,
          });
          enriched++;
        }
      }

      console.log(`[enrich] enriched=${enriched} stale=${stale.length}`);
      return { enriched, skipped: stale.length - enriched };
    } finally {
      runningPromise = null;
    }
  })();

  return runningPromise;
}

const ENRICH_INTERVAL_MS = 5 * 60 * 1000;

/** Background loop. First pass after a 10s delay (lets the first sync finish). */
export function startEnrichmentLoop(): void {
  if (!isEnrichmentConfigured()) {
    console.log("[enrich] disabled — no ANTHROPIC_API_KEY");
    return;
  }
  const tick = async () => {
    try {
      await runEnrichment();
    } catch (err) {
      console.warn(`[enrich] error — ${String(err)}`);
    } finally {
      setTimeout(tick, ENRICH_INTERVAL_MS);
    }
  };
  setTimeout(tick, 10_000);
}
