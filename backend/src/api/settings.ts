import { Hono } from "hono";
import { readAllSettings, writeSetting, deleteSetting } from "../db/settings.js";

type FieldDef = { secret: boolean; label: string; group: string; placeholder?: string };

// Allowlist. Anything outside this is silently ignored so the UI can't write
// arbitrary env vars into the running process.
const FIELDS: Record<string, FieldDef> = {
  ANTHROPIC_API_KEY:    { secret: true,  group: "anthropic", label: "API key",            placeholder: "sk-ant-api03-…" },

  GOOGLE_CLIENT_ID:     { secret: false, group: "google",    label: "OAuth client ID",    placeholder: "…apps.googleusercontent.com" },
  GOOGLE_CLIENT_SECRET: { secret: true,  group: "google",    label: "OAuth client secret" },
  GMAIL_TRIAGE_LABEL:   { secret: false, group: "google",    label: "Gmail label",        placeholder: "Triage" },

  CLICKUP_API_TOKEN:    { secret: true,  group: "clickup",   label: "Personal API token", placeholder: "pk_…" },
  CLICKUP_TEAM_ID:      { secret: false, group: "clickup",   label: "Team ID" },
  CLICKUP_USER_ID:      { secret: false, group: "clickup",   label: "User ID" },

  NOTION_API_KEY:       { secret: true,  group: "notion",    label: "Integration token",  placeholder: "secret_…" },
  NOTION_TASKS_DB_ID:   { secret: false, group: "notion",    label: "Tasks database ID" },

  WORKFLOWY_API_KEY:    { secret: true,  group: "workflowy", label: "API key",            placeholder: "wfy_…" },
  WORKFLOWY_PARENT_ID:  { secret: false, group: "workflowy", label: "Parent node",        placeholder: 'inbox · today · or a node id' },

  FLOMO_RSS_URL:        { secret: true,  group: "flomo",     label: "Private RSS URL",    placeholder: "https://flomoapp.com/users/…/rss/…/feed.xml" },
  FLOMO_WEBHOOK_URL:    { secret: true,  group: "flomo",     label: "Incoming webhook",   placeholder: "https://flomoapp.com/iwh/…/…/" },
};

function maskValue(value: string): string {
  if (!value) return "";
  // 6 + 4 visible chars: anything ≤ 10 long would be fully revealed by the hint.
  if (value.length <= 10) return "…";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function describe(key: string, def: FieldDef, value: string | undefined) {
  const isSet = Boolean(value);
  return {
    key,
    group: def.group,
    label: def.label,
    placeholder: def.placeholder,
    secret: def.secret,
    isSet,
    // Never return the raw value for secrets — only a hint.
    value: !def.secret && isSet ? value : undefined,
    hint: def.secret && isSet ? maskValue(value!) : undefined,
  };
}

export const settingsApi = new Hono();

settingsApi.get("/", (c) => {
  const stored = readAllSettings();
  // Pull through process.env so values set via .env (and not yet copied to DB) still surface.
  const fields = Object.entries(FIELDS).map(([key, def]) =>
    describe(key, def, stored[key] ?? process.env[key])
  );
  return c.json({ fields });
});

settingsApi.put("/:key", async (c) => {
  const key = c.req.param("key");
  if (!FIELDS[key]) return c.json({ error: "unknown key" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!value) return c.json({ error: "value required (use DELETE to clear)" }, 400);

  writeSetting(key, value);
  return c.json(describe(key, FIELDS[key], value));
});

settingsApi.delete("/:key", (c) => {
  const key = c.req.param("key");
  if (!FIELDS[key]) return c.json({ error: "unknown key" }, 400);
  deleteSetting(key);
  return c.json(describe(key, FIELDS[key], undefined));
});
