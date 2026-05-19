import { Hono } from "hono";
import { db, nowIso } from "../db/client.js";

type EntryRow = { id: string; mood: string; note: string; created_at: string; source?: string };

// Canonical mood palette. Frontend fetches this via GET /api/journal so the
// two ends can't drift — add a mood here and the chips update on next page load.
// Ordered loosely by valence: settled → activated-positive → activated-negative
// → depleted. Default mood on new entries is "calm" (first slot) — softer
// landing than picking "focused" upfront.
const MOODS = [
  { id: "calm",         label: "calm",         color: "#4e6a55" },
  { id: "focused",      label: "focused",      color: "#5e6ad2" },
  { id: "content",      label: "content",      color: "#4a857a" },
  { id: "curious",      label: "curious",      color: "#7ca94a" },
  { id: "inspired",     label: "inspired",     color: "#9b6bb0" },
  { id: "proud",        label: "proud",        color: "#c89c4a" },
  { id: "buzzy",        label: "buzzy",        color: "#8a7530" },
  { id: "scattered",    label: "scattered",    color: "#b8442e" },
  { id: "frustrated",   label: "frustrated",   color: "#a8431b" },
  { id: "anxious",      label: "anxious",      color: "#6b5a8a" },
  { id: "overwhelmed",  label: "overwhelmed",  color: "#943a55" },
  { id: "drained",      label: "drained",      color: "#806b5b" },
  { id: "low",          label: "low",          color: "#b86b8e" },
] as const;
const VALID_MOODS = new Set(MOODS.map((m) => m.id));

const NOTE_MAX_LEN = 2000;

const selectRecent = db.prepare(`
  SELECT id, mood, note, source, created_at FROM journal_entries
  WHERE created_at >= :cutoff
  ORDER BY created_at DESC
`);

// Entries whose *local* date matches :day (YYYY-MM-DD). 'localtime' converts
// the stored UTC ISO into the server's TZ before extracting the date, so the
// boundary lines up with what the user calls "today".
const selectByLocalDate = db.prepare(`
  SELECT id, mood, note, source, created_at FROM journal_entries
  WHERE date(created_at, 'localtime') = :day
  ORDER BY created_at DESC
`);

// Distinct local-date days that have at least one entry, newest first.
const selectDaysWithEntries = db.prepare(`
  SELECT DISTINCT date(created_at, 'localtime') AS day
  FROM journal_entries
  ORDER BY day DESC
`);

const insertEntry = db.prepare(`
  INSERT INTO journal_entries (id, mood, note, created_at) VALUES (:id, :mood, :note, :created_at)
`);

function toWire(r: EntryRow) {
  return {
    id: r.id,
    mood: r.mood,
    note: r.note,
    source: r.source ?? "self",
    createdAt: r.created_at,
  };
}

function computeStreak(): number {
  const days = selectDaysWithEntries.all() as { day: string }[];
  if (days.length === 0) return 0;

  // Use local date in YYYY-MM-DD form so it lines up with date(..., 'localtime') in SQL.
  const today = new Date();
  const localDay = (offset: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() - offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  // Streak starts wherever the most recent entry sits — today OR yesterday —
  // so logging once in the morning doesn't drop the count if you haven't logged today yet.
  let offset = days[0]!.day === localDay(0) ? 0 : days[0]!.day === localDay(1) ? 1 : -1;
  if (offset === -1) return 0;

  const have = new Set(days.map((d) => d.day));
  let streak = 0;
  while (have.has(localDay(offset))) {
    streak++;
    offset++;
  }
  return streak;
}

export const journalApi = new Hono();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

journalApi.get("/", (c) => {
  const date = c.req.query("date");

  let rows: EntryRow[];
  if (date) {
    if (!DATE_RE.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    rows = selectByLocalDate.all({ day: date }) as EntryRow[];
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    rows = selectRecent.all({ cutoff: cutoff.toISOString() }) as EntryRow[];
  }

  const days = (selectDaysWithEntries.all() as { day: string }[]).map((d) => d.day);

  return c.json({
    entries: rows.map(toWire),
    streak: computeStreak(),
    moods: MOODS,
    days,
    selectedDate: date ?? null,
  });
});

const updateEntry = db.prepare(`
  UPDATE journal_entries SET mood = :mood, note = :note WHERE id = :id
`);
const deleteEntryStmt = db.prepare(`DELETE FROM journal_entries WHERE id = :id`);
const selectEntryById = db.prepare(`
  SELECT id, mood, note, source, created_at FROM journal_entries WHERE id = :id
`);

journalApi.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const existing = selectEntryById.get({ id }) as EntryRow | undefined;
  if (!existing) return c.json({ error: "not found" }, 404);

  const nextNote = typeof body.note === "string" ? body.note.trim() : existing.note;
  const nextMood = typeof body.mood === "string" ? body.mood : existing.mood;

  if (!nextNote) return c.json({ error: "note required" }, 400);
  if (nextNote.length > NOTE_MAX_LEN) {
    return c.json({ error: `note too long (max ${NOTE_MAX_LEN} chars)`, length: nextNote.length }, 400);
  }
  if (!VALID_MOODS.has(nextMood)) return c.json({ error: `invalid mood: ${nextMood}` }, 400);

  updateEntry.run({ id, mood: nextMood, note: nextNote });
  return c.json({ entry: toWire({ ...existing, mood: nextMood, note: nextNote }) });
});

journalApi.delete("/:id", (c) => {
  const id = c.req.param("id");
  const result = deleteEntryStmt.run({ id });
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true, streak: computeStreak() });
});

journalApi.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const mood = typeof body.mood === "string" ? body.mood : "";

  if (!note) return c.json({ error: "note required" }, 400);
  if (note.length > NOTE_MAX_LEN) {
    return c.json({ error: `note too long (max ${NOTE_MAX_LEN} chars)`, length: note.length }, 400);
  }
  if (!VALID_MOODS.has(mood)) return c.json({ error: `invalid mood: ${mood}` }, 400);

  const id = `j-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created_at = nowIso();
  insertEntry.run({ id, mood, note, created_at });

  // Push to flomo if configured. Tagged #lighthouse so the next RSS pull
  // recognizes it as our own and skips re-importing (circular-sync guard).
  // Fire-and-forget — never blocks the response.
  pushToFlomo({ note, mood });

  return c.json(
    {
      entry: toWire({ id, mood, note, created_at }),
      streak: computeStreak(),
    },
    201
  );
});

/**
 * Push to flomo's incoming webhook. The webhook accepts JSON with `content`
 * + optional `content_type` ("markdown" for rich rendering). We tag with
 * `#lighthouse` (so the RSS pull skips it on the circular trip) and the
 * mood (so flomo's tag view groups by mood).
 */
function pushToFlomo(entry: { note: string; mood: string }): void {
  const url = process.env.FLOMO_WEBHOOK_URL;
  if (!url) return;
  const content = `${entry.note}\n\n#lighthouse #${entry.mood}`;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, content_type: "markdown" }),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[flomo-push] ${res.status}: ${res.statusText}`);
      }
    })
    .catch((err) => {
      console.warn(`[flomo-push] error: ${String(err)}`);
    });
}
