import { Hono } from "hono";
import { db } from "../db/client.js";

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
  const freeBlocks = computeFreeBlocks(todayEvents, meta.day_start_min, meta.day_end_min);
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
