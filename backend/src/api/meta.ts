import { Hono } from "hono";

// Canonical enums for the API. The /api/v1 routes validate against these
// (mirrored there as Sets); the Settings → API documentation page fetches
// this endpoint so the on-screen reference can't drift from the wire reality.
const LANES   = ["now", "today", "this_week", "this_month", "backlog"];
const SOURCES = ["clickup", "workflowy", "linear", "things", "notion", "email", "gcal", "gtasks", "self", "agent"];
const TAGS    = ["deep", "shallow", "admin", "comms", "personal", "errand"];
const MOODS   = ["calm", "focused", "scattered", "drained", "buzzy", "low"];
const DUE_KEYWORDS = [
  "today", "tomorrow", "soon", "this week", "next week",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
];

export const metaApi = new Hono();

metaApi.get("/", (c) =>
  c.json({
    lanes: LANES,
    sources: SOURCES,
    tags: TAGS,
    moods: MOODS,
    dueKeywords: DUE_KEYWORDS,
    todayCap: 3,
    limits: { title: 500, note: 2000, estimateMin: 600 },
  })
);
