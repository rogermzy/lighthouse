// Phase 1: data is fetched from the local backend (Hono + SQLite at :3000).
// Static config (SOURCES, TAGS, formatters, getSuggestions) stays client-side.
// TASKS/WEEK/CALENDAR/FREE_*/GOALS are filled in via window.__dataReady.

const SOURCES = {
  clickup:    { label: "ClickUp",    color: "#7B68EE", glyph: "C" },
  workflowy:  { label: "Workflowy",  color: "#3B82F6", glyph: "W" },
  linear:     { label: "Linear",     color: "#5E6AD2", glyph: "L" },
  things:     { label: "Things",     color: "#2B7FFF", glyph: "T" },
  notion:     { label: "Notion",     color: "#191919", glyph: "N" },
  email:      { label: "Mail",       color: "#D97757", glyph: "@" },
  gcal:       { label: "Calendar",   color: "#3B7B5E", glyph: "▦" },
  gtasks:     { label: "Google Tasks", color: "#4285F4", glyph: "✓" },
  self:       { label: "Brain dump", color: "#6B7464", glyph: "•" },
  agent:      { label: "Agent",      color: "#7C4DFF", glyph: "✦" },
};

const TAGS = {
  deep:     { label: "deep work",  color: "#B8442E" },
  shallow:  { label: "shallow",    color: "#8A7530" },
  admin:    { label: "admin",      color: "#4E6A55" },
  comms:    { label: "comms",      color: "#5E6AD2" },
  personal: { label: "personal",   color: "#B86B8E" },
  errand:   { label: "errand",     color: "#806B5B" },
};

// Interstitial journal — prompts shown as a guide above the composer.
// The MOODS list is the backend's source of truth (returned by /api/journal),
// populated below once __dataReady resolves.
const JOURNAL_PROMPTS = ["What just happened?", "What did I notice?", "What's next?"];
let MOODS = [];

// Visual themes. Each is a complete dictionary of CSS custom properties that
// override the :root defaults. Theme picker lives in Settings → Appearance and
// persists in localStorage. data-theme attribute on <html> drives a few
// theme-specific overrides in styles.css (e.g. halftone suppression for Apple).
const THEMES = {
  paper: {
    name: "Paper",
    description: "Warm cream + halftone — the original printed-poster aesthetic.",
    swatches: ["#f3efe6", "#fbf8f1", "#b8442e"],
    vars: {
      "--bg": "#f3efe6",
      "--paper": "#fbf8f1",
      "--paper-2": "#f7f3ea",
      "--ink": "#1a1714",
      "--ink-2": "#3b3631",
      "--muted": "#8a8278",
      "--muted-2": "#b8afa1",
      "--rule": "#e3dccd",
      "--rule-2": "#ece6d6",
      "--accent":   "#b8442e",
      "--accent-2": "#8a7530",
      "--accent-3": "#4e6a55",
      "--accent-4": "#5e6ad2",
      "--accent-5": "#b86b8e",
      "--halftone-opacity": "0.55",
      "--r-sm": "6px",
      "--r-md": "10px",
      "--r-lg": "14px",
      "--font-display": '"Geist", "Inter", sans-serif',
      "--font-body":    '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    },
  },
  apple: {
    name: "Apple",
    description: "Clean white surfaces, San Francisco type, electric blue. No texture.",
    swatches: ["#ffffff", "#fbfbfd", "#0071e3"],
    vars: {
      "--bg": "#ffffff",
      "--paper": "#ffffff",
      "--paper-2": "#fbfbfd",
      "--ink": "#1d1d1f",
      "--ink-2": "#424245",
      "--muted": "#86868b",
      "--muted-2": "#d2d2d7",
      "--rule": "#d2d2d7",
      "--rule-2": "#e8e8ed",
      "--accent":   "#0071e3",
      "--accent-2": "#ff9500",
      "--accent-3": "#34a853",
      "--accent-4": "#af52de",
      "--accent-5": "#ff2d55",
      "--halftone-opacity": "0",
      "--r-sm": "8px",
      "--r-md": "14px",
      "--r-lg": "18px",
      "--font-display": '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif',
      "--font-body":    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    },
  },
  dusk: {
    name: "Dusk",
    description: "Dark mode with warm ember accent — for late-night focus.",
    swatches: ["#1a1714", "#231f1a", "#d97757"],
    vars: {
      "--bg": "#1a1714",
      "--paper": "#231f1a",
      "--paper-2": "#1f1c18",
      "--ink": "#f4ecdb",
      "--ink-2": "#d7cdb8",
      "--muted": "#8a8278",
      "--muted-2": "#5b554c",
      "--rule": "#2c2823",
      "--rule-2": "#262219",
      "--accent":   "#d97757",
      "--accent-2": "#b8923c",
      "--accent-3": "#7a9b86",
      "--accent-4": "#8d96e0",
      "--accent-5": "#d490a8",
      "--halftone-opacity": "0.35",
      "--r-sm": "6px",
      "--r-md": "10px",
      "--r-lg": "14px",
      "--font-display": '"Geist", "Inter", sans-serif',
      "--font-body":    '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    },
  },
  things: {
    name: "Things",
    description: "Warm off-white, Things Blue, system type. Tight typography, no texture, soft borders.",
    swatches: ["#fafaf7", "#ffffff", "#1976d2"],
    vars: {
      "--bg": "#fafaf7",
      "--paper": "#ffffff",
      "--paper-2": "#f4f3ee",
      "--ink": "#1f1f1f",
      "--ink-2": "#4a4a4a",
      "--muted": "#8e8e93",
      "--muted-2": "#c7c7cc",
      "--rule": "#e5e5e0",
      "--rule-2": "#efeeea",
      "--accent":   "#1976d2",   // Things Blue
      "--accent-2": "#fec01d",   // yellow project tag
      "--accent-3": "#3cb44b",   // green
      "--accent-4": "#7c4dff",   // purple
      "--accent-5": "#ff3366",   // pink/red
      "--halftone-opacity": "0",
      "--r-sm": "5px",
      "--r-md": "10px",
      "--r-lg": "12px",
      "--font-display": '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
      "--font-body":    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    },
  },
  slate: {
    name: "Slate",
    description: "Cool grey + sage. Sober and modern — fewer warm tones.",
    swatches: ["#edeeec", "#f6f7f4", "#4e6a55"],
    vars: {
      "--bg": "#edeeec",
      "--paper": "#f6f7f4",
      "--paper-2": "#eef0ec",
      "--ink": "#171a18",
      "--ink-2": "#3a3d3b",
      "--muted": "#7d827e",
      "--muted-2": "#abafac",
      "--rule": "#dadbd8",
      "--rule-2": "#e3e4e1",
      "--accent":   "#4e6a55",
      "--accent-2": "#5e6ad2",
      "--accent-3": "#b8442e",
      "--accent-4": "#8a7530",
      "--accent-5": "#b86b8e",
      "--halftone-opacity": "0.3",
      "--r-sm": "6px",
      "--r-md": "10px",
      "--r-lg": "14px",
      "--font-display": '"Geist", "Inter", sans-serif',
      "--font-body":    '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    },
  },
};
window.THEMES = THEMES;

// Placeholders — overwritten when /api/* responses arrive.
let TASKS = [];
let WEEK = [];
let CALENDAR = { account: "", syncedMinAgo: 0, dayStart: 8 * 60 + 30, dayEnd: 18 * 60 + 30, events: [], days: [] };
let FREE_BLOCKS = [];
let FREE_TOTAL = 0;
let BEST_BLOCK = { start: 8 * 60 + 30, end: 8 * 60 + 30 };
let GOALS = { year: "2026", quarter: "Q2", month: "May", annual: [], quarterly: [], monthly: [] };
let JOURNAL = [];
let JOURNAL_STREAK = 0;

function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h < 12 ? "am" : "pm";
  const h12 = ((h + 11) % 12) + 1;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,"0")}${ampm}`;
}
function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function todayLong(d = new Date()) {
  return `${DAY_NAMES[d.getDay()]} · ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}
function todayLongComma(d = new Date()) {
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}
function timeBasedGreeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return "Up early";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Late night";
}
function nowInMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

// Local fallback for "Suggest from goals" — Phase 4 will route this through the Claude agent.
function getSuggestions() {
  const expected = 0.6;
  const ranked = [...GOALS.monthly]
    .map(g => ({ ...g, deficit: expected - g.progress }))
    .sort((a, b) => b.deficit - a.deficit);
  return ranked.slice(0, 3).map(g => {
    const parent  = GOALS.quarterly.find(q => q.id === g.parent) || GOALS.annual.find(a => a.id === g.parent);
    const annual  = GOALS.annual.find(a => a.id === (parent?.parent || parent?.id));
    return {
      goal: g,
      quarter: parent && parent.id.startsWith("q") ? parent : null,
      annual,
      task: g.linkedTaskId ? TASKS.find(t => t.id === g.linkedTaskId) : null,
      reason: g.deficit > 0.2
        ? "Falling behind. A 25-min hit here moves the needle."
        : g.deficit > 0.05
        ? "Slightly off pace. Small momentum unlock."
        : "On pace. Keep the streak.",
    };
  });
}

Object.assign(window, { SOURCES, TAGS, JOURNAL_PROMPTS, fmtTime, fmtDuration, getSuggestions, todayLong, todayLongComma, timeBasedGreeting, nowInMinutes });

async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

window.__dataReady = (async () => {
  const [tasksRes, inboxRes, calRes, goalsRes, weekRes, profileRes, journalRes] = await Promise.all([
    fetchJson("/api/tasks"),
    fetchJson("/api/inbox"),
    fetchJson("/api/calendar/today"),
    fetchJson("/api/goals"),
    fetchJson("/api/week"),
    fetchJson("/api/profile"),
    fetchJson("/api/journal"),
  ]);

  TASKS = [...tasksRes, ...inboxRes];
  WEEK = weekRes;
  CALENDAR = calRes.calendar;
  FREE_BLOCKS = calRes.freeBlocks;
  FREE_TOTAL = calRes.freeTotal;
  BEST_BLOCK = calRes.bestBlock;
  GOALS = goalsRes;

  // Seed the doneSet from anything the backend reports as already completed
  // (done today, kept visible with strikethrough until tomorrow's roll-off).
  const initialDoneSet = new Set(
    tasksRes.filter(t => t.doneAt).map(t => t.id)
  );

  JOURNAL = journalRes.entries || [];
  JOURNAL_STREAK = journalRes.streak || 0;
  MOODS = journalRes.moods || [];

  Object.assign(window, { TASKS, WEEK, CALENDAR, FREE_BLOCKS, FREE_TOTAL, BEST_BLOCK, GOALS, JOURNAL, JOURNAL_STREAK, MOODS });
  window.PROFILE = profileRes;
  window.__initialDoneSet = initialDoneSet;
})();
