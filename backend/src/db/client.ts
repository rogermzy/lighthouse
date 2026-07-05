import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.LIGHTHOUSE_DB ?? join(__dirname, "..", "..", "data.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// One-time lane rename (idempotent — running again does nothing). The taxonomy
// shifted from attention-state names (focus/ondeck/someday) to a coherent
// time-commitment ladder (now/today/week/later). DB strings are migrated here
// so the rest of the app can drop the old names entirely.
db.exec(`
  UPDATE tasks SET lane = 'now'   WHERE lane = 'focus';
  UPDATE tasks SET lane = 'week'  WHERE lane = 'ondeck';
  UPDATE tasks SET lane = 'later' WHERE lane = 'someday';
`);

// Second-phase rename: from the time-commitment ladder (week/later) to the
// explicit-horizon ladder (this_week / this_month / backlog). Existing `later`
// rows all migrate into `this_month` — the lane-decay job will move stale
// items down to `backlog` based on `updated_at`. Idempotent.
db.exec(`
  UPDATE tasks SET lane = 'this_week'  WHERE lane = 'week';
  UPDATE tasks SET lane = 'this_month' WHERE lane = 'later';
`);

// Additive ALTER for the `date` column on calendar_events (multi-day view).
// Existing rows backfill to today's local date as a best effort.
const calCols = db.prepare("PRAGMA table_info(calendar_events)").all() as { name: string }[];
if (!calCols.some((c) => c.name === "date")) {
  db.exec("ALTER TABLE calendar_events ADD COLUMN date TEXT NOT NULL DEFAULT ''");
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  db.prepare("UPDATE calendar_events SET date = :date WHERE date = ''").run({ date: `${y}-${m}-${d}` });
}
db.exec("CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(date)");

// Additive ALTERs for journal_entries — `source` + `external_id` for the
// flomo two-way sync. Older DBs created before this change lack the columns.
const journalCols = db.prepare("PRAGMA table_info(journal_entries)").all() as { name: string }[];
if (!journalCols.some((c) => c.name === "source")) {
  db.exec("ALTER TABLE journal_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'self'");
}
if (!journalCols.some((c) => c.name === "external_id")) {
  db.exec("ALTER TABLE journal_entries ADD COLUMN external_id TEXT");
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_external
    ON journal_entries(source, external_id) WHERE external_id IS NOT NULL
`);

// Additive ALTER for the user-controlled `position` column (drag-to-reorder)
// and the source-owned `url` back-link. SQLite has no
// `ADD COLUMN IF NOT EXISTS`, so we probe via PRAGMA first.
const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
if (!taskCols.some((c) => c.name === "url")) {
  db.exec("ALTER TABLE tasks ADD COLUMN url TEXT");
}
// Additive ALTER for the new context fields — both annual goals and the
// user profile gain a free-form context textarea that agents read on every
// run. Idempotent: PRAGMA-probe before the ALTER so re-runs are no-ops.
const annualCols = db.prepare("PRAGMA table_info(goals_annual)").all() as { name: string }[];
if (!annualCols.some((c) => c.name === "context")) {
  db.exec("ALTER TABLE goals_annual ADD COLUMN context TEXT");
}
const profileCols = db.prepare("PRAGMA table_info(user_profile)").all() as { name: string }[];
if (!profileCols.some((c) => c.name === "context")) {
  db.exec("ALTER TABLE user_profile ADD COLUMN context TEXT");
}

if (!taskCols.some((c) => c.name === "pinned")) {
  // Pinned tasks (in this_week) surface as the top recommendation and sort
  // first in the list. Capped at 5 (enforced at the API layer). Auto-clears
  // when decay demotes a task out of this_week.
  db.exec("ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}
if (!taskCols.some((c) => c.name === "position")) {
  db.exec("ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0");
  // Backfill: number every existing task within its lane in id order so the
  // initial render isn't randomly ordered. Open + done rows together since
  // done rows fall off after midnight anyway.
  const lanes = db.prepare("SELECT DISTINCT lane FROM tasks").all() as { lane: string }[];
  const selectIds = db.prepare("SELECT id FROM tasks WHERE lane = :lane ORDER BY id");
  const setPos = db.prepare("UPDATE tasks SET position = :pos WHERE id = :id");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const { lane } of lanes) {
      const ids = selectIds.all({ lane }) as { id: string }[];
      ids.forEach((r, i) => setPos.run({ id: r.id, pos: i + 1 }));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Breakdown feature: links a small child task to its umbrella parent. Null for
// every normal task; only breakdown-children point at a parent. The index is
// partial so it stays tiny. CREATE INDEX lives here (not schema.sql) because
// the column is freshly added — schema.sql runs before these ALTERs.
if (!taskCols.some((c) => c.name === "parent_task_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT");
}
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL",
);

// Additive ALTER: user_linked marks enrichment rows whose primary_goal_id was
// set by the user (milestone commit / manual link) — the enrichment loop
// preserves the goal link on these rows instead of reclassifying it away.
const enrichCols = db.prepare("PRAGMA table_info(task_enrichment)").all() as { name: string }[];
if (!enrichCols.some((c) => c.name === "user_linked")) {
  db.exec("ALTER TABLE task_enrichment ADD COLUMN user_linked INTEGER NOT NULL DEFAULT 0");
  // Backfill: rows written by commitTasksForMilestone carry sentinel hashes.
  db.exec("UPDATE task_enrichment SET user_linked = 1 WHERE hash LIKE 'seeded-%' OR hash LIKE 'linked-%'");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Run `fn` inside a serialized write transaction. `BEGIN IMMEDIATE` grabs the
 * RESERVED lock at the start so concurrent writers queue behind each other —
 * required for read-then-write patterns (e.g. the today-lane 3-cap check).
 */
export function runTx(fn: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
