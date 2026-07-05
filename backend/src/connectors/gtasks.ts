import { google } from "googleapis";
import type { Connector, UnifiedTask } from "./types.js";
import { googleOAuthClient, isGoogleOAuthConfigured, hasGoogleTokens } from "../auth/oauth.js";
import { upsertTasksFromSource } from "../sync/reconcile.js";

// Match clickup's relativeDue shape — backend stores a short string the UI
// renders directly in the "due" pill. Google Tasks `due` is date-only,
// serialized as midnight UTC ("2026-07-02T00:00:00.000Z"). Parsing it as an
// instant would render a day early in negative-UTC-offset timezones, so pull
// the Y-M-D out of the string and build a LOCAL date before diffing.
function relativeDue(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const ymd = iso.slice(0, 10).split("-").map(Number);
  if (ymd.length !== 3 || ymd.some((n) => Number.isNaN(n))) return undefined;
  const [y, m, day] = ymd;
  const d = new Date(y, m - 1, day);
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

    // Page through every tasklist and every task within each — both endpoints
    // cap at 100/page. A partial list would make reconcile prune the rest, so
    // any page fetch failure throws (googleapis rejects) before we reconcile.
    const lists = [];
    let listsPageToken: string | undefined;
    do {
      const listsRes = await tasks.tasklists.list({ maxResults: 100, pageToken: listsPageToken });
      for (const l of listsRes.data.items ?? []) lists.push(l);
      listsPageToken = listsRes.data.nextPageToken ?? undefined;
    } while (listsPageToken);

    const all: UnifiedTask[] = [];
    for (const list of lists) {
      if (!list.id) continue;
      let pageToken: string | undefined;
      do {
        const res = await tasks.tasks.list({
          tasklist: list.id,
          maxResults: 100,
          showCompleted: false,
          showHidden: false,
          showDeleted: false,
          pageToken,
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
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
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
