// Load .env before anything else so connector modules see the keys.
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, "..", ".env");
if (existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";

import { seedIfEmpty } from "./db/seed.js";
import { loadSettingsIntoEnv } from "./db/settings.js";
import { tasksApi } from "./api/tasks.js";
import { inboxApi } from "./api/inbox.js";
import { calendarApi } from "./api/calendar.js";
import { goalsApi } from "./api/goals.js";
import { weekApi } from "./api/week.js";
import { suggestApi } from "./api/suggest.js";
import { settingsApi } from "./api/settings.js";
import { syncApi } from "./api/sync.js";
import { profileApi } from "./api/profile.js";
import { journalApi } from "./api/journal.js";
import { authTokenApi } from "./api/auth.js";
import { v1Api } from "./api/v1.js";
import { metaApi } from "./api/meta.js";
import { isAgentConfigured } from "./agent/suggest.js";
import { startEnrichmentLoop, isEnrichmentConfigured } from "./agent/enrich.js";
import { authRouter, isGoogleOAuthConfigured, hasGoogleTokens } from "./auth/oauth.js";
import { startSync } from "./sync/runner.js";
import { gcalConnector } from "./connectors/gcal.js";
import { gmailConnector } from "./connectors/gmail.js";
import { gtasksConnector } from "./connectors/gtasks.js";
import { clickupConnector } from "./connectors/clickup.js";
import { notionConnector } from "./connectors/notion.js";
import { thingsConnector } from "./connectors/things.js";
import { workflowyConnector } from "./connectors/workflowy.js";
import { flomoConnector } from "./connectors/flomo.js";

const FRONTEND_ROOT = join(__dirname, "..", "..");

seedIfEmpty();
loadSettingsIntoEnv();

const app = new Hono();

app.route("/api/tasks", tasksApi);
app.route("/api/inbox", inboxApi);
app.route("/api/calendar", calendarApi);
app.route("/api/goals", goalsApi);
app.route("/api/week", weekApi);
app.route("/api/suggest", suggestApi);
app.route("/api/settings", settingsApi);
app.route("/api/sync", syncApi);
app.route("/api/profile", profileApi);
app.route("/api/journal", journalApi);
app.route("/api/auth", authTokenApi);
app.route("/api/v1", v1Api);
app.route("/api/meta", metaApi);
app.route("/auth", authRouter);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".jsx":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

app.get("/*", async (c) => {
  const reqPath = c.req.path === "/" ? "/Lighthouse Dashboard.html" : c.req.path;
  const decoded = decodeURIComponent(reqPath);
  const safe = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(FRONTEND_ROOT, safe);

  if (!filePath.startsWith(FRONTEND_ROOT)) return c.notFound();

  try {
    const s = await stat(filePath);
    if (!s.isFile()) return c.notFound();
  } catch {
    return c.notFound();
  }

  const ext = safe.slice(safe.lastIndexOf(".")).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";
  const body = await readFile(filePath);
  return c.body(body, 200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
});

const PORT = Number(process.env.PORT ?? 3000);

serve(
  { fetch: app.fetch, port: PORT, hostname: "127.0.0.1" },
  (info) => {
    console.log(`[lighthouse] http://127.0.0.1:${info.port}`);
    console.log(`[lighthouse] frontend: ${FRONTEND_ROOT}`);
    console.log(`[lighthouse] agent: ${isAgentConfigured() ? "ready" : "no key (fallback math)"}`);

    if (isGoogleOAuthConfigured()) {
      if (hasGoogleTokens()) {
        console.log(`[lighthouse] google: connected`);
      } else {
        console.log(`[lighthouse] google: keys set, visit /auth/google to connect`);
      }
    } else {
      console.log(`[lighthouse] google: not configured`);
    }

    // Every connector's isEnabled() runs on each tick, so the runner activates
    // sources as soon as their keys appear in process.env — no restart needed
    // when a key is saved via the settings page.
    const allConnectors = [gcalConnector, gmailConnector, gtasksConnector, clickupConnector, notionConnector, thingsConnector, workflowyConnector, flomoConnector];
    Promise.all(
      [clickupConnector, notionConnector, thingsConnector, workflowyConnector, flomoConnector].map(async (c) => {
        const on = await c.isEnabled();
        console.log(`[lighthouse] ${c.name}: ${on ? "enabled" : "not configured"}`);
      })
    ).then(() => {
      startSync(allConnectors);
      // Background loop that assigns themes + goal alignment + weight to each
      // synced task. Runs every 5 min; the content-hash cache makes no-op
      // ticks free.
      console.log(`[lighthouse] enrichment: ${isEnrichmentConfigured() ? "ready" : "disabled (no key)"}`);
      startEnrichmentLoop();
    });
  }
);
