import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";

const MODEL = "claude-opus-4-7";

type AnnualRow = {
  id: string; title: string; intent: string | null; target: string | null;
  progress: number; trend: string | null;
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

export function isBreakdownConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const BREAKDOWN_TOOL: Anthropic.Tool = {
  name: "return_breakdown",
  description:
    "Return the proposed quarterly and monthly milestones. Always include exactly four quarterly entries (Q1–Q4) and exactly three monthly entries covering the current quarter.",
  input_schema: {
    type: "object",
    properties: {
      quarterly: {
        type: "array",
        description: "Exactly four entries — one per quarter (Q1, Q2, Q3, Q4) in order. Each MUST include the status field matching the time context in the user message.",
        items: {
          type: "object",
          properties: {
            quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] },
            status: {
              type: "string",
              enum: ["past", "current", "future"],
              description: "Time status relative to today. The user message tells you which quarter falls into which bucket — match it exactly. Past = already happened; current = quarter we're in now; future = upcoming.",
            },
            title: {
              type: "string",
              description: "Short milestone title, sentence case, no trailing punctuation. For past quarters, use retrospective tone ('Q1 focus: X'). For current/future, forward-looking.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like — concrete and verifiable when possible. For past quarters, what should have been the deliverable. For current, what's achievable in the remaining weeks (not what would have needed the full quarter).",
            },
            reasoning: {
              type: "string",
              description: "Why this is the right milestone for this quarter to ladder to the annual goal. One sentence.",
            },
          },
          required: ["quarter", "status", "title", "target", "reasoning"],
        },
      },
      monthly: {
        type: "array",
        description: "Exactly three entries — one per month in the CURRENT quarter only. Do not propose monthly milestones for past or future quarters. Each MUST include the status field matching whether that month is past, current, or future relative to today.",
        items: {
          type: "object",
          properties: {
            month: {
              type: "string",
              enum: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            },
            status: {
              type: "string",
              enum: ["past", "current", "future"],
              description: "Time status relative to today within the current quarter. Past months in the current quarter get a retrospective; the current month gets scoped to remaining days; future months get a forward-looking proposal.",
            },
            title: {
              type: "string",
              description: "Short milestone title, sentence case.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like this month — small enough to ship in 4 weeks. For the current month, scope to remaining days.",
            },
            reasoning: {
              type: "string",
              description: "Why this month's milestone is the right next step. One sentence.",
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

Your job: break a yearly goal into 4 quarterly milestones (Q1–Q4) and 3 monthly milestones for the current quarter. Each proposal you return is tagged with a time status — past, current, or future. The user reviews your proposal and checks the ones they want to commit.

TIME AWARENESS (most important rule):
The user message tells you which quarters/months are past, current, or future relative to today. You MUST respect this when planning:

- For PAST quarters/months (status: "past"): write a brief retrospective. One sentence summarizing what should have been the focus, in past tense. Do NOT propose forward-looking next steps. The user may skip these or use them as backfill records of what they actually shipped. Title can be retrospective ("Q1 focus: X" or "Apr push: Y").

- For the CURRENT quarter/month (status: "current"): scope the proposal to what's achievable in the time remaining. The user message tells you days/weeks left. Don't propose work that would have needed the full quarter — propose what fits the remaining window. Be honest: if there are 2 weeks left, don't propose a 2-month milestone.

- For FUTURE quarters/months (status: "future"): full forward-looking breakdown. Concrete next steps that ladder to the annual goal. These have the most planning headroom.

Other principles:
- Quarterly milestones should each be a noticeable step forward, ordered so completing them in sequence makes sense.
- Monthly milestones should be specific enough that "done" is unambiguous, and small enough to actually ship in 4 weeks (or fewer, for the current month).
- Match the user's existing intent and target language when given.
- Respect what already exists: if the user has already set a milestone for a given quarter or month, your proposal for that slot should be a sensible *alternative* — not a duplicate. Don't reference the existing one in your reasoning; just propose the best fresh take.
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

  // Explicit per-quarter and per-month status table so the agent doesn't have
  // to derive time relationships from the date — that's what we were burning
  // up there with Q1 planning happening in May.
  const quarterStatusLines = QUARTER_ORDER.map((q) => {
    const months = MONTHS_IN_QUARTER[q].join("-");
    const status = quarterStatus(q, currentQuarter);
    const note = status === "current"
      ? ` ← CURRENT (~${daysLeftInQuarter} days / ~${weeksLeftInQuarter} weeks remaining)`
      : status === "past" ? " ← PAST (already happened — retrospective only)" : " ← FUTURE";
    return `  ${q} (${months}): status="${status}"${note}`;
  }).join("\n");

  const monthStatusLines = MONTHS_IN_QUARTER[currentQuarter].map((m) => {
    const status = monthStatus(m, currentMonth);
    const note = status === "current"
      ? ` ← CURRENT month — scope to what's achievable in remaining days`
      : status === "past" ? " ← PAST month — retrospective only" : " ← FUTURE month";
    return `  ${m}: status="${status}"${note}`;
  }).join("\n");

  const userMessage = [
    `Today is ${now.toISOString().slice(0, 10)}. The year is ${year}.`,
    ``,
    `TIME CONTEXT — use this to set the status field on each proposal:`,
    quarterStatusLines,
    ``,
    `Months in the current quarter (${currentQuarter}):`,
    monthStatusLines,
    ``,
    `Annual goal to break down:`,
    `- Title: ${annual.title}`,
    annual.intent ? `- Intent: ${annual.intent}` : null,
    annual.target ? `- Target for the year: ${annual.target}` : null,
    `- Progress so far: ${Math.round(annual.progress * 100)}%`,
    annual.trend ? `- Trend: ${annual.trend}` : null,
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
    `Now call return_breakdown with four quarterly milestones (Q1, Q2, Q3, Q4) and three monthly milestones (${MONTHS_IN_QUARTER[currentQuarter].join(", ")}).`,
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
  }>).map((p) => {
    const existing = existingByQ.get(p.quarter);
    // Trust the server's status derivation over whatever the agent labelled
    // it — the agent's tag is just a hint to shape its prose; the actual
    // past/current/future identity is a function of today's date, not LLM
    // discretion.
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
    .filter((p) => inQuarter.has(p.month))
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
