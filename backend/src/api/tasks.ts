import { Hono } from "hono";
import { db, nowIso, runTx } from "../db/client.js";
import { runEnrichment } from "../agent/enrich.js";
import { connectorFor } from "../connectors/registry.js";
import { recordSyncError } from "../sync/reconcile.js";

type TaskRow = {
  id: string;
  source: string;
  external_id: string | null;
  title: string;
  note: string | null;
  project: string | null;
  tag: string | null;
  estimate_min: number | null;
  due: string | null;
  lane: string;
  big_rock: number;
  pinned: number;
  position: number;
  url: string | null;
  done_at: string | null;
  theme: string | null;
  primary_goal_id: string | null;
  weight: number | null;
  reasoning: string | null;
};

// Single-user personal app — server-local midnight is what the user means by "today".
// If this ever goes multi-tenant the boundary will need to be per-user TZ.
function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const TODAY_CAP = 3;
const countTodayUndone = db.prepare(
  "SELECT COUNT(*) as n FROM tasks WHERE lane = 'today' AND done_at IS NULL"
);
const selectCurrentLane = db.prepare("SELECT lane, done_at, position FROM tasks WHERE id = :id");

// Returns open tasks plus anything completed today, so a check survives reload
// for the rest of the day before the row falls off. Joins enrichment so the
// UI can group This week by semantic theme + weight. Ordered by user-controlled
// `position` within each lane so drag-reorder persists across reloads.
const selectVisible = db.prepare(`
  SELECT t.id, t.source, t.external_id, t.title, t.note, t.project, t.tag,
         t.estimate_min, t.due, t.lane, t.big_rock, t.pinned, t.position, t.url, t.done_at,
         e.theme, e.primary_goal_id, e.weight, e.reasoning
  FROM tasks t
  LEFT JOIN task_enrichment e ON e.task_id = t.id
  WHERE t.done_at IS NULL OR t.done_at >= :since
  ORDER BY t.lane, t.position
`);

// Append helpers for re-positioning. `maxPosInLane` is used when a task moves
// into a new lane without an explicit index — it just lands at the end.
const maxPosInLane = db.prepare(
  "SELECT COALESCE(MAX(position), 0) AS m FROM tasks WHERE lane = :lane AND done_at IS NULL"
);
const selectOpenIdsInLane = db.prepare(
  "SELECT id FROM tasks WHERE lane = :lane AND done_at IS NULL ORDER BY position, id"
);
const setPositionStmt = db.prepare("UPDATE tasks SET position = :pos WHERE id = :id");

/** Renumber every open task in a lane to 1, 2, 3, … preserving current order
 * but optionally moving a specific id to `targetIndex` (0-based). Idempotent
 * and cheap — < 200 rows per lane in practice. */
function renumberLane(lane: string, moveId?: string, targetIndex?: number): void {
  const ids = (selectOpenIdsInLane.all({ lane }) as { id: string }[]).map((r) => r.id);
  if (moveId && typeof targetIndex === "number") {
    const without = ids.filter((id) => id !== moveId);
    const clamped = Math.max(0, Math.min(targetIndex, without.length));
    without.splice(clamped, 0, moveId);
    without.forEach((id, i) => setPositionStmt.run({ id, pos: i + 1 }));
  } else {
    ids.forEach((id, i) => setPositionStmt.run({ id, pos: i + 1 }));
  }
}

// Move any currently-Now task back to Today, bypassing the cap (we're inside
// the same tx that's about to free a Today slot, so net Today count is
// unchanged). Used to enforce Now-as-singleton.
const demoteCurrentNow = db.prepare(
  "UPDATE tasks SET lane = 'today' WHERE lane = 'now' AND done_at IS NULL"
);

const selectTaskForLog = db.prepare(`
  SELECT id, source, external_id, estimate_min, done_at FROM tasks WHERE id = :id
`);

const selectTaskForWriteback = db.prepare(`
  SELECT source, external_id FROM tasks WHERE id = :id
`);

/**
 * Fire-and-forget two-way sync: tell the source system the task is done /
 * reopened. Errors are logged + recorded in sync_state (visible in Settings)
 * but never block the local PATCH response — local truth still wins.
 */
function pushDoneToSource(taskId: string, done: boolean): void {
  const row = selectTaskForWriteback.get({ id: taskId }) as
    | { source: string; external_id: string | null }
    | undefined;
  if (!row || !row.external_id) return; // self-captured task; nothing upstream
  const connector = connectorFor(row.source);
  if (!connector?.setDone) return; // source is read-only (gcal/gmail/linear/etc.)
  void connector.setDone(row.external_id, done).catch((err) => {
    console.warn(`[writeback] ${row.source} setDone failed for ${taskId}: ${String(err)}`);
    recordSyncError(row.source, `setDone(${row.external_id}, ${done}): ${String(err)}`);
  });
}

const insertCompletion = db.prepare(`
  INSERT INTO completions_log (task_id, done_at, source, est_min)
  VALUES (:task_id, :done_at, :source, :est_min)
`);

function rowToWire(r: TaskRow) {
  return {
    id: r.id,
    lane: r.lane,
    title: r.title,
    note: r.note ?? undefined,
    source: r.source,
    project: r.project ?? undefined,
    tag: r.tag ?? undefined,
    estimate: r.estimate_min ?? undefined,
    due: r.due ?? undefined,
    bigRock: r.big_rock === 1 ? true : undefined,
    pinned:  r.pinned === 1 ? true : undefined,
    position: r.position,
    url: r.url ?? undefined,
    doneAt: r.done_at ?? undefined,
    theme: r.theme ?? undefined,
    primaryGoalId: r.primary_goal_id ?? undefined,
    weight: r.weight ?? undefined,
    reasoning: r.reasoning ?? undefined,
  };
}

export const tasksApi = new Hono();

tasksApi.get("/", (c) => {
  const rows = selectVisible.all({ since: startOfTodayIso() }) as TaskRow[];
  return c.json(rows.map(rowToWire));
});

// Force a re-enrichment pass. The background loop runs every 5 min, so this
// is only needed for an immediate refresh — e.g. after editing goals or
// kicking a manual sync.
tasksApi.post("/reenrich", async (c) => {
  // ?force=true → reclassify every open task, bypassing the content-hash
  // staleness check. Useful after prompt edits since the hash alone won't
  // detect that the prompt changed under fixed input.
  const force = c.req.query("force") === "true";
  try {
    const result = await runEnrichment(force);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Whitelist of mutable columns. Anything outside this is ignored.
const FIELD_SQL: Record<string, string> = {
  lane: "lane = :lane",
  big_rock: "big_rock = :big_rock",
  pinned: "pinned = :pinned",
};

const VALID_LANES = new Set(["now", "today", "this_week", "this_month", "backlog"]);

tasksApi.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  // Validate lane synchronously before opening a transaction.
  if (typeof body.lane === "string" && !VALID_LANES.has(body.lane)) {
    return c.json({ error: `invalid lane: ${body.lane}` }, 400);
  }
  if (body.index != null && (!Number.isFinite(body.index) || body.index < 0)) {
    return c.json({ error: "index must be a non-negative integer" }, 400);
  }

  let notFound = false;
  let capFull: number | null = null;
  let nowGateError: string | null = null;
  let shouldLogCompletion = false;
  // Captures the done-state transition (true=just-done, false=just-reopened,
  // null=no change). Fires source write-back AFTER the tx commits.
  let doneTransition: boolean | null = null;

  // One IMMEDIATE-mode transaction: prior-state read + gates + UPDATE +
  // renumber. Required so concurrent lane→today PATCHes can't both see
  // count=2, and so the Now displacement is atomic.
  runTx(() => {
    const prior = selectCurrentLane.get({ id }) as
      | { lane: string; done_at: string | null; position: number }
      | undefined;
    if (!prior) { notFound = true; return; }

    const setters: string[] = [];
    const params: Record<string, unknown> = { id };
    let newLane: string | null = null;

    if (body.done === true) {
      setters.push("done_at = :done_at");
      params.done_at = nowIso();
    } else if (body.done === false) {
      setters.push("done_at = NULL");
    }
    if (typeof body.lane === "string") {
      newLane = body.lane;
      // Now⊂Today gate: a task can only be promoted to Now from Today.
      // Singleton: any existing Now-task gets bumped back to Today first,
      // bypassing the cap (the new task is about to leave Today, so net
      // Today count is preserved). Re-PATCHing to the same lane is a no-op
      // for the gate — useful for position-only updates.
      if (newLane === "now" && prior.lane !== "now") {
        if (prior.lane !== "today") {
          nowGateError = `Cannot move to Now from "${prior.lane}". Promote to Today first.`;
          return;
        }
        demoteCurrentNow.run();
      } else if (newLane === "today" && prior.lane !== "today" && prior.lane !== "now") {
        // Standard 3-cap on Today. Exempt: (a) auto-demote during the Now
        // swap above, (b) explicit "Step away" (now→today) — the task was
        // already in Today before being promoted, so let it return even if
        // Today filled up in the meantime.
        const { n } = countTodayUndone.get() as { n: number };
        if (n >= TODAY_CAP) { capFull = n; return; }
      }
      setters.push(FIELD_SQL.lane);
      params.lane = newLane;
      // Pin only has meaning for "queued up in this week's plan." If the
      // task leaves this_week (promoted to today/now, or demoted out), the
      // pin's intent has been honored or expired — clear it so we don't
      // leave invisible pinned data in lanes where the pin UI isn't shown.
      // Same rule the decay job uses for this_week → this_month transitions.
      if (newLane !== "this_week" && body.pinned === undefined) {
        setters.push(FIELD_SQL.pinned);
        params.pinned = 0;
      }
    }
    if (typeof body.bigRock === "boolean") {
      setters.push(FIELD_SQL.big_rock);
      params.big_rock = body.bigRock ? 1 : 0;
    }
    if (typeof body.pinned === "boolean") {
      setters.push(FIELD_SQL.pinned);
      params.pinned = body.pinned ? 1 : 0;
    }

    const targetLane = newLane ?? prior.lane;
    const explicitIndex: number | null =
      body.index != null ? Math.floor(body.index) : null;

    if (newLane && newLane !== prior.lane && explicitIndex === null) {
      // Lane change without an explicit index: append to end of new lane.
      const { m } = maxPosInLane.get({ lane: newLane }) as { m: number };
      setters.push("position = :position");
      params.position = m + 1;
    } else if (explicitIndex !== null) {
      // Caller-driven reorder. We set a temporary position, then renumber
      // the whole lane below so 1..N is gap-free.
      setters.push("position = :position");
      params.position = explicitIndex + 0.5; // wedge it; renumberLane finalizes
    }

    if (setters.length === 0) return;

    setters.push("updated_at = :updated_at");
    params.updated_at = nowIso();
    const sql = `UPDATE tasks SET ${setters.join(", ")} WHERE id = :id`;
    const result = db.prepare(sql).run(params);
    if (result.changes === 0) { notFound = true; return; }

    // Position bookkeeping — close gaps in the source lane (if we left it),
    // and renumber the target lane so 1..N is contiguous. Skip the target
    // renumber when neither lane nor index changed (pure done-toggle, big_rock
    // edit) — those don't shift any positions.
    if (newLane && newLane !== prior.lane) {
      renumberLane(prior.lane);
      renumberLane(targetLane); // target gained a row at end; tighten just in case
    }
    if (explicitIndex !== null) {
      renumberLane(targetLane, id, explicitIndex);
    }

    if (body.done === true && prior.done_at === null) {
      const row = selectTaskForLog.get({ id }) as
        | { id: string; source: string; external_id: string | null; estimate_min: number | null; done_at: string | null }
        | undefined;
      if (row?.done_at) {
        insertCompletion.run({
          task_id: row.id,
          done_at: row.done_at,
          source: row.source,
          est_min: row.estimate_min,
        });
        shouldLogCompletion = true;
      }
      doneTransition = true;

      // Auto-advance Now: finishing the focus task should immediately tee
      // up the next Today task — that's the rhythm of a focus session. The
      // just-done task moves back to Today's lane (where it shows as a done
      // row until midnight, then falls off), and the highest-position open
      // Today task becomes the new Now. If Today is empty, Now stays empty
      // and the FocusCard renders its empty state.
      //
      // Position note: we explicitly push the done-task to MAX(position)+1
      // in the target lane so it sinks below the open rows — otherwise it
      // keeps its now-lane position (typically 1) and visually outranks the
      // freshly-renumbered open tasks that also start at 1.
      if (prior.lane === "now") {
        db.prepare(`
          UPDATE tasks SET
            lane = 'today',
            position = (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = 'today')
          WHERE id = :id
        `).run({ id });
        const next = db.prepare(`
          SELECT id FROM tasks
          WHERE lane = 'today' AND done_at IS NULL AND id != :id
          ORDER BY position, id
          LIMIT 1
        `).get({ id }) as { id: string } | undefined;
        if (next) {
          db.prepare("UPDATE tasks SET lane = 'now' WHERE id = :id").run({ id: next.id });
        }
        renumberLane("today");
        renumberLane("now");
      }
    } else if (body.done === false && prior.done_at !== null) {
      doneTransition = false;
    }
  });

  if (notFound) return c.json({ error: "not found" }, 404);
  if (nowGateError) return c.json({ error: "now_gate", message: nowGateError }, 409);
  if (capFull !== null) {
    return c.json(
      { error: "today_full", message: `Today already has ${TODAY_CAP} tasks. Move one to This week first.`, todayCount: capFull },
      409
    );
  }
  void shouldLogCompletion;

  // Two-way sync — runs outside the tx (and outside the response cycle) so
  // a slow/failing source API never blocks the user's UI. See pushDoneToSource
  // for error handling.
  if (doneTransition !== null) pushDoneToSource(id, doneTransition);

  return c.json({ ok: true });
});
