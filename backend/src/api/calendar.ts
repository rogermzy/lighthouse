import { Hono } from "hono";
import { google } from "googleapis";
import { db, nowIso } from "../db/client.js";
import { googleOAuthClient, hasGoogleTokens, isGoogleOAuthConfigured } from "../auth/oauth.js";

type EventRow = {
  id: string;
  date: string;
  title: string;
  start_min: number;
  end_min: number;
  kind: string | null;
  color: string | null;
};

function todayDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

type MetaRow = {
  account: string | null;
  synced_min_ago: number;
  day_start_min: number;
  day_end_min: number;
};

type SyncRow = { last_pulled_at: string | null };

const selectEvents = db.prepare(`
  SELECT id, date, title, start_min, end_min, kind, color
  FROM calendar_events
  WHERE date >= :start AND date < :end
  ORDER BY date, start_min ASC
`);

const selectMeta = db.prepare(`
  SELECT account, synced_min_ago, day_start_min, day_end_min
  FROM calendar_meta WHERE id = 1
`);

const selectSync = db.prepare(`
  SELECT last_pulled_at FROM sync_state WHERE source = 'gcal'
`);

type Block = { start: number; end: number };

function computeFreeBlocks(events: EventRow[], dayStart: number, dayEnd: number): Block[] {
  const sorted = [...events].sort((a, b) => a.start_min - b.start_min);
  const blocks: Block[] = [];
  let cursor = dayStart;
  for (const ev of sorted) {
    if (ev.start_min > cursor) blocks.push({ start: cursor, end: ev.start_min });
    cursor = Math.max(cursor, ev.end_min);
  }
  if (cursor < dayEnd) blocks.push({ start: cursor, end: dayEnd });
  return blocks;
}

export const calendarApi = new Hono();

const CAL_DAYS = 4;

calendarApi.get("/today", (c) => {
  const start = todayDateStr();
  const end = addDays(start, CAL_DAYS);
  const events = selectEvents.all({ start, end }) as EventRow[];
  const meta = (selectMeta.get() as MetaRow | undefined) ?? {
    account: null,
    synced_min_ago: 0,
    day_start_min: 8 * 60 + 30,
    day_end_min: 18 * 60 + 30,
  };
  const sync = selectSync.get() as SyncRow | undefined;

  // Prefer the live sync timestamp if one exists; fall back to the seeded value.
  const syncedMinAgo = sync?.last_pulled_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(sync.last_pulled_at)) / 60000))
    : meta.synced_min_ago;

  // Build the days array. Always emit all N days even if empty so the grid
  // renders consistent columns (no surprise gaps).
  const days: { date: string; events: EventRow[] }[] = [];
  for (let i = 0; i < CAL_DAYS; i++) {
    const date = addDays(start, i);
    days.push({ date, events: events.filter((e) => e.date === date) });
  }

  // Today-only free/best/total for the rail card (which still shows today's shape).
  const todayEvents = days[0]?.events ?? [];
  // Free-time floor is "now" (not the configured day-start) so the count
  // shrinks as the day passes — at 3pm a "7h30m free" line is nonsense; the
  // user only has hours until dayEnd to actually use. Clamped so an early
  // morning user (before dayStart) still gets the full day window, and a
  // post-dayEnd user gets 0 instead of negative.
  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const effectiveStart = Math.min(meta.day_end_min, Math.max(meta.day_start_min, nowMin));
  // Restrict the free-block calculation to events that fall inside the
  // configured day window. Without this, a late-evening event (say a 9:30pm
  // social calendar item) past day_end_min creates a phantom "free block"
  // between day_end and that event — showing the user "3h free" at 11pm
  // when the work-day window closed hours ago. Spans that cross day_end
  // (e.g. 6pm-7pm event when day_end is 6:30pm) get their end clamped so
  // the cursor logic stays inside the window.
  const windowEvents = todayEvents
    .filter((e) => e.start_min < meta.day_end_min)
    .map((e) => ({ ...e, end_min: Math.min(e.end_min, meta.day_end_min) }));
  const freeBlocks = computeFreeBlocks(windowEvents, effectiveStart, meta.day_end_min);
  const freeTotal = freeBlocks.reduce((a, b) => a + (b.end - b.start), 0);
  const bestBlock = freeBlocks.length > 0
    ? freeBlocks.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a)
    : { start: meta.day_start_min, end: meta.day_start_min };

  const toWire = (e: EventRow) => ({
    id: e.id, date: e.date, title: e.title,
    start: e.start_min, end: e.end_min, kind: e.kind, color: e.color,
  });

  return c.json({
    calendar: {
      account: meta.account,
      syncedMinAgo,
      dayStart: meta.day_start_min,
      dayEnd: meta.day_end_min,
      // Legacy field — today's events only — kept so the rail CalendarCard
      // and any agent tooling keep working without changes.
      events: todayEvents.map(toWire),
      days: days.map((d) => ({ date: d.date, events: d.events.map(toWire) })),
    },
    freeBlocks,
    freeTotal,
    bestBlock,
  });
});

/* ────────────────────────── focus-block ──────────────────────────
 * "Block X for focus" CTA: creates a real Google Calendar event on the
 * primary calendar covering BEST_BLOCK.start for up to 50 minutes (capped
 * at the block's actual end). Re-clicks PATCH the same event so a moved
 * BEST_BLOCK (meeting added/cancelled since) updates the existing slot
 * instead of stacking events. The event ID is stored in scheduled_focus
 * keyed by date — one focus block per day. */

const FOCUS_BLOCK_MAX_MIN = 50;
const FOCUS_EVENT_PREFIX = "🎯 Focus:";

type ScheduledFocusRow = {
  date: string;
  event_id: string;
  task_id: string | null;
  start_min: number;
  end_min: number;
};

const selectScheduledFocus = db.prepare(`
  SELECT date, event_id, task_id, start_min, end_min
  FROM scheduled_focus WHERE date = :date
`);

const upsertScheduledFocus = db.prepare(`
  INSERT INTO scheduled_focus (date, event_id, task_id, start_min, end_min, created_at, updated_at)
  VALUES (:date, :event_id, :task_id, :start_min, :end_min, :now, :now)
  ON CONFLICT(date) DO UPDATE SET
    event_id = excluded.event_id,
    task_id = excluded.task_id,
    start_min = excluded.start_min,
    end_min = excluded.end_min,
    updated_at = excluded.updated_at
`);

const selectTaskTitle = db.prepare(`
  SELECT title FROM tasks WHERE id = :id
`);

const selectCalendarMeta = db.prepare(`
  SELECT day_start_min, day_end_min FROM calendar_meta WHERE id = 1
`);

// Compute today's best free block on-demand — same logic the /today endpoint
// uses, factored out so POST can decide event timing without round-tripping
// through the wire format.
function todayBestBlock(): Block | null {
  const date = todayDateStr();
  const meta = (selectCalendarMeta.get() as { day_start_min: number; day_end_min: number } | undefined) ?? {
    day_start_min: 8 * 60 + 30,
    day_end_min: 18 * 60 + 30,
  };
  const events = selectEvents.all({ start: date, end: addDays(date, 1) }) as EventRow[];
  const todayEvents = events
    .filter((e) => e.start_min < meta.day_end_min)
    .map((e) => ({ ...e, end_min: Math.min(e.end_min, meta.day_end_min) }));
  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const effectiveStart = Math.min(meta.day_end_min, Math.max(meta.day_start_min, nowMin));
  const freeBlocks = computeFreeBlocks(todayEvents, effectiveStart, meta.day_end_min);
  if (freeBlocks.length === 0) return null;
  return freeBlocks.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
}

// Build an RFC3339-ish dateTime + timeZone payload for Google's events API.
// We pass a UTC ISO string with the local timeZone alongside; Google resolves
// the instant from the dateTime and uses timeZone for display/recurrence.
function googleEventTime(date: string, minOfDay: number) {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dt = new Date(`${date}T00:00:00`);
  dt.setMinutes(dt.getMinutes() + minOfDay);
  return { dateTime: dt.toISOString(), timeZone: localTz };
}

// Detect Google's "insufficient scope" 403 across the few shapes the SDK
// surfaces it in. Used to map to a 409 needs_reconsent the UI can act on.
function isInsufficientScopeError(err: unknown): boolean {
  const e = err as { code?: number; status?: number; message?: string };
  if (e?.code === 403 || e?.status === 403) {
    const msg = String(e?.message ?? "").toLowerCase();
    return msg.includes("insufficient") || msg.includes("scope");
  }
  return false;
}

function rowToWire(r: ScheduledFocusRow) {
  return {
    eventId: r.event_id,
    taskId: r.task_id,
    startMin: r.start_min,
    endMin: r.end_min,
    date: r.date,
  };
}

calendarApi.get("/focus-block", (c) => {
  const date = todayDateStr();
  const row = selectScheduledFocus.get({ date }) as ScheduledFocusRow | undefined;
  if (!row) return c.json(null);
  return c.json(rowToWire(row));
});

calendarApi.post("/focus-block", async (c) => {
  if (!isGoogleOAuthConfigured() || !hasGoogleTokens()) {
    return c.json({ error: "google_not_connected", auth_url: "/auth/google" }, 409);
  }

  const body = await c.req.json().catch(() => ({}));
  const taskId = typeof body.taskId === "string" ? body.taskId : null;
  if (!taskId) return c.json({ error: "taskId required" }, 400);

  const taskRow = selectTaskTitle.get({ id: taskId }) as { title: string } | undefined;
  if (!taskRow) return c.json({ error: "task not found" }, 404);

  const best = todayBestBlock();
  if (!best || best.end <= best.start) {
    return c.json({ error: "no_free_block" }, 409);
  }
  const startMin = best.start;
  const endMin = Math.min(best.start + FOCUS_BLOCK_MAX_MIN, best.end);
  const date = todayDateStr();
  const summary = `${FOCUS_EVENT_PREFIX} ${taskRow.title}`;
  const eventBody = {
    summary,
    start: googleEventTime(date, startMin),
    end: googleEventTime(date, endMin),
  };

  const oauth = googleOAuthClient();
  const cal = google.calendar({ version: "v3", auth: oauth });
  const existing = selectScheduledFocus.get({ date }) as ScheduledFocusRow | undefined;

  let eventId: string;
  try {
    if (existing) {
      // PATCH the stored event. If it 404s (user deleted it in GCal), fall
      // through to insert — stale state shouldn't block a fresh schedule.
      try {
        const res = await cal.events.patch({
          calendarId: "primary",
          eventId: existing.event_id,
          requestBody: eventBody,
        });
        eventId = res.data.id ?? existing.event_id;
      } catch (err) {
        const e = err as { code?: number; status?: number };
        if (e?.code === 404 || e?.status === 404) {
          const res = await cal.events.insert({ calendarId: "primary", requestBody: eventBody });
          eventId = res.data.id ?? "";
        } else {
          throw err;
        }
      }
    } else {
      const res = await cal.events.insert({ calendarId: "primary", requestBody: eventBody });
      eventId = res.data.id ?? "";
    }
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return c.json({ error: "needs_reconsent", auth_url: "/auth/google" }, 409);
    }
    console.warn("[focus-block] event create/patch failed:", err);
    return c.json({ error: "gcal_failed", message: String((err as Error)?.message ?? err) }, 502);
  }

  if (!eventId) {
    return c.json({ error: "gcal_no_event_id" }, 502);
  }

  upsertScheduledFocus.run({
    date, event_id: eventId, task_id: taskId,
    start_min: startMin, end_min: endMin, now: nowIso(),
  });

  return c.json({ eventId, taskId, startMin, endMin, date, title: summary });
});
