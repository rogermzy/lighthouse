import { db, nowIso, runTx } from "./client.js";

const TASKS_SEED = [
  {
    id: "t-now", lane: "now",
    title: "Draft the Q3 retention narrative",
    note: "First pass. Don't polish. 25 minutes, then break.",
    source: "linear", project: "ENG-441", tag: "deep", estimate_min: 25, due: "today",
    big_rock: 0,
  },
  {
    id: "t1", lane: "today",
    title: "Review Priya's design spec & leave comments",
    note: "She's blocked on this — reply by lunch.",
    source: "linear", project: "DES-118", tag: "deep", estimate_min: 40, due: "today",
    big_rock: 1,
  },
  {
    id: "t2", lane: "today",
    title: "Send the contractor agreement to Maya",
    note: "Template in /legal. Just needs the rate filled in.",
    source: "email", project: "Hiring", tag: "admin", estimate_min: 10, due: "today",
    big_rock: 0,
  },
  {
    id: "t3", lane: "today",
    title: "30-min walk before the 2pm",
    note: "Non-negotiable. Phone stays at desk.",
    source: "self", project: "Health", tag: "personal", estimate_min: 30, due: "today",
    big_rock: 0,
  },
  {
    id: "t4", lane: "week",
    title: "Reply to the investor update thread",
    note: "Three messages waiting. Batch them.",
    source: "email", project: "Comms", tag: "comms", estimate_min: 20, due: "tomorrow",
    big_rock: 0,
  },
  {
    id: "t5", lane: "week",
    title: "Outline the onboarding redesign brief",
    note: null,
    source: "workflowy", project: "Onboarding", tag: "deep", estimate_min: 45, due: "thu",
    big_rock: 0,
  },
  {
    id: "t6", lane: "week",
    title: "Renew the domain (expires Friday)",
    note: null,
    source: "clickup", project: "Ops", tag: "errand", estimate_min: 10, due: "fri",
    big_rock: 0,
  },
  {
    id: "t7", lane: "week",
    title: "Book dentist for next month",
    note: null,
    source: "self", project: "Health", tag: "errand", estimate_min: 5, due: "soon",
    big_rock: 0,
  },
  {
    id: "t8", lane: "week",
    title: "Read 'Why we sleep' — ch. 4",
    note: null,
    source: "things", project: "Reading", tag: "personal", estimate_min: 30, due: "this week",
    big_rock: 0,
  },
];

const INBOX_SEED = [
  { id: "i1", title: "Sam asked about the off-site dates",  source: "email" },
  { id: "i2", title: "Idea: customer-led changelog?",       source: "workflowy" },
  { id: "i3", title: "Refill the supplements",              source: "self" },
  { id: "i4", title: "Follow up on the Acme contract",      source: "clickup" },
  { id: "i5", title: "ENG-512 is failing CI again",         source: "linear" },
];

const CALENDAR_EVENTS_SEED = [
  { id: "e1", title: "Team standup",      start_min: 9*60,      end_min: 9*60 + 30, kind: "meeting",  color: "#5e6ad2" },
  { id: "e2", title: "1:1 with Maya",     start_min: 11*60 + 30,end_min: 12*60,     kind: "meeting",  color: "#5e6ad2" },
  { id: "e3", title: "Product sync",      start_min: 14*60,     end_min: 14*60 + 45,kind: "meeting",  color: "#5e6ad2" },
  { id: "e4", title: "Investor check-in", start_min: 16*60,     end_min: 16*60 + 30,kind: "external", color: "#b8442e" },
  { id: "e5", title: "School pickup",     start_min: 17*60 + 30,end_min: 18*60,     kind: "personal", color: "#b86b8e" },
];

const WEEK_SEED = [
  { position: 0, day: "M", date: 11, count: 6, load: 0.7,  is_today: 0, is_past: 1 },
  { position: 1, day: "T", date: 12, count: 8, load: 0.9,  is_today: 0, is_past: 1 },
  { position: 2, day: "W", date: 13, count: 5, load: 0.6,  is_today: 0, is_past: 1 },
  { position: 3, day: "T", date: 14, count: 4, load: 0.45, is_today: 1, is_past: 0 },
  { position: 4, day: "F", date: 15, count: 7, load: 0.8,  is_today: 0, is_past: 0 },
  { position: 5, day: "S", date: 16, count: 2, load: 0.2,  is_today: 0, is_past: 0 },
  { position: 6, day: "S", date: 17, count: 1, load: 0.1,  is_today: 0, is_past: 0 },
];

// Journal seed entries — offsets are minutes ago from seed time, so they're
// always strictly in the past. Once seeded the timestamps are frozen; what's
// "today" at install becomes "yesterday" 24h later — natural aging.
const JOURNAL_SEED = [
  { id: "j1",   minutesAgo:        3 * 60 + 30, mood: "focused",
    note: "Stand-up was crisp · Caffeine's hitting, Slack tab closed · First 25 on the Q3 retention narrative, no polish" },
  { id: "j2",   minutesAgo:        2 * 60 + 15, mood: "scattered",
    note: "Got the intro down but kept jumping to email · Phone vibrated three times · Reset, same task, phone goes away" },
  { id: "j3",   minutesAgo:            60 + 15, mood: "calm",
    note: "Three paragraphs done. 1:1 with Maya was warm · Body feels loose, standing helped · Walk before the 2pm" },
  { id: "j-y1", minutesAgo: 28 * 60,              mood: "buzzy",
    note: "Slept badly, coffee carrying me · Mind ricocheting · One thing: the contractor doc, don't open Linear" },
  { id: "j-y2", minutesAgo: 24 * 60,              mood: "drained",
    note: "Lunchtime crash. Investor email took longer than it should've · Treating shallow work as 'urgent' · Walk, then deep work" },
  { id: "j-y3", minutesAgo: 20 * 60,              mood: "calm",
    note: "Moved one rock today. That's a win · Glad I logged at lunch · Tomorrow: protect the morning pocket" },
  { id: "j-e1", minutesAgo: 50 * 60,              mood: "focused",
    note: "Deep state. Lost track of time on the spec · Music + closed door works · Recreate this tomorrow morning" },
  { id: "j-e2", minutesAgo: 72 * 60,              mood: "scattered",
    note: "Tried to multi-task email + design — did both badly · Single-tasking is non-negotiable · Email gets one slot, after lunch" },
];

const GOALS_SEED = {
  annual: [
    { id: "a1", title: "Ship Lighthouse v1 to 1,000 paying users", color: "#b8442e",
      progress: 0.34, target: "Dec 2026", trend: "on-track",
      intent: "The product moves from internal dogfooding to a real business this year." },
    { id: "a2", title: "Run a 4-day workweek without losing output", color: "#4e6a55",
      progress: 0.55, target: "Q4 2026", trend: "ahead",
      intent: "Reclaim Fridays for deep work, family, and rest." },
    { id: "a3", title: "Publish a book on calm software", color: "#5e6ad2",
      progress: 0.15, target: "Dec 2026", trend: "behind",
      intent: "A long-form argument for the calm software movement." },
  ],
  quarterly: [
    { id: "q1", parent: "a1", title: "Launch private beta · recruit 100 design partners", progress: 0.6,  weeks_left: 7 },
    { id: "q2", parent: "a1", title: "Land 10 paid teams from the waitlist",              progress: 0.3,  weeks_left: 7 },
    { id: "q3", parent: "a2", title: "Cut meeting load by 40%, default to async",         progress: 0.7,  weeks_left: 7 },
    { id: "q4", parent: "a3", title: "Outline 12 chapters + draft a sample",              progress: 0.25, weeks_left: 7 },
  ],
  monthly: [
    { id: "m1", parent: "q1", title: "Onboard 30 design partners w/ weekly check-ins", progress: 0.5,
      next_step: "Review Priya's design spec & leave comments", linked_task_id: "t1" },
    { id: "m2", parent: "q1", title: "Ship the onboarding redesign", progress: 0.4,
      next_step: "Outline the onboarding redesign brief", linked_task_id: "t5" },
    { id: "m3", parent: "q2", title: "Send Q3 retention narrative to investors", progress: 0.15,
      next_step: "Draft the Q3 retention narrative", linked_task_id: "t-now" },
    { id: "m4", parent: "q3", title: "Move 1:1s + standups to Loom", progress: 0.8,
      next_step: "Reply to the investor update thread", linked_task_id: "t4" },
    { id: "m5", parent: "q4", title: 'Draft chapter 1 — "the cost of urgency"', progress: 0.6,
      next_step: 'Read "Why we sleep" — ch. 4', linked_task_id: "t8" },
    { id: "m6", parent: "a3", title: "Read 4 books on systems & calm", progress: 0.5,
      next_step: "Book reading-block on Saturday morning", linked_task_id: null },
  ],
};

export function seedIfEmpty(): void {
  // Profile seeds independently — runs once per upgrade if missing, even if
  // tasks/goals were seeded by a prior version that predated the profile table.
  db.prepare(`
    INSERT OR IGNORE INTO user_profile (id, name, email, initials, updated_at)
    VALUES (1, :name, :email, :initials, :now)
  `).run({ name: "Jordan Reyes", email: "jordan@reyes.studio", initials: "JR", now: nowIso() });

  // Journal seeds independently for the same reason — added in a later version,
  // existing installs won't have entries when the tasks gate short-circuits.
  const journalCount = (db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
  if (journalCount === 0) {
    const seedJournal = db.prepare(`
      INSERT OR IGNORE INTO journal_entries (id, mood, note, created_at)
      VALUES (:id, :mood, :note, :created_at)
    `);
    runTx(() => {
      for (const e of JOURNAL_SEED) {
        const t = new Date(Date.now() - e.minutesAgo * 60 * 1000);
        seedJournal.run({ id: e.id, mood: e.mood, note: e.note, created_at: t.toISOString() });
      }
    });
  }

  const taskCount = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  if (taskCount > 0) return;

  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO tasks
      (id, source, external_id, title, note, project, tag, estimate_min, due, lane, big_rock, done_at, created_at, updated_at)
    VALUES
      (:id, :source, :external_id, :title, :note, :project, :tag, :estimate_min, :due, :lane, :big_rock, NULL, :created_at, :updated_at)
  `);
  const insertInbox = db.prepare(`
    INSERT OR IGNORE INTO inbox_items (id, source, external_id, title, triaged_to, created_at)
    VALUES (:id, :source, :external_id, :title, NULL, :created_at)
  `);
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO calendar_events (id, title, start_min, end_min, kind, color)
    VALUES (:id, :title, :start_min, :end_min, :kind, :color)
  `);
  const insertMeta = db.prepare(`
    INSERT OR REPLACE INTO calendar_meta (id, account, synced_min_ago, day_start_min, day_end_min)
    VALUES (1, :account, :synced_min_ago, :day_start_min, :day_end_min)
  `);
  const insertWeek = db.prepare(`
    INSERT OR IGNORE INTO week_glance (position, day, date, count, load, is_today, is_past)
    VALUES (:position, :day, :date, :count, :load, :is_today, :is_past)
  `);
  const insertAnnual = db.prepare(`
    INSERT OR IGNORE INTO goals_annual (id, title, color, intent, target, progress, trend)
    VALUES (:id, :title, :color, :intent, :target, :progress, :trend)
  `);
  const insertQuarterly = db.prepare(`
    INSERT OR IGNORE INTO goals_quarterly (id, parent, title, progress, weeks_left)
    VALUES (:id, :parent, :title, :progress, :weeks_left)
  `);
  const insertMonthly = db.prepare(`
    INSERT OR IGNORE INTO goals_monthly (id, parent, title, progress, next_step, linked_task_id)
    VALUES (:id, :parent, :title, :progress, :next_step, :linked_task_id)
  `);
  const now = nowIso();
  runTx(() => {
    for (const t of TASKS_SEED) {
      insertTask.run({ ...t, external_id: null, created_at: now, updated_at: now });
    }
    for (const it of INBOX_SEED) {
      insertInbox.run({ ...it, external_id: null, created_at: now });
    }
    for (const ev of CALENDAR_EVENTS_SEED) insertEvent.run(ev);
    insertMeta.run({
      account: "jordan@reyes.studio",
      synced_min_ago: 2,
      day_start_min: 8 * 60 + 30,
      day_end_min: 18 * 60 + 30,
    });
    for (const w of WEEK_SEED) insertWeek.run(w);
    for (const g of GOALS_SEED.annual)    insertAnnual.run(g);
    for (const g of GOALS_SEED.quarterly) insertQuarterly.run(g);
    for (const g of GOALS_SEED.monthly)   insertMonthly.run(g);
  });

  console.log("[seed] Inserted seed data into empty DB.");
}
