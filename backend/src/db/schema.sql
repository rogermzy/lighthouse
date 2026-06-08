-- Unified task pool. External-source items upsert by (source, external_id).
-- Roger-only fields (lane, big_rock, done_at) are never overwritten by sync.
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  external_id   TEXT,
  title         TEXT NOT NULL,
  note          TEXT,
  project       TEXT,
  tag           TEXT,
  estimate_min  INTEGER,
  due           TEXT,
  lane          TEXT NOT NULL DEFAULT 'this_month',
  big_rock      INTEGER NOT NULL DEFAULT 0,
  position      REAL    NOT NULL DEFAULT 0,
  url           TEXT,
  done_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_lane ON tasks(lane) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS inbox_items (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  external_id   TEXT,
  title         TEXT NOT NULL,
  triaged_to    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS goals_annual (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  color     TEXT,
  intent    TEXT,
  -- Free-form context the breakdown agent reads on every run: strategy,
  -- assumptions, constraints, existing assets, what's been tried. Lets
  -- the agent propose milestones that fit the user's actual situation
  -- instead of "generic SaaS playbook" answers.
  context   TEXT,
  target    TEXT,
  progress  REAL NOT NULL DEFAULT 0,
  trend     TEXT
);

CREATE TABLE IF NOT EXISTS goals_quarterly (
  id          TEXT PRIMARY KEY,
  parent      TEXT REFERENCES goals_annual(id),
  title       TEXT NOT NULL,
  progress    REAL NOT NULL DEFAULT 0,
  weeks_left  INTEGER
);

CREATE TABLE IF NOT EXISTS goals_monthly (
  id              TEXT PRIMARY KEY,
  parent          TEXT NOT NULL,
  title           TEXT NOT NULL,
  progress        REAL NOT NULL DEFAULT 0,
  next_step       TEXT,
  linked_task_id  TEXT REFERENCES tasks(id)
);

-- Calendar events for a rolling 4-day window (today + 3 ahead). The gcal
-- connector replaces the whole window on each sync. `date` is the local YYYY-MM-DD
-- so the multi-day view can render events in the right column. The matching
-- index is created in client.ts AFTER the ALTER TABLE migration runs — putting
-- it here breaks bootstrapping on existing DBs whose table lacks `date` yet.
CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL,
  start_min   INTEGER NOT NULL,
  end_min     INTEGER NOT NULL,
  kind        TEXT,
  color       TEXT
);

CREATE TABLE IF NOT EXISTS calendar_meta (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  account         TEXT,
  synced_min_ago  INTEGER NOT NULL DEFAULT 0,
  day_start_min   INTEGER NOT NULL DEFAULT 510,
  day_end_min     INTEGER NOT NULL DEFAULT 1110
);

-- Hardcoded for now; will be derived from real calendar/task counts later.
CREATE TABLE IF NOT EXISTS week_glance (
  position  INTEGER PRIMARY KEY,
  day       TEXT NOT NULL,
  date      INTEGER NOT NULL,
  count     INTEGER NOT NULL,
  load      REAL NOT NULL,
  is_today  INTEGER NOT NULL DEFAULT 0,
  is_past   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS completions_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   TEXT NOT NULL,
  done_at   TEXT NOT NULL,
  source    TEXT,
  goal_id   TEXT,
  est_min   INTEGER
);

-- One row per day for the "Block X for focus" button — anchors the
-- Google Calendar event ID so re-clicks can PATCH the same event
-- instead of creating duplicates. Date-keyed so yesterday's row sticks
-- around for free (no cleanup job needed); next-day click writes a new
-- row instead of mutating the old one. task_id is informational — a
-- snapshot of the Now task at schedule time, doesn't drive logic.
CREATE TABLE IF NOT EXISTS scheduled_focus (
  date         TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  task_id      TEXT,
  start_min    INTEGER NOT NULL,
  end_min      INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  source          TEXT PRIMARY KEY,
  last_pulled_at  TEXT,
  last_error      TEXT,
  cursor          TEXT
);

-- Settings written from the UI. Values overlay onto process.env at boot, so
-- connectors keep reading process.env transparently. Editing a row + restarting
-- (or letting the next /api/sync tick pick it up) is enough to activate a source.
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Single-row user profile (id=1). Drives the greeting + sidebar avatar + sync line.
-- Initials are auto-derived from name in the API if blank.
CREATE TABLE IF NOT EXISTS user_profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL,
  email       TEXT,
  initials    TEXT,
  -- Free-form "about me" context that all LLM agents (suggest, breakdown,
  -- enrichment) read on every run: role, work rhythms, constraints,
  -- relationships. The standing facts about the user that shape every
  -- proposal — set once in Settings, used everywhere.
  context     TEXT,
  updated_at  TEXT NOT NULL
);

-- Interstitial journal entries — quick "moments" written between tasks.
-- Mood is one of: calm | focused | scattered | drained | buzzy | low.
-- Source identifies origin: 'self' (typed in Lighthouse) or 'flomo' (synced
-- from flomo RSS). external_id is the source's stable id, used to dedup on
-- repeated pulls. Self-captured entries have NULL external_id.
CREATE TABLE IF NOT EXISTS journal_entries (
  id           TEXT PRIMARY KEY,
  mood         TEXT NOT NULL,
  note         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'self',
  external_id  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at);
-- Partial unique index on (source, external_id) is created in client.ts
-- AFTER the ALTER TABLE migration adds those columns. Putting it here
-- breaks bootstrapping on a DB created before the multi-source change.

-- LLM-derived enrichment for synced tasks: a semantic theme, the primary goal
-- it ladders to (any horizon), and a 0-1 weight for relative importance.
-- `hash` is a content-signature (title|project|note|goals_signature) so a
-- re-sync that didn't change the task skips re-enrichment, and a goals edit
-- naturally invalidates everything (the goals_signature shifts).
CREATE TABLE IF NOT EXISTS task_enrichment (
  task_id          TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  theme            TEXT NOT NULL,
  primary_goal_id  TEXT,
  weight           REAL NOT NULL DEFAULT 0.5,
  reasoning        TEXT,
  hash             TEXT NOT NULL,
  enriched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrichment_theme ON task_enrichment(theme);
