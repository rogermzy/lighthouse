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

// Roger-owned fields (lane, big_rock, done_at, tag, position) are NEVER
// overwritten by a pull. Source-owned fields (title, note, project,
// estimate_min, due, url) are refreshed on every tick. New rows land at the
// bottom of the Later lane (max(position) + 1).
const upsertTaskFromSource = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, url, lane, big_rock, position, done_at, created_at, updated_at)
  VALUES
    (:id, :source, :external_id, :title, :note, :project, NULL, :estimate_min, :due, :url, 'later', 0,
     (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = 'later'),
     NULL, :now, :now)
  ON CONFLICT(source, external_id) DO UPDATE SET
    title        = excluded.title,
    note         = excluded.note,
    project      = excluded.project,
    estimate_min = excluded.estimate_min,
    due          = excluded.due,
    url          = excluded.url,
    updated_at   = excluded.updated_at
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

export function upsertTasksFromSource(source: string, tasks: UnifiedTask[]): void {
  const now = nowIso();
  const seen = new Set(tasks.map((t) => t.externalId));
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
  });
}

export function recordSyncOk(source: string): void {
  markSync.run({ source, last_pulled_at: nowIso() });
}

export function recordSyncError(source: string, error: unknown): void {
  markSyncError.run({ source, last_error: String(error) });
}
