import type { Connector, UnifiedTask } from "./types.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

const BASE = "https://workflowy.com/api/v1";

// Workflowy returns rich-text in `name` and `note` (HTML/markdown mix).
// We're rendering plain text in the task row, so strip tags + decode common
// entities. Leave any escaping the source intentionally did; we just want
// to remove markup noise.
function stripHtml(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type WorkflowyNode = {
  id: string;
  name: string;
  note?: string;
  completedAt?: number | null;
  createdAt?: number;
  modifiedAt?: number;
  data?: { layoutMode?: string };
};

export const workflowyConnector: Connector = {
  name: "workflowy",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return Boolean(process.env.WORKFLOWY_API_KEY);
  },

  async sync() {
    const apiKey = process.env.WORKFLOWY_API_KEY!;
    // Defaults to Workflowy's "inbox" location. User can override via settings
    // to a specific node id (the last segment of a node URL) or shortcuts like
    // "today" / "None" (root).
    const parentId = process.env.WORKFLOWY_PARENT_ID || "inbox";

    const url = new URL(`${BASE}/nodes`);
    url.searchParams.set("parent_id", parentId);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`Workflowy ${res.status}: ${await res.text()}`);

    // The API shape returns nodes either as a top-level array or under a
    // `nodes` key depending on endpoint — handle both defensively.
    const data: unknown = await res.json();
    const raw: WorkflowyNode[] = Array.isArray(data)
      ? (data as WorkflowyNode[])
      : ((data as { nodes?: WorkflowyNode[] }).nodes ?? []);

    // Skip completed items — they shouldn't appear as pending tasks. The
    // unified-tasks lane defaults to "ondeck"; the user can promote from there.
    const open = raw.filter((n) => !n.completedAt);

    const tasks: UnifiedTask[] = open.map((n) => ({
      externalId: n.id,
      title: stripHtml(n.name) || "(untitled)",
      note: stripHtml(n.note) || undefined,
      url: `https://workflowy.com/#/${n.id}`,
    }));

    upsertTasksFromSource("workflowy", tasks);
  },

  // Workflowy beta API: PATCH a node's completedAt. Pass a Unix-ms timestamp
  // to mark complete; null/undefined to reopen. (The sync filter above
  // already excludes `completedAt`-set nodes, so re-syncing won't undo a
  // local "done" — they'll just stop appearing from the source.)
  async setDone(externalId: string, done: boolean) {
    const apiKey = process.env.WORKFLOWY_API_KEY;
    if (!apiKey) throw new Error("WORKFLOWY_API_KEY not set");
    const res = await fetch(`${BASE}/nodes/${encodeURIComponent(externalId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ completedAt: done ? Date.now() : null }),
    });
    if (!res.ok) throw new Error(`Workflowy setDone ${res.status}: ${await res.text()}`);
  },
};
