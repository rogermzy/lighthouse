import { Hono } from "hono";
import type { Context } from "hono";
import type { SQLInputValue } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { db, runTx } from "../db/client.js";
import { runBreakdownAgent, isBreakdownConfigured } from "../agent/breakdown.js";
import {
  runTaskBreakdownAgent,
  isTaskBreakdownConfigured,
  commitTasksForMilestone,
} from "../agent/task-breakdown.js";

type AnnualRow = {
  id: string; title: string; color: string | null; intent: string | null;
  context: string | null;
  target: string | null; progress: number; trend: string | null;
};
type QuarterlyRow = {
  id: string; parent: string | null; title: string;
  progress: number; weeks_left: number | null;
};
type MonthlyRow = {
  id: string; parent: string; title: string;
  progress: number; next_step: string | null; linked_task_id: string | null;
};

const selectAnnual    = db.prepare("SELECT * FROM goals_annual ORDER BY id");
const selectQuarterly = db.prepare("SELECT * FROM goals_quarterly ORDER BY id");
const selectMonthly   = db.prepare("SELECT * FROM goals_monthly ORDER BY id");

export const goalsApi = new Hono();

goalsApi.get("/", (c) => {
  const annual = selectAnnual.all() as AnnualRow[];
  const quarterly = selectQuarterly.all() as QuarterlyRow[];
  const monthly = selectMonthly.all() as MonthlyRow[];

  return c.json({
    year: "2026",
    quarter: "Q2",
    month: "May",
    annual,
    quarterly: quarterly.map((q) => ({
      id: q.id, parent: q.parent, title: q.title,
      progress: q.progress, weeksLeft: q.weeks_left,
    })),
    monthly: monthly.map((m) => ({
      id: m.id, parent: m.parent, title: m.title,
      progress: m.progress, nextStep: m.next_step, linkedTaskId: m.linked_task_id,
    })),
  });
});

// ─── editor surface (PATCH / POST / DELETE) ───────────────────────────────
//
// Whitelist per horizon, snake-cased column name → accepted camelCase key.
// Anything outside the allowlist is silently ignored.
const ALLOWED: Record<string, Record<string, string>> = {
  annual: {
    title: "title",
    color: "color",
    intent: "intent",
    context: "context",
    target: "target",
    progress: "progress",
    trend: "trend",
  },
  quarterly: {
    title: "title",
    parent: "parent",
    progress: "progress",
    weeksLeft: "weeks_left",
  },
  monthly: {
    title: "title",
    parent: "parent",
    progress: "progress",
    nextStep: "next_step",
    linkedTaskId: "linked_task_id",
  },
};

const TABLE: Record<string, string> = {
  annual: "goals_annual",
  quarterly: "goals_quarterly",
  monthly: "goals_monthly",
};

const VALID_TRENDS = new Set(["on-track", "ahead", "behind"]);

function validateProgress(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0 || v > 1) return null;
  return v;
}

goalsApi.patch("/:horizon/:id", async (c) => {
  const horizon = c.req.param("horizon");
  const id = c.req.param("id");
  if (!TABLE[horizon]) return c.json({ error: "invalid horizon" }, 400);
  const allow = ALLOWED[horizon];

  const body = await c.req.json().catch(() => ({}));
  const setters: string[] = [];
  const params: Record<string, SQLInputValue> = { id };

  for (const [camelKey, val] of Object.entries(body)) {
    const col = allow[camelKey];
    if (!col) continue;
    if (camelKey === "progress") {
      const p = validateProgress(val);
      if (p === null) return c.json({ error: "progress must be 0–1" }, 400);
      setters.push(`${col} = :${col}`);
      params[col] = p;
    } else if (camelKey === "trend") {
      if (val !== null && !VALID_TRENDS.has(String(val))) {
        return c.json({ error: `invalid trend: ${val}` }, 400);
      }
      // val is unknown from JSON.parse, but the guard above proves it's
      // either null or a string in VALID_TRENDS — both are SQLInputValue.
      setters.push(`${col} = :${col}`);
      params[col] = val as string | null;
    } else {
      setters.push(`${col} = :${col}`);
      params[col] = val == null ? null : String(val);
    }
  }

  if (setters.length === 0) return c.json({ ok: true, noop: true });

  const sql = `UPDATE ${TABLE[horizon]} SET ${setters.join(", ")} WHERE id = :id`;
  const result = db.prepare(sql).run(params);
  if (result.changes === 0) return c.json({ error: "not found" }, 404);

  return c.json({ ok: true });
});

const DEFAULT_TITLE: Record<string, string> = {
  annual:    "New annual goal",
  quarterly: "New quarterly goal",
  monthly:   "New monthly goal",
};

goalsApi.post("/:horizon", async (c) => {
  const horizon = c.req.param("horizon");
  if (!TABLE[horizon]) return c.json({ error: "invalid horizon" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const id = `${horizon[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim()
    : DEFAULT_TITLE[horizon];

  if (horizon === "annual") {
    db.prepare(`
      INSERT INTO goals_annual (id, title, color, intent, context, target, progress, trend)
      VALUES (:id, :title, :color, NULL, NULL, NULL, 0, 'on-track')
    `).run({ id, title, color: typeof body.color === "string" ? body.color : "#5e6ad2" });
    return c.json({ id, title, color: body.color ?? "#5e6ad2", intent: null, context: null, target: null, progress: 0, trend: "on-track" }, 201);
  }

  if (horizon === "quarterly") {
    // default parent = first annual goal, if any
    const firstAnnual = (db.prepare("SELECT id FROM goals_annual ORDER BY id LIMIT 1").get() as { id: string } | undefined)?.id ?? null;
    const parent = typeof body.parent === "string" ? body.parent : firstAnnual;
    db.prepare(`
      INSERT INTO goals_quarterly (id, parent, title, progress, weeks_left)
      VALUES (:id, :parent, :title, 0, :weeks_left)
    `).run({ id, parent, title, weeks_left: typeof body.weeksLeft === "number" ? body.weeksLeft : null });
    return c.json({ id, parent, title, progress: 0, weeksLeft: body.weeksLeft ?? null }, 201);
  }

  // monthly
  // default parent = first quarterly, fall back to first annual
  const firstQuarterly = (db.prepare("SELECT id FROM goals_quarterly ORDER BY id LIMIT 1").get() as { id: string } | undefined)?.id;
  const firstAnnual = (db.prepare("SELECT id FROM goals_annual ORDER BY id LIMIT 1").get() as { id: string } | undefined)?.id;
  const parent = typeof body.parent === "string" ? body.parent : (firstQuarterly ?? firstAnnual ?? "");
  if (!parent) return c.json({ error: "no parent available; create an annual goal first" }, 400);
  db.prepare(`
    INSERT INTO goals_monthly (id, parent, title, progress, next_step, linked_task_id)
    VALUES (:id, :parent, :title, 0, :next_step, NULL)
  `).run({ id, parent, title, next_step: typeof body.nextStep === "string" ? body.nextStep : null });
  return c.json({ id, parent, title, progress: 0, nextStep: body.nextStep ?? null, linkedTaskId: null }, 201);
});

// Run the breakdown agent for a specific annual goal. Returns proposals only —
// commitment happens via the existing POST /:horizon endpoints once the user
// picks which milestones they want.
goalsApi.post("/annual/:id/breakdown", async (c) => {
  if (!isBreakdownConfigured()) {
    return c.json(
      { error: "breakdown agent disabled — set ANTHROPIC_API_KEY" },
      503,
    );
  }
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const refinement =
    typeof body.refinement === "string" && body.refinement.trim()
      ? body.refinement.trim()
      : undefined;

  try {
    const result = await runBreakdownAgent(id, refinement, c.req.raw.signal);
    return c.json(result);
  } catch (err) {
    return breakdownErrorResponse(c, err);
  }
});

// Shared typed-error branches for the two goal-breakdown agent routes.
// Mirrors plan-day.ts / tasks.ts: the abort subclass MUST be checked before
// the generic APIError or client cancellations get misreported as 502s.
function breakdownErrorResponse(c: Context, err: unknown) {
  if (err instanceof Anthropic.APIUserAbortError) {
    return new Response(JSON.stringify({ error: "aborted" }), {
      status: 499,
      headers: { "content-type": "application/json" },
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return c.json({ error: "rate limited", detail: err.message }, 429);
  }
  if (err instanceof Anthropic.APIError) {
    return c.json({ error: "anthropic api error", detail: err.message }, 502);
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("not found")) return c.json({ error: message }, 404);
  if (message.includes("ANTHROPIC_API_KEY")) return c.json({ error: message }, 503);
  return c.json({ error: "breakdown failed", detail: message }, 500);
}

// Run the task-breakdown agent for a single monthly milestone. Returns
// 3-7 proposed tasks the user can review + commit (separate endpoint).
goalsApi.post("/monthly/:id/break-into-tasks", async (c) => {
  if (!isTaskBreakdownConfigured()) {
    return c.json({ error: "task-breakdown agent disabled — set ANTHROPIC_API_KEY" }, 503);
  }
  const id = c.req.param("id");
  try {
    const result = await runTaskBreakdownAgent(id, c.req.raw.signal);
    return c.json(result);
  } catch (err) {
    return breakdownErrorResponse(c, err);
  }
});

// Commit a user-selected subset of the proposed tasks. Creates tasks atomically
// with pre-populated enrichment rows so they show up correctly ranked + linked
// to the milestone from the moment they're created (no waiting on the 5-min
// enrichment loop).
goalsApi.post("/monthly/:id/commit-tasks", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const tasks = Array.isArray(body.tasks) ? body.tasks : [];
  const linkExistingIds = Array.isArray(body.linkExistingIds) ? body.linkExistingIds.filter((x: unknown) => typeof x === "string") : [];
  if (tasks.length === 0 && linkExistingIds.length === 0) {
    return c.json({ error: "nothing to commit — no new tasks and no existing links" }, 400);
  }

  const monthlyRow = db.prepare("SELECT id, title FROM goals_monthly WHERE id = :id").get({ id }) as
    | { id: string; title: string } | undefined;
  if (!monthlyRow) return c.json({ error: "monthly goal not found" }, 404);

  try {
    const result = commitTasksForMilestone(id, monthlyRow.title, tasks, linkExistingIds);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: "commit failed", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

goalsApi.delete("/:horizon/:id", (c) => {
  const horizon = c.req.param("horizon");
  const id = c.req.param("id");
  if (!TABLE[horizon]) return c.json({ error: "invalid horizon" }, 400);

  try {
    // Annual goals are referenced by goals_quarterly.parent with a FK that
    // defaults to RESTRICT — straight DELETE would fail. Null the parent on
    // each child first so the children survive as "unparented" and can be
    // re-assigned in a follow-up edit. (Monthly goals don't have a FK on
    // their parent column, so they only become dangling-string orphans —
    // the GoalsPage render handles that gracefully.)
    // One transaction: a missing id must not leave children unparented by a
    // DELETE that then matched nothing.
    runTx(() => {
      if (horizon === "annual") {
        db.prepare("UPDATE goals_quarterly SET parent = NULL WHERE parent = :id").run({ id });
      }
      const result = db.prepare(`DELETE FROM ${TABLE[horizon]} WHERE id = :id`).run({ id });
      if (result.changes === 0) throw new Error("__not_found__");
    });
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "__not_found__") {
      return c.json({ error: "not found" }, 404);
    }
    return c.json({ error: "delete failed", detail: String(err) }, 500);
  }
});
