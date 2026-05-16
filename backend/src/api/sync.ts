import { Hono } from "hono";
import { db, nowIso } from "../db/client.js";
import type { Connector } from "../connectors/types.js";
import { gcalConnector } from "../connectors/gcal.js";
import { gmailConnector } from "../connectors/gmail.js";
import { gtasksConnector } from "../connectors/gtasks.js";
import { clickupConnector } from "../connectors/clickup.js";
import { notionConnector } from "../connectors/notion.js";
import { thingsConnector } from "../connectors/things.js";
import { workflowyConnector } from "../connectors/workflowy.js";

const BY_NAME: Record<string, Connector> = {
  gcal:      gcalConnector,
  gmail:     gmailConnector,
  gtasks:    gtasksConnector,
  clickup:   clickupConnector,
  notion:    notionConnector,
  things:    thingsConnector,
  workflowy: workflowyConnector,
};

const upsertSync = db.prepare(`
  INSERT INTO sync_state (source, last_pulled_at, last_error, cursor)
  VALUES (:source, :now, NULL, NULL)
  ON CONFLICT(source) DO UPDATE SET last_pulled_at = excluded.last_pulled_at, last_error = NULL
`);
const markError = db.prepare(`
  INSERT INTO sync_state (source, last_pulled_at, last_error, cursor)
  VALUES (:source, NULL, :err, NULL)
  ON CONFLICT(source) DO UPDATE SET last_error = excluded.last_error
`);

export const syncApi = new Hono();

syncApi.get("/", async (c) => {
  const rows = db.prepare(
    "SELECT source, last_pulled_at, last_error FROM sync_state"
  ).all() as { source: string; last_pulled_at: string | null; last_error: string | null }[];
  const byName: Record<string, { last_pulled_at: string | null; last_error: string | null }> =
    Object.fromEntries(rows.map((r) => [r.source, r]));

  const statuses = await Promise.all(
    Object.entries(BY_NAME).map(async ([name, conn]) => ({
      source: name,
      enabled: await conn.isEnabled(),
      lastPulledAt: byName[name]?.last_pulled_at ?? null,
      lastError: byName[name]?.last_error ?? null,
    }))
  );
  return c.json({ syncs: statuses });
});

syncApi.post("/:source", async (c) => {
  const sourceName = c.req.param("source");
  const connector = BY_NAME[sourceName];
  if (!connector) return c.json({ error: "unknown source" }, 404);

  const enabled = await connector.isEnabled();
  if (!enabled) return c.json({ error: "connector not configured" }, 409);

  try {
    await connector.sync();
    upsertSync.run({ source: sourceName, now: nowIso() });
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markError.run({ source: sourceName, err: message });
    return c.json({ error: "sync failed", detail: message }, 502);
  }
});
