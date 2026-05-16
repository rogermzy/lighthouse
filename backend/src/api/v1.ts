import { Hono } from "hono";
import { db, nowIso, runTx } from "../db/client.js";
import { checkBearer } from "../auth/api-token.js";

export const v1Api = new Hono();

// Bearer auth gate. Every /api/v1/* request needs a valid token.
v1Api.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!checkBearer(auth)) {
    return c.json(
      { error: "unauthorized", detail: "set Authorization: Bearer <token>; generate one in Settings → API Integrations." },
      401
    );
  }
  await next();
});

const VALID_SOURCES = new Set([
  "clickup", "workflowy", "linear", "things", "notion", "email", "gcal", "gtasks", "self", "agent",
]);
const VALID_LANES = new Set(["now", "today", "week", "later"]);
const VALID_MOODS = new Set(["calm", "focused", "scattered", "drained", "buzzy", "low"]);
const VALID_TAGS  = new Set(["deep", "shallow", "admin", "comms", "personal", "errand"]);

// Relative due-date keywords accepted in addition to ISO YYYY-MM-DD.
const DUE_KEYWORDS = new Set([
  "today", "tomorrow", "soon", "this week", "next week",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const TODAY_CAP = 3;
const TITLE_MAX = 500;
const NOTE_MAX  = 2000;

const insertInbox = db.prepare(`
  INSERT INTO inbox_items (id, source, external_id, title, triaged_to, created_at)
  VALUES (:id, :source, NULL, :title, NULL, :created_at)
`);

const insertTask = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, lane, big_rock, position, done_at, created_at, updated_at)
  VALUES
    (:id, :source, NULL, :title, :note, :project, :tag, :estimate_min, :due, :lane, 0,
     (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = :lane),
     NULL, :now, :now)
`);

const countTodayUndone = db.prepare(
  "SELECT COUNT(*) as n FROM tasks WHERE lane = 'today' AND done_at IS NULL"
);

const insertJournal = db.prepare(`
  INSERT INTO journal_entries (id, mood, note, created_at) VALUES (:id, :mood, :note, :created_at)
`);

/** Validates a `due` field. Returns `{ ok: true, value }` for accept,
 *  `{ ok: false }` for reject. `null`/undefined means "no due" → ok with null. */
function validateDue(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 16) return { ok: false };
  const lower = trimmed.toLowerCase();
  if (DUE_KEYWORDS.has(lower)) return { ok: true, value: lower };
  if (ISO_DATE.test(trimmed)) return { ok: true, value: trimmed };
  return { ok: false };
}

/* ─── POST /api/v1/capture — drop an item in the brain dump inbox. ─── */
v1Api.post("/capture", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "title required" }, 400);
  if (title.length > TITLE_MAX) {
    return c.json({ error: `title too long (max ${TITLE_MAX} chars)`, length: title.length }, 400);
  }

  const source = typeof body.source === "string" ? body.source : "agent";
  if (!VALID_SOURCES.has(source)) return c.json({ error: `invalid source: ${source}` }, 400);

  const id = `i-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  insertInbox.run({ id, source, title, created_at: nowIso() });
  return c.json({ id, source, title, lane: "inbox" }, 201);
});

/* ─── POST /api/v1/tasks — create a task directly with optional lane. ─── */
v1Api.post("/tasks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "title required" }, 400);
  if (title.length > TITLE_MAX) {
    return c.json({ error: `title too long (max ${TITLE_MAX} chars)`, length: title.length }, 400);
  }

  const lane = typeof body.lane === "string" ? body.lane : "later";
  if (!VALID_LANES.has(lane)) return c.json({ error: `invalid lane: ${lane}` }, 400);

  const source = typeof body.source === "string" ? body.source : "agent";
  if (!VALID_SOURCES.has(source)) return c.json({ error: `invalid source: ${source}` }, 400);

  const tag = body.tag == null ? null : String(body.tag);
  if (tag !== null && !VALID_TAGS.has(tag)) return c.json({ error: `invalid tag: ${tag}` }, 400);

  let estimateMin: number | null = null;
  if (body.estimate != null) {
    // Reject Infinity / NaN / negative; cap at 600 (10h) so a runaway script
    // can't smear a giant pill across the row.
    if (!Number.isFinite(body.estimate) || body.estimate < 0 || body.estimate > 600) {
      return c.json({ error: "invalid estimate (finite minutes, 0–600)" }, 400);
    }
    estimateMin = Math.round(body.estimate);
  }

  const dueCheck = validateDue(body.due);
  if (!dueCheck.ok) {
    return c.json(
      { error: "invalid due", detail: 'use ISO YYYY-MM-DD or a keyword (today, tomorrow, soon, this week, next week, mon..sun)' },
      400
    );
  }

  const note = body.note == null ? null : String(body.note);
  if (note !== null && note.length > NOTE_MAX) {
    return c.json({ error: `note too long (max ${NOTE_MAX} chars)`, length: note.length }, 400);
  }

  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = nowIso();
  let capFull: number | null = null;
  let nowGateError: string | null = null;

  // Cap-check + insert in one IMMEDIATE-mode transaction so concurrent writers
  // can't both see count=2 and both insert (would've yielded 4 today rows).
  runTx(() => {
    if (lane === "today") {
      const { n } = countTodayUndone.get() as { n: number };
      if (n >= TODAY_CAP) {
        capFull = n;
        return; // exit fn without inserting; the empty COMMIT is fine
      }
    }
    if (lane === "now") {
      // External capture can't bypass the Now⊂Today rule. Force the agent to
      // create the task in Today first, then promote it explicitly.
      nowGateError = 'Cannot create a task directly in "now". Use lane="today" then PATCH to "now".';
      return;
    }
    insertTask.run({
      id,
      source,
      title,
      note,
      project: typeof body.project === "string" ? body.project : null,
      tag,
      estimate_min: estimateMin,
      due: dueCheck.value,
      lane,
      now,
    });
  });

  if (nowGateError) return c.json({ error: "now_gate", message: nowGateError }, 409);
  if (capFull !== null) {
    return c.json(
      {
        error: "today_full",
        message: `Today already has ${TODAY_CAP} tasks. Move one to This week first, or pick lane="week" / "later".`,
        todayCount: capFull,
      },
      409
    );
  }

  return c.json({ id, source, title, lane }, 201);
});

/* ─── POST /api/v1/journal — log an interstitial moment. ─── */
v1Api.post("/journal", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const mood = typeof body.mood === "string" ? body.mood : "";

  if (!note) return c.json({ error: "note required" }, 400);
  if (note.length > NOTE_MAX) {
    return c.json({ error: `note too long (max ${NOTE_MAX} chars)`, length: note.length }, 400);
  }
  if (!VALID_MOODS.has(mood)) return c.json({ error: `invalid mood: ${mood}` }, 400);

  const id = `j-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created_at = nowIso();
  insertJournal.run({ id, mood, note, created_at });
  return c.json({ id, mood, note, createdAt: created_at }, 201);
});
