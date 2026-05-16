import type { Connector, UnifiedTask } from "./types.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

const NOTION_VERSION = "2022-06-28";

// Notion DBs are user-defined — the only guaranteed shape is exactly one Title property.
// We extract the title; everything else is best-effort. Pull all non-archived rows;
// the user marks them done in our dashboard.
type NotionPage = {
  id: string;
  url?: string;
  archived?: boolean;
  properties?: Record<string, unknown>;
};

function extractTitle(properties: Record<string, unknown> | undefined): string {
  if (!properties) return "(untitled)";
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? "").join("");
      if (text) return text;
    }
  }
  return "(untitled)";
}

// Notion task DBs vary, so we collect every `rich_text` property and concatenate
// them. The longest single field is usually the description; smaller fields
// like "Status notes" still add useful context for the detail panel.
function extractNote(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) return undefined;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(properties)) {
    const prop = value as { type?: string; rich_text?: Array<{ plain_text?: string }> };
    if (prop?.type === "rich_text" && Array.isArray(prop.rich_text)) {
      const text = prop.rich_text.map((t) => t.plain_text ?? "").join("").trim();
      if (text) chunks.push(`${name}: ${text}`);
    }
  }
  return chunks.length ? chunks.join("\n\n") : undefined;
}

export const notionConnector: Connector = {
  name: "notion",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_TASKS_DB_ID);
  },

  async sync() {
    const token = process.env.NOTION_API_KEY!;
    const dbId = process.env.NOTION_TASKS_DB_ID!;

    let cursor: string | undefined;
    const tasks: UnifiedTask[] = [];

    do {
      const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        results?: NotionPage[];
        next_cursor?: string | null;
        has_more?: boolean;
      };

      for (const page of data.results ?? []) {
        if (page.archived) continue;
        tasks.push({
          externalId: page.id,
          title: extractTitle(page.properties),
          note: extractNote(page.properties),
          // Notion API returns a fully-qualified page URL — preferred over
          // reconstructing it from the workspace slug + id.
          url: page.url,
        });
      }

      cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
    } while (cursor);

    upsertTasksFromSource("notion", tasks);
  },

  // Notion DB schemas are user-defined, so we can't reliably toggle a
  // checkbox/status property without knowing its name. Archive the page
  // instead — universal, reversible via the Notion trash UI, and matches
  // what most people mean by "complete" (it disappears from the DB view).
  async setDone(externalId: string, done: boolean) {
    const token = process.env.NOTION_API_KEY;
    if (!token) throw new Error("NOTION_API_KEY not set");
    const res = await fetch(`https://api.notion.com/v1/pages/${externalId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: done }),
    });
    if (!res.ok) throw new Error(`Notion setDone ${res.status}: ${await res.text()}`);
  },
};
