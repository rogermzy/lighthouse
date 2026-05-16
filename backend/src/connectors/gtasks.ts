import { google } from "googleapis";
import type { Connector, UnifiedTask } from "./types.js";
import { googleOAuthClient, isGoogleOAuthConfigured, hasGoogleTokens } from "../auth/oauth.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

// Match clickup's relativeDue shape — backend stores a short string the UI
// renders directly in the "due" pill. ISO strings from Tasks API come through
// in RFC 3339 (date-time); we collapse to local midnight diff.
function relativeDue(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  const days = Math.floor((d.getTime() - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getDay()];
  return "this week";
}

export const gtasksConnector: Connector = {
  name: "gtasks",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return isGoogleOAuthConfigured() && hasGoogleTokens();
  },

  async sync() {
    const auth = googleOAuthClient();
    const tasks = google.tasks({ version: "v1", auth });

    const listsRes = await tasks.tasklists.list({ maxResults: 100 });
    const lists = listsRes.data.items ?? [];

    const all: UnifiedTask[] = [];
    for (const list of lists) {
      if (!list.id) continue;
      const res = await tasks.tasks.list({
        tasklist: list.id,
        maxResults: 100,
        showCompleted: false,
        showHidden: false,
        showDeleted: false,
      });
      for (const t of res.data.items ?? []) {
        if (!t.id || !t.title) continue;
        all.push({
          // List ID prefixed so two tasks with the same id across lists don't
          // collide (Google Tasks ids are unique within a list, not across).
          externalId: `${list.id}:${t.id}`,
          title: t.title,
          note: t.notes?.trim() || undefined,
          project: list.title ?? undefined,
          due: relativeDue(t.due),
        });
      }
    }

    upsertTasksFromSource("gtasks", all);
  },

  // Google Tasks: PATCH the task with status: completed/needsAction. Our
  // externalId is "<listId>:<taskId>" because Tasks ids are unique within a
  // list, not globally.
  async setDone(externalId: string, done: boolean) {
    if (!isGoogleOAuthConfigured() || !hasGoogleTokens()) {
      throw new Error("Google OAuth not connected");
    }
    const sep = externalId.indexOf(":");
    if (sep < 0) throw new Error(`gtasks setDone: malformed externalId "${externalId}"`);
    const listId = externalId.slice(0, sep);
    const taskId = externalId.slice(sep + 1);

    const auth = googleOAuthClient();
    const tasksApi = google.tasks({ version: "v1", auth });
    await tasksApi.tasks.patch({
      tasklist: listId,
      task: taskId,
      requestBody: { status: done ? "completed" : "needsAction" },
    });
  },
};
