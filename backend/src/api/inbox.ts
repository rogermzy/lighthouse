import { Hono } from "hono";
import { db, nowIso, runTx } from "../db/client.js";

type InboxRow = {
  id: string;
  source: string;
  title: string;
};

const selectUntriaged = db.prepare(`
  SELECT id, source, title
  FROM inbox_items
  WHERE triaged_to IS NULL
  ORDER BY created_at ASC
`);

const insertInbox = db.prepare(`
  INSERT INTO inbox_items (id, source, external_id, title, triaged_to, created_at)
  VALUES (:id, :source, NULL, :title, NULL, :created_at)
`);

const updateTriage = db.prepare(`
  UPDATE inbox_items SET triaged_to = :triaged_to WHERE id = :id
`);

const selectInboxById = db.prepare(`
  SELECT id, source, title FROM inbox_items WHERE id = :id
`);

const insertTaskFromInbox = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, lane, big_rock, pinned, position, done_at, created_at, updated_at)
  VALUES
    (:id, :source, NULL, :title, NULL, NULL, NULL, NULL, NULL, :lane, 0, :pinned,
     (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = :lane),
     NULL, :now, :now)
`);

// Must match SOURCES keys in data.jsx — components dereference SOURCES[item.source]
// directly, so an unknown source crashes the row render.
const VALID_SOURCES = new Set([
  "clickup", "workflowy", "linear", "things", "notion", "email", "gcal", "gtasks", "self", "agent",
]);

function toWire(r: InboxRow) {
  return { id: r.id, lane: "inbox", title: r.title, source: r.source };
}

export const inboxApi = new Hono();

inboxApi.get("/", (c) => {
  const rows = selectUntriaged.all() as InboxRow[];
  return c.json(rows.map(toWire));
});

inboxApi.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "title required" }, 400);

  const source = typeof body.source === "string" ? body.source : "self";
  if (!VALID_SOURCES.has(source)) {
    return c.json({ error: `invalid source: ${source}` }, 400);
  }
  const id = `i-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  insertInbox.run({ id, source, title, created_at: nowIso() });

  return c.json(toWire({ id, source, title }), 201);
});

// Inbox triage "later" routes to This week — the user is acknowledging the
// item for the current week's plan, just not committing it to today.
// (Dropping triage rows entirely flow through a separate code path.)
const TRIAGE_TO_LANE: Record<string, string> = {
  today: "today",
  later: "this_week",   // legacy alias — kept for existing callers
  this_week: "this_week",
  this_month: "this_month",
  backlog: "backlog",
};
const TRIAGE_TARGETS = [...Object.keys(TRIAGE_TO_LANE), "drop"];

const TODAY_CAP = 3;
const countTodayUndone = db.prepare(
  "SELECT COUNT(*) as n FROM tasks WHERE lane = 'today' AND done_at IS NULL"
);

inboxApi.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const triagedTo = String(body.triaged_to ?? body.triagedTo ?? "");

  if (!TRIAGE_TARGETS.includes(triagedTo)) {
    return c.json({ error: `triaged_to must be one of: ${TRIAGE_TARGETS.join("|")}` }, 400);
  }

  const item = selectInboxById.get({ id }) as InboxRow | undefined;
  if (!item) return c.json({ error: "not found" }, 404);

  let createdTaskId: string | null = null;
  let fellBackToUpNext = false;

  // Cap-check + triage + task-insert all in one IMMEDIATE-mode transaction so
  // concurrent triage→today writes can't both see count=2 and both insert.
  runTx(() => {
    let lane = TRIAGE_TO_LANE[triagedTo]; // undefined for "drop"
    let pinned = 0;

    if (triagedTo === "today") {
      const { n } = countTodayUndone.get() as { n: number };
      if (n >= TODAY_CAP) {
        // Today is full → park at the top of Up next instead of failing the
        // triage. Up next is derived from this_week (pinned + high-weight),
        // so this_week + pinned=1 surfaces it as the next-in-line. Keeps the
        // brain-dump triage gesture cheap: user said "today", system honors
        // the intent by queueing it for the moment a Today slot opens.
        lane = "this_week";
        pinned = 1;
        fellBackToUpNext = true;
      }
    }

    updateTriage.run({ id, triaged_to: triagedTo });
    if (lane) {
      const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      insertTaskFromInbox.run({
        id: taskId,
        source: item.source,
        title: item.title,
        lane,
        pinned,
        now: nowIso(),
      });
      createdTaskId = taskId;
    }
  });

  return c.json({ ok: true, createdTaskId, fellBackToUpNext });
});
