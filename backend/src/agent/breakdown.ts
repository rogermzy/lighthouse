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

export type QuarterlyProposal = {
  quarter: QuarterLabel;
  title: string;
  target: string;
  reasoning: string;
  alreadyExists: boolean;
  existingTitle?: string;
};
export type MonthlyProposal = {
  month: MonthLabel;
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
        description: "Exactly four entries — one per quarter (Q1, Q2, Q3, Q4) in order.",
        items: {
          type: "object",
          properties: {
            quarter: { type: "string", enum: ["Q1", "Q2", "Q3", "Q4"] },
            title: {
              type: "string",
              description: "Short milestone title, sentence case, no trailing punctuation.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like — concrete and verifiable when possible.",
            },
            reasoning: {
              type: "string",
              description: "Why this is the right milestone for this quarter to ladder to the annual goal. One sentence.",
            },
          },
          required: ["quarter", "title", "target", "reasoning"],
        },
      },
      monthly: {
        type: "array",
        description: "Exactly three entries — one per month in the CURRENT quarter only. Do not propose monthly milestones for past or future quarters.",
        items: {
          type: "object",
          properties: {
            month: {
              type: "string",
              enum: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            },
            title: {
              type: "string",
              description: "Short milestone title, sentence case.",
            },
            target: {
              type: "string",
              description: "What 'done' looks like this month — should be small enough to ship in 4 weeks.",
            },
            reasoning: {
              type: "string",
              description: "Why this month's milestone is the right next step. One sentence.",
            },
          },
          required: ["month", "title", "target", "reasoning"],
        },
      },
    },
    required: ["quarterly", "monthly"],
  },
};

const SYSTEM_PROMPT = `You are the planning brain inside Lighthouse, a calm dashboard for an ADHD-aware user.

Your job: break a yearly goal into 4 quarterly milestones (Q1–Q4) and 3 monthly milestones for the current quarter. The user reviews your proposal and checks the ones they want to commit.

Principles:
- Quarterly milestones should each be a noticeable step forward, ordered so completing them in sequence makes sense.
- Monthly milestones should be specific enough that "done" is unambiguous, and small enough to actually ship in 4 weeks. Avoid month-sized planning theater ("plan the next phase"); aim for tangible output.
- Match the user's existing intent and target language when given.
- Respect what already exists: if the user has already set a milestone for a given quarter or month, your proposal for that slot should be a sensible *alternative* — not a duplicate. The user will see both and choose. Don't reference the existing one in your reasoning; just propose the best fresh take.
- Be honest about the past. For quarters that have already happened in the current year, your proposal can be a retrospective ("what should have been the focus") that the user can use as a backfill or skip. Mark these clearly in your reasoning.
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

  const userMessage = [
    `Today is ${now.toISOString().slice(0, 10)}. The current quarter is ${currentQuarter} of ${year} and the current month is ${currentMonth}.`,
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

  const input = toolUse.input as {
    quarterly?: Array<{ quarter: QuarterLabel; title: string; target: string; reasoning: string }>;
    monthly?: Array<{ month: MonthLabel; title: string; target: string; reasoning: string }>;
  };

  const quarterlyProposals: QuarterlyProposal[] = (input.quarterly ?? []).map((p) => {
    const existing = existingByQ.get(p.quarter);
    return {
      quarter: p.quarter,
      title: p.title,
      target: p.target,
      reasoning: p.reasoning,
      alreadyExists: Boolean(existing),
      existingTitle: existing?.title,
    };
  });

  // Filter monthly to only the current quarter, then mark alreadyExists.
  const inQuarter = new Set(MONTHS_IN_QUARTER[currentQuarter]);
  const monthlyProposals: MonthlyProposal[] = (input.monthly ?? [])
    .filter((p) => inQuarter.has(p.month))
    .map((p) => {
      const existing = existingByM.get(p.month);
      return {
        month: p.month,
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
