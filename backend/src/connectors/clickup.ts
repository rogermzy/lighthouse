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

  // ClickUp status names are list-specific. We GET the task to learn its
  // list_id, then look up that list's statuses to find one with type:"closed"
  // (for done) or type:"open" (for reopen), then PUT the right name. List
  // statuses are cached in memory — they almost never change, so a fresh
  // process restart is enough to pick up workflow edits.
  // Falls back to `archived: true/false` if status discovery fails (rare).
  async setDone(externalId: string, done: boolean) {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) throw new Error("CLICKUP_API_TOKEN not set");

    try {
      const taskRes = await fetch(`${BASE}/task/${encodeURIComponent(externalId)}`, {
        headers: { Authorization: token },
      });
      if (!taskRes.ok) throw new Error(`task ${taskRes.status}`);
      const task = (await taskRes.json()) as { list?: { id?: string } };
      const listId = task.list?.id;
      if (!listId) throw new Error("no list_id on task");

      const statuses = await fetchListStatuses(listId, token);
      const target = done ? statuses.closed : statuses.open;
      if (!target) throw new Error(`no ${done ? "closed" : "open"} status on list ${listId}`);

      const res = await fetch(`${BASE}/task/${encodeURIComponent(externalId)}`, {
        method: "PUT",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) throw new Error(`ClickUp setDone ${res.status}: ${await res.text()}`);
    } catch (err) {
      // Status lookup failed — fall back to archive so the action isn't lost.
      console.warn(`[clickup] setDone status path failed (${String(err)}), falling back to archive`);
      const res = await fetch(`${BASE}/task/${encodeURIComponent(externalId)}`, {
        method: "PUT",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ archived: done }),
      });
      if (!res.ok) throw new Error(`ClickUp archive fallback ${res.status}: ${await res.text()}`);
    }
  },
};

// list_id → {closed, open} status names. Lives for the life of the process;
// status workflows are stable enough that re-fetching every tick would be
// wasted work, and a server restart picks up any edits.
const listStatusCache = new Map<string, { closed: string; open: string }>();

async function fetchListStatuses(
  listId: string,
  token: string,
): Promise<{ closed: string; open: string }> {
  const cached = listStatusCache.get(listId);
  if (cached) return cached;

  const res = await fetch(`${BASE}/list/${listId}`, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`list ${listId}: ${res.status}`);
  const data = (await res.json()) as {
    statuses?: Array<{ status: string; type: string }>;
  };
  const statuses = data.statuses ?? [];
  const closed = statuses.find((s) => s.type === "closed")?.status ?? "";
  const open = statuses.find((s) => s.type === "open")?.status ?? "";
  const result = { closed, open };
  // Cache even when one side is missing — fallback to archive will handle it
  // without a second lookup attempt.
  listStatusCache.set(listId, result);
  return result;
}
