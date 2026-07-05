import { db, nowIso, runTx } from "../db/client.js";
import type { CalendarEventWire, InboxItemWire, UnifiedTask } from "../connectors/types.js";

const deleteAllEvents = db.prepare("DELETE FROM calendar_events");

const insertEvent = db.prepare(`
  INSERT INTO calendar_events (id, date, title, start_min, end_min, kind, color)
  VALUES (:id, :date, :title, :start_min, :end_min, :kind, :color)
`);

const upsertInbox = db.prepare(`
  INSERT INTO inbox_items (id, source, external_id, title, triaged_to, created_at)
  VALUES (:id, :source, :external_id, :title, NULL, :created_at)
  ON CONFLICT(source, external_id) DO UPDATE SET title = excluded.title
`);

const markSync = db.prepare(`
  INSERT INTO sync_state (source, last_pulled_at, last_error, cursor)
  VALUES (:source, :last_pulled_at, NULL, NULL)
  ON CONFLICT(source) DO UPDATE SET
    last_pulled_at = excluded.last_pulled_at,
    last_error = NULL
`);

const markSyncError = db.prepare(`
  INSERT INTO sync_state (source, last_pulled_at, last_error, cursor)
  VALUES (:source, NULL, :last_error, NULL)
  ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error
`);

// Roger-owned fields (lane, big_rock, tag, position) are NEVER overwritten by
// a pull. Source-owned fields (title, note, project, estimate_min, due, url)
// are refreshed on every tick. New rows land at the bottom of This month
// (max(position) + 1) — the user explicitly triages from there into This
// week / Today, or lets decay push them to Backlog.
//
// done_at is a special case: sync may SET it when the source reports the task
// complete (so a task finished in ClickUp shows as done here too), but it
// NEVER clears one that's already set — COALESCE(done_at, excluded.done_at)
// keeps a local completion and won't let a source "reopen" resurrect a task
// the user already checked off. :done_at is the source's completion time
// (ISO) or NULL when the source still considers the task open.
//
// updated_at only bumps when a source-owned field actually changed. An
// unconditional bump would mark every synced task "touched" each 5-min tick,
// making lane decay (which keys off updated_at) a permanent no-op for synced
// sources. Unqualified columns are the pre-update row; IS NOT is null-safe.
const upsertTaskFromSource = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, url, lane, big_rock, position, done_at, created_at, updated_at)
  VALUES
    (:id, :source, :external_id, :title, :note, :project, NULL, :estimate_min, :due, :url, 'this_month', 0,
     (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = 'this_month'),
     :done_at, :now, :now)
  ON CONFLICT(source, external_id) DO UPDATE SET
    title        = excluded.title,
    note         = excluded.note,
    project      = excluded.project,
    estimate_min = excluded.estimate_min,
    due          = excluded.due,
    url          = excluded.url,
    done_at      = COALESCE(done_at, excluded.done_at),
    updated_at   = CASE
      WHEN title IS NOT excluded.title
        OR note IS NOT excluded.note
        OR project IS NOT excluded.project
        OR estimate_min IS NOT excluded.estimate_min
        OR due IS NOT excluded.due
        OR url IS NOT excluded.url
        OR done_at IS NOT COALESCE(done_at, excluded.done_at)
      THEN excluded.updated_at
      ELSE updated_at
    END
`);

export function replaceTodayCalendarEvents(events: CalendarEventWire[]): void {
  runTx(() => {
    deleteAllEvents.run();
    for (const e of events) {
      insertEvent.run({
        id: e.externalId,
        date: e.date,
        title: e.title,
        start_min: e.startMin,
        end_min: e.endMin,
        kind: e.kind,
        color: e.color,
      });
    }
  });
}

const selectInboxExternalIds = db.prepare(`
  SELECT external_id FROM inbox_items
  WHERE source = :source AND triaged_to IS NULL AND external_id IS NOT NULL
`);
const deleteStaleInbox = db.prepare(`
  DELETE FROM inbox_items
  WHERE source = :source AND external_id = :external_id AND triaged_to IS NULL
`);

/**
 * Replaces this source's untriaged inbox items with the latest pull.
 *  - Upserts (preserving triaged_to on conflict)
 *  - Deletes any prior row from this source whose external_id is missing from
 *    the new pull AND the user hasn't triaged it yet. (Keep triaged rows for
 *    history; only the untriaged ghosts are pruned.)
 */
export function upsertInboxItems(source: string, items: InboxItemWire[]): void {
  const now = nowIso();
  const seen = new Set(items.map((i) => i.externalId));
  runTx(() => {
    for (const it of items) {
      const localId = `${it.source}-${it.externalId}`;
      upsertInbox.run({
        id: localId,
        source: it.source,
        external_id: it.externalId,
        title: it.title,
        created_at: now,
      });
    }
    const existing = selectInboxExternalIds.all({ source }) as { external_id: string }[];
    for (const row of existing) {
      if (!seen.has(row.external_id)) {
        deleteStaleInbox.run({ source, external_id: row.external_id });
      }
    }
  });
}

const selectSourceExternalIds = db.prepare(`
  SELECT external_id FROM tasks
  WHERE source = :source AND done_at IS NULL AND external_id IS NOT NULL
`);
const deleteStaleTask = db.prepare(`
  DELETE FROM tasks WHERE source = :source AND external_id = :external_id AND done_at IS NULL
`);

const countOpenForSource = db.prepare(`
  SELECT COUNT(*) AS n FROM tasks
  WHERE source = :source AND done_at IS NULL AND external_id IS NOT NULL
`);

export function upsertTasksFromSource(source: string, tasks: UnifiedTask[]): void {
  const now = nowIso();
  const seen = new Set(tasks.map((t) => t.externalId));

  // Empty-pull guard: a 200 with an unexpectedly empty/shape-shifted body
  // must not prune every open task for the source (that would irreversibly
  // destroy Roger-owned lane/position/tag state). Throwing records the
  // anomaly in sync_state.last_error; a genuinely emptied source can be
  // reconciled manually.
  if (tasks.length === 0) {
    const { n } = countOpenForSource.get({ source }) as { n: number };
    if (n > 0) {
      throw new Error(`empty pull with ${n} open local task(s) — refusing to prune`);
    }
    return;
  }

  runTx(() => {
    for (const t of tasks) {
      upsertTaskFromSource.run({
        id: `${source}-${t.externalId}`,
        source,
        external_id: t.externalId,
        title: t.title,
        note: t.note ?? null,
        project: t.project ?? null,
        estimate_min: t.estimateMin ?? null,
        due: t.due ?? null,
        url: t.url ?? null,
        done_at: t.doneAt ?? null,
        now,
      });
    }
    // Drop rows the source no longer reports — but only if the user hasn't
    // marked them done (we keep done rows so completions_log joins still work).
    const existing = selectSourceExternalIds.all({ source }) as { external_id: string }[];
    for (const row of existing) {
      if (!seen.has(row.external_id)) {
        deleteStaleTask.run({ source, external_id: row.external_id });
      }
    }
    // Pruning a synced parent can orphan local breakdown children (no FK on
    // parent_task_id). Detach them so they render as normal top-level tasks
    // instead of silently pointing at a row that no longer exists.
    db.prepare(`
      UPDATE tasks SET parent_task_id = NULL
      WHERE parent_task_id IS NOT NULL
        AND parent_task_id NOT IN (SELECT id FROM tasks)
    `).run();
  });
}

export function recordSyncOk(source: string): void {
  markSync.run({ source, last_pulled_at: nowIso() });
}

export function recordSyncError(source: string, error: unknown): void {
  markSyncError.run({ source, last_error: String(error) });
}
