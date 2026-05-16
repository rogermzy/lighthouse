import type { Connector, UnifiedTask } from "./types.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

const BASE = "https://api.clickup.com/api/v2";

type ClickUpTask = {
  id: string;
  name: string;
  description?: string;
  status?: { status?: string };
  due_date?: string | null;
  time_estimate?: number | null; // milliseconds
  list?: { name?: string };
};

function relativeDue(epochMs: string | null | undefined): string | undefined {
  if (!epochMs) return undefined;
  const ms = Number(epochMs);
  if (!Number.isFinite(ms)) return undefined;
  const now = new Date();
  const d = new Date(ms);
  // Floor so a task due tonight at 11pm (≈0.96 days after midnight) stays "today".
  const days = Math.floor((d.getTime() - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()];
  return "this week";
}

export const clickupConnector: Connector = {
  name: "clickup",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return Boolean(
      process.env.CLICKUP_API_TOKEN &&
      process.env.CLICKUP_TEAM_ID &&
      process.env.CLICKUP_USER_ID
    );
  },

  async sync() {
    const token = process.env.CLICKUP_API_TOKEN!;
    const teamId = process.env.CLICKUP_TEAM_ID!;
    const userId = process.env.CLICKUP_USER_ID!;

    const url = new URL(`${BASE}/team/${teamId}/task`);
    url.searchParams.set("include_closed", "false");
    url.searchParams.append("assignees[]", userId);

    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { tasks?: ClickUpTask[] };

    const tasks: UnifiedTask[] = (data.tasks ?? []).map((t) => ({
      externalId: t.id,
      title: t.name,
      note: t.description?.trim() || undefined,
      project: t.list?.name,
      estimateMin: t.time_estimate ? Math.round(t.time_estimate / 60_000) : undefined,
      due: relativeDue(t.due_date),
      url: `https://app.clickup.com/t/${t.id}`,
    }));

    upsertTasksFromSource("clickup", tasks);
  },

  // ClickUp status names are list-specific (every workspace customizes them),
  // so we can't reliably PUT a status name. Use `archived` instead — it's
  // a universal property, reversible from CU's UI, and hides the task from
  // default views which matches what "done" means in a personal triage app.
  async setDone(externalId: string, done: boolean) {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) throw new Error("CLICKUP_API_TOKEN not set");
    const res = await fetch(`${BASE}/task/${encodeURIComponent(externalId)}`, {
      method: "PUT",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ archived: done }),
    });
    if (!res.ok) throw new Error(`ClickUp setDone ${res.status}: ${await res.text()}`);
  },
};
