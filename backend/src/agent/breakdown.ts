import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { getProfileContext } from "../api/profile.js";
import { MODEL, isAgentConfigured } from "./config.js";

type AnnualRow = {
  id: string; title: string; intent: string | null; context: string | null;
  target: string | null; progress: number; trend: string | null;
};
type QuarterlyRow = {
  id: string; parent: string | null; title: string; progress: number;
};
type MonthlyRow = {
  id: string; parent: string; title: string; progress: number;
};

type QuarterLabel = "Q1" | "Q2" | "Q3" | "Q4";
type MonthLabel =
  | "Jan" | "Feb" | "Mar" | "Apr" | "May" | "Jun"
  | "Jul" | "Aug" | "Sep" | "Oct" | "Nov" | "Dec";

export type TimeStatus = "past" | "current" | "future";

export type QuarterlyProposal = {
  quarter: QuarterLabel;
  status: TimeStatus;
  title: string;
  target: string;
  reasoning: string;
  alreadyExists: boolean;
  existingTitle?: string;
};
export type MonthlyProposal = {
  month: MonthLabel;
  status: TimeStatus;
  title: string;
  target: string;
  reasoning: string;
  alreadyExists: boolean;
  existingTitle?: string;
};
export type BreakdownResult = {
  annual: { id: string; title: string };
  context: { year: number; currentQuarter: QuarterLabel; currentMonth: MonthLabel };
  quarterly: QuarterlyProposal[];
  monthly: MonthlyProposal[];
};

const QUARTER_OF_MONTH: Record<number, QuarterLabel> = {
  0: "Q1", 1: "Q1", 2: "Q1",
  3: "Q2", 4: "Q2", 5: "Q2",
  6: "Q3", 7: "Q3", 8: "Q3",
  9: "Q4", 10: "Q4", 11: "Q4",
};
const MONTH_NAMES: MonthLabel[] = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_IN_QUARTER: Record<QuarterLabel, MonthLabel[]> = {
  Q1: ["Jan", "Feb", "Mar"],
  Q2: ["Apr", "May", "Jun"],
  Q3: ["Jul", "Aug", "Sep"],
  Q4: ["Oct", "Nov", "Dec"],
};

const QUARTER_ORDER: QuarterLabel[] = ["Q1", "Q2", "Q3", "Q4"];
// Last month index (0-based) of each quarter — used to find the quarter's
// end date for "days remaining" computation.
const QUARTER_END_MONTH: Record<QuarterLabel, number> = {
  Q1: 2, Q2: 5, Q3: 8, Q4: 11,
};

function quarterStatus(q: QuarterLabel, currentQuarter: QuarterLabel): TimeStatus {
  const qIdx = QUARTER_ORDER.indexOf(q);
  const cIdx = QUARTER_ORDER.indexOf(currentQuarter);
  if (qIdx < cIdx) return "past";
  if (qIdx === cIdx) return "current";
  return "future";
}

function monthStatus(m: MonthLabel, currentMonth: MonthLabel): TimeStatus {
  const mIdx = MONTH_NAMES.indexOf(m);
  const cIdx = MONTH_NAMES.indexOf(currentMonth);
  if (mIdx < cIdx) return "past";
  if (mIdx === cIdx) return "current";
  return "future";
}

function daysRemainingInQuarter(now: Date, q: QuarterLabel): number {
  // Last day of the quarter's end month — `new Date(y, m+1, 0)` returns
  // the 0th day of the next month, which is the last day of the current.
  const endDate = new Date(now.getFullYear(), QUARTER_END_MONTH[q] + 1, 0, 23, 59, 59);
  const diffMs = endDate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export const isBreakdownConfigured = isAgentConfigured;

const BREAKDOWN_TOOL: Anthropic.Tool = {
  name: "return_breakdown",
  description:
    "Return the proposed quarterly and monthly milestones for the time remaining in the year. ONLY include the current quarter and any future quarters — never the past. Same for monthly: only current and future months in the current quarter.",
  input_schema: {
    type: "object",
    properties: {
      quarterly: {
        type: "array",
        description: "MUST contain one entry per remaining quarter (current + future only) — never empty unless there are no remaining quarters. If today is in Q2, return exactly 3 entries (Q2, Q3, Q4). If today is in Q4, return exactly 1 entry (Q4). Whether or not the user has existing milestones for those quarters doesn't matter — always propose; the alreadyExists flag is set server-side from the row's metadata, and the user will see both their existing milestone and your alternative side-by-side. Never include past quarters.",
        items: {
          type: "object",
          properties: {
            quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] },
            status: {
              type: "string",
              enum: ["current", "future"],
              description: "Either 'current' (the quarter we're in now) or 'future' (an upcoming quarter). Past quarters must not appear in this array at all.",
            },
            title: {
              type: "string",
              description: "Short forward-looking milestone title, sentence case, no trailing punctuation. No retrospective framing.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like — concrete and verifiable. For the current quarter, scope strictly to what's achievable in the remaining days/weeks (the user message tells you how many). Don't propose work that would have needed the full 13 weeks.",
            },
            reasoning: {
              type: "string",
              description: "Why this is the right next step toward the annual goal in the time available. One sentence.",
            },
          },
          required: ["quarter", "status", "title", "target", "reasoning"],
        },
      },
      monthly: {
        type: "array",
        description: "MUST contain one entry per remaining month in the CURRENT quarter (current month + any future months still ahead in this quarter) — never empty unless there are no remaining months. If today is in the last month of the quarter, return exactly 1 entry. Always propose for every remaining month even if the user has existing milestones there. Never include past months.",
        items: {
          type: "object",
          properties: {
            month: {
              type: "string",
              enum: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            },
            status: {
              type: "string",
              enum: ["current", "future"],
              description: "Either 'current' (the month we're in now) or 'future' (an upcoming month in the current quarter). Past months must not appear.",
            },
            title: {
              type: "string",
              description: "Short forward-looking milestone title, sentence case.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like this month — scoped to the remaining time. For the current month, scope to the remaining days specifically (the user message tells you how many).",
            },
            reasoning: {
              type: "string",
              description: "Why this month's milestone is the right next step in the time available. One sentence.",
            },
          },
          required: ["month", "status", "title", "target", "reasoning"],
        },
      },
    },
    required: ["quarterly", "monthly"],
  },
};

const SYSTEM_PROMPT = `You are the planning brain inside Lighthouse, a calm dashboard for an ADHD-aware user.

Your job: take a yearly goal and propose a forward-only plan for the time remaining in the year. Quarterly milestones for the current quarter and any future quarters; monthly milestones for the current month and any future months in the current quarter. The user reviews and checks what to commit.

TIME AWARENESS (the most important rule):
- DO NOT propose anything for past quarters or past months. Those are over. Pretend they don't exist.
- DO start planning from today's date forward.
- DO respect the actual time remaining. The user message tells you how many days are left in the year, the current quarter, and the current month. Scope every proposal to fit that window.
- DO scope the current quarter's proposal to what's achievable in the remaining weeks — NOT what would have needed the full 13-week quarter. If only 2 weeks remain in Q2, don't propose a quarter-sized milestone there.
- DO scope the current month's proposal to the remaining days. If today is the 25th, don't propose a full-month deliverable.

Other principles:
- Each milestone should be a noticeable step forward, ordered so completing them in sequence ladders cleanly to the annual goal.
- Monthly milestones should be specific enough that "done" is unambiguous, and small enough to actually ship in the time available.
- Match the user's existing intent and target language when given.
- Always propose for every remaining quarter and month — never return an empty array. If the user has already set a milestone for a given slot, your proposal for that slot should be a sensible *alternative* the user can compare against; don't skip the slot. Don't reference the existing milestone in your reasoning; just propose the best fresh take.
- Avoid corporate filler ("alignment", "strategic", "leverage"). Write the way a thoughtful friend would describe the next step.

Always call return_breakdown exactly once. Do not ask clarifying questions — work with what you have.`;

function pickAnnual(annualId: string): AnnualRow | undefined {
  return db.prepare("SELECT * FROM goals_annual WHERE id = :id").get({ id: annualId }) as AnnualRow | undefined;
}

function pickExistingQuarterly(annualId: string): QuarterlyRow[] {
  return db.prepare("SELECT * FROM goals_quarterly WHERE parent = :id").all({ id: annualId }) as QuarterlyRow[];
}

function pickExistingMonthly(quarterlyIds: string[]): MonthlyRow[] {
  if (quarterlyIds.length === 0) return [];
  const placeholders = quarterlyIds.map((_, i) => `:p${i}`).join(",");
  const params = Object.fromEntries(quarterlyIds.map((id, i) => [`p${i}`, id]));
  return db.prepare(`SELECT * FROM goals_monthly WHERE parent IN (${placeholders})`).all(params) as MonthlyRow[];
}

function pickOtherAnnuals(annualId: string): AnnualRow[] {
  return db.prepare("SELECT * FROM goals_annual WHERE id != :id").all({ id: annualId }) as AnnualRow[];
}

// Heuristic mapping from a quarterly title (e.g. "Q2: ship MVP", "Q3 — launch")
// to its quarter label. We don't store the quarter directly, so we infer.
function inferQuarter(title: string): QuarterLabel | null {
  const m = title.match(/\bQ([1-4])\b/i);
  if (m) return `Q${m[1]}` as QuarterLabel;
  return null;
}

// Similarly for monthly titles ("May: ...", "January push").
function inferMonth(title: string): MonthLabel | null {
  const lower = title.toLowerCase();
  for (const m of MONTH_NAMES) {
    if (lower.includes(m.toLowerCase())) return m;
  }
  const full = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (let i = 0; i < full.length; i++) {
    if (lower.includes(full[i])) return MONTH_NAMES[i];
  }
  return null;
}

export async function runBreakdownAgent(
  annualId: string,
  refinement?: string,
): Promise<BreakdownResult> {
  if (!isBreakdownConfigured()) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const annual = pickAnnual(annualId);
  if (!annual) throw new Error(`annual goal ${annualId} not found`);

  const existingQ = pickExistingQuarterly(annualId);
  const existingM = pickExistingMonthly(existingQ.map((q) => q.id));
  const otherAnnuals = pickOtherAnnuals(annualId);

  const now = new Date();
  const year = now.getFullYear();
  const currentQuarter = QUARTER_OF_MONTH[now.getMonth()];
  const currentMonth = MONTH_NAMES[now.getMonth()];
  const daysLeftInQuarter = daysRemainingInQuarter(now, currentQuarter);
  const weeksLeftInQuarter = Math.max(1, Math.round(daysLeftInQuarter / 7));
  // Days remaining in the year + the current month — used so the prompt
  // gives the agent the real planning horizon and it doesn't propose
  // 12-month milestones in late November.
  const endOfYear  = new Date(year, 11, 31, 23, 59, 59);
  const endOfMonth = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);
  const daysLeftInYear  = Math.max(0, Math.ceil((endOfYear.getTime()  - now.getTime()) / 86_400_000));
  const daysLeftInMonth = Math.max(0, Math.ceil((endOfMonth.getTime() - now.getTime()) / 86_400_000));
  // Lists of quarters and months we'll actually plan for (current + future).
  const futureQuarters = QUARTER_ORDER.filter(
    (q) => QUARTER_ORDER.indexOf(q) >= QUARTER_ORDER.indexOf(currentQuarter)
  );
  const futureMonthsInQuarter = MONTHS_IN_QUARTER[currentQuarter].filter(
    (m) => MONTH_NAMES.indexOf(m) >= MONTH_NAMES.indexOf(currentMonth)
  );

  // Build "what already exists" context for the prompt.
  const existingByQ = new Map<QuarterLabel, QuarterlyRow>();
  for (const q of existingQ) {
    const label = inferQuarter(q.title);
    if (label && !existingByQ.has(label)) existingByQ.set(label, q);
  }
  const existingByM = new Map<MonthLabel, MonthlyRow>();
  for (const m of existingM) {
    const label = inferMonth(m.title);
    if (label && !existingByM.has(label)) existingByM.set(label, m);
  }

  const existingLines: string[] = [];
  for (const q of (["Q1", "Q2", "Q3", "Q4"] as QuarterLabel[])) {
    const row = existingByQ.get(q);
    if (row) existingLines.push(`- ${q}: "${row.title}" (already set, ${Math.round(row.progress * 100)}% done)`);
  }
  for (const m of MONTHS_IN_QUARTER[currentQuarter]) {
    const row = existingByM.get(m);
    if (row) existingLines.push(`- ${m}: "${row.title}" (already set, ${Math.round(row.progress * 100)}% done)`);
  }

  const otherAnnualLines = otherAnnuals
    .map((g) => `- "${g.title}"${g.intent ? ` — ${g.intent}` : ""}`)
    .join("\n");

  // Forward-only quarter table — past quarters are omitted entirely so the
  // agent doesn't even see them as candidates. Same for months.
  const quarterStatusLines = futureQuarters.map((q) => {
    const months = MONTHS_IN_QUARTER[q].join("-");
    const status = quarterStatus(q, currentQuarter);
    const note = status === "current"
      ? ` ← CURRENT — only ~${daysLeftInQuarter} days / ~${weeksLeftInQuarter} weeks remaining. Scope to what fits.`
      : " ← FUTURE (full quarter ahead)";
    return `  ${q} (${months}): status="${status}"${note}`;
  }).join("\n");

  const monthStatusLines = futureMonthsInQuarter.map((m) => {
    const status = monthStatus(m, currentMonth);
    const note = status === "current"
      ? ` ← CURRENT month — only ~${daysLeftInMonth} days remaining. Scope to that.`
      : " ← FUTURE month";
    return `  ${m}: status="${status}"${note}`;
  }).join("\n");

  const profileContext = getProfileContext();
  const userMessage = [
    `Today is ${now.toISOString().slice(0, 10)}. The year is ${year}.`,
    ``,
    profileContext
      ? `About the user (standing context — applies to all goals):\n${profileContext}\n`
      : null,
    `PLANNING HORIZON (forward-only — do not propose anything for past quarters or months):`,
    `  • ${daysLeftInYear} days remaining in the year`,
    `  • ${daysLeftInQuarter} days remaining in the current quarter (${currentQuarter})`,
    `  • ${daysLeftInMonth} days remaining in the current month (${currentMonth})`,
    ``,
    `Quarters to plan for (${futureQuarters.length} total — current + future, past quarters omitted):`,
    quarterStatusLines,
    ``,
    `Months to plan for in the current quarter (${futureMonthsInQuarter.length} total — past months omitted):`,
    monthStatusLines,
    ``,
    `Annual goal to break down:`,
    `- Title: ${annual.title}`,
    annual.intent ? `- Intent: ${annual.intent}` : null,
    annual.target ? `- Target for the year: ${annual.target}` : null,
    `- Progress so far: ${Math.round(annual.progress * 100)}%`,
    annual.trend ? `- Trend: ${annual.trend}` : null,
    annual.context ? `\nContext for this goal (strategy, constraints, what's been tried):\n${annual.context}` : null,
    ``,
    existingLines.length > 0
      ? `Already-set milestones laddered to this goal:\n${existingLines.join("\n")}\n\nFor those slots, propose an alternative — not a duplicate. The user will see both and choose.`
      : `No existing milestones laddered to this goal yet.`,
    ``,
    otherAnnualLines
      ? `Other annual goals (peripheral context — don't propose milestones that conflict with these):\n${otherAnnualLines}`
      : null,
    ``,
    refinement
      ? `User refinement on a previous proposal: ${refinement}`
      : null,
    ``,
    `Now call return_breakdown. Quarterly array should contain exactly ${futureQuarters.length} entries (${futureQuarters.join(", ")}). Monthly array should contain exactly ${futureMonthsInQuarter.length} entries (${futureMonthsInQuarter.join(", ")}). Past quarters and past months must NOT appear.`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
    tools: [BREAKDOWN_TOOL],
    tool_choice: { type: "tool", name: "return_breakdown" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "return_breakdown",
  );
  if (!toolUse) throw new Error("agent did not call return_breakdown");

  // Defensive parse — the schema requires arrays for quarterly and monthly,
  // but Claude occasionally returns null, a single object, or a JSON string
  // instead. Coerce anything non-array to an empty array and log the raw
  // input so we can debug surprises rather than 500-ing.
  const rawInput = toolUse.input as Record<string, unknown> | null | undefined;
  let parsed: { quarterly?: unknown; monthly?: unknown } = rawInput ?? {};
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
  }
  const rawQuarterly = Array.isArray(parsed.quarterly) ? parsed.quarterly : [];
  const rawMonthly   = Array.isArray(parsed.monthly)   ? parsed.monthly   : [];

  if (rawQuarterly.length === 0 && rawMonthly.length === 0) {
    console.warn(
      "[breakdown] agent returned empty/malformed input:",
      JSON.stringify(rawInput).slice(0, 800),
    );
    throw new Error("agent returned no quarterly or monthly proposals");
  }

  const quarterlyProposals: QuarterlyProposal[] = (rawQuarterly as Array<{
    quarter: QuarterLabel; status?: TimeStatus; title: string; target: string; reasoning: string;
  }>)
    // Safety net: strip any past-quarter entries the agent may have
    // included despite the prompt. The server is authoritative on
    // past/current/future since that's a function of today's date.
    .filter((p) => quarterStatus(p.quarter, currentQuarter) !== "past")
    .map((p) => {
      const existing = existingByQ.get(p.quarter);
      return {
        quarter: p.quarter,
        status: quarterStatus(p.quarter, currentQuarter),
        title: p.title,
        target: p.target,
        reasoning: p.reasoning,
        alreadyExists: Boolean(existing),
        existingTitle: existing?.title,
      };
    });

  // Filter monthly to only the current quarter, then mark alreadyExists.
  const inQuarter = new Set(MONTHS_IN_QUARTER[currentQuarter]);
  const monthlyProposals: MonthlyProposal[] = (rawMonthly as Array<{
    month: MonthLabel; status?: TimeStatus; title: string; target: string; reasoning: string;
  }>)
    // Same safety net: drop past months and anything outside the current
    // quarter the agent may have invented.
    .filter((p) => inQuarter.has(p.month) && monthStatus(p.month, currentMonth) !== "past")
    .map((p) => {
      const existing = existingByM.get(p.month);
      return {
        month: p.month,
        status: monthStatus(p.month, currentMonth),
        title: p.title,
        target: p.target,
        reasoning: p.reasoning,
        alreadyExists: Boolean(existing),
        existingTitle: existing?.title,
      };
    });

  return {
    annual: { id: annual.id, title: annual.title },
    context: { year, currentQuarter, currentMonth },
    quarterly: quarterlyProposals,
    monthly: monthlyProposals,
  };
}
