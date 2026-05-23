# Lighthouse — agent guide

A single-user, local-first ADHD todo dashboard. Pulls from Google Calendar/Gmail/Tasks, ClickUp, Notion, Workflowy, Things 3, and flomo. Surfaces today as a tight **Now → Today → Week → Later** ladder.

Built by Roger Yin for personal use on `127.0.0.1`. Anyone running this is running it for themselves on their own machine — there is no multi-tenant story.

## If this is a first-time install

Detect: `backend/.env` and `backend/data.db` are both missing → this is a fresh checkout. Read `INSTALL.md` and walk the user through it.

Operating notes for the install flow:
- Be interactive. Ask the user for keys when you need them; don't make them copy-paste verification commands — run them yourself.
- Ask once which optional connectors they use (ClickUp / Notion / Workflowy / flomo / Things 3), then only walk through those. Skip everything else.
- Start the server in the background so you can keep running verify commands against `/api/sync` and `/api/calendar/today`.
- If something fails, debug it. The `lastError` field on `GET /api/sync` is usually the smoking gun.

## Common ops

| Want to | Run |
|---|---|
| Start in dev (auto-restart on file change) | `cd backend && npm run dev` |
| Start in foreground | `cd backend && npm start` → http://127.0.0.1:7373 |
| Check all connectors' health | `curl -s http://127.0.0.1:7373/api/sync \| jq` |
| Force-sync one source | `curl -X POST http://127.0.0.1:7373/api/sync/<source>` |
| Inspect today's calendar | `curl -s http://127.0.0.1:7373/api/calendar/today \| jq` |
| Open the UI | `open http://127.0.0.1:7373` |

Valid source names: `gcal`, `gmail`, `gtasks`, `clickup`, `notion`, `workflowy`, `things`.

## Architecture in 60 seconds

- **Frontend** (repo root): React 18 + Babel-standalone, no build step. `app.jsx`, `pages.jsx`, `data.jsx`, `styles.css`, `Lighthouse Dashboard.html`.
- **Backend** (`backend/`): Hono server on Node 24's built-in `node:sqlite`. One process handles HTTP, the sync loop, OAuth, and two Claude agents (enrichment + suggest).
- **Data model**: one `tasks` table is the unified pool. External items upsert by `(source, external_id)`. Roger-owned fields (`lane`, `position`, `big_rock`, `tag`) are NEVER overwritten by sync; source-owned fields (`title`, `note`, `project`, `estimate_min`, `due`, `url`) refresh every tick. `done_at` is special: sync may SET it when the source reports a task complete (so a task finished in the source shows as done here too), but never CLEARS one already set — `COALESCE(done_at, excluded.done_at)` — so a source can't resurrect a task Roger already checked off. Logic lives in `backend/src/sync/reconcile.ts`.
- **DB**: `backend/data.db` — SQLite WAL mode, single file. Holds tasks, journal, goals, enrichment cache, sync state. Read-then-write paths use `BEGIN IMMEDIATE` so concurrent PATCHes can't race.

## Files that matter when changing things

| To change | File |
|---|---|
| Lane caps, auto-advance, ordering | `backend/src/api/tasks.ts` |
| Calendar free-time computation | `backend/src/api/calendar.ts` |
| Per-connector sync / write-back | `backend/src/connectors/<name>.ts` |
| LLM agents | `backend/src/agent/{enrich,suggest}.ts` |
| Source-owned vs Roger-owned fields | `backend/src/sync/reconcile.ts` |
| Schema | `backend/src/db/schema.sql` + idempotent ALTERs in `backend/src/db/client.ts` |
| UI components | `pages.jsx` (most), `app.jsx` (root + Today/Now/Sidebar) |

## Watch-outs

- **Adding an index on a new column**: schema.sql runs before client.ts ALTERs, so `CREATE INDEX` on a freshly-added column belongs in `client.ts` after the ALTER, not in `schema.sql`.
- **Babel-in-browser turns `const` → `var`**: TDZ semantics are lost. If a `useMemo` references a state var declared later in the function body, you get `undefined.method()` instead of a ReferenceError. Declare state in the order it's read.
- **Anthropic SDK on Opus 4.7**: use `thinking: {type: "adaptive"}`, not `budget_tokens`. Forced `tool_choice` is incompatible with `thinking` — drop the thinking block when forcing a tool.
- **Lane names**: current taxonomy is `now` / `today` / `week` / `later`. Old names (`focus` / `ondeck` / `someday`) were renamed and migrated — don't reintroduce them.

## Connector gotchas

- **Google**: re-consent required if scopes are added. Current scopes: `calendar.events.readonly`, `gmail.readonly`, `tasks`. Symptom of stale token: `403 Insufficient Permission` in `lastError`.
- **ClickUp**: status names are list-specific. `setDone` discovers the list's `type:"closed"` status dynamically; falls back to archive if discovery fails. **`done` ≠ `closed`**: ClickUp status `type` is `open｜custom｜done｜closed`, and `include_closed=false` only filters out `type:"closed"`. A task in a `done`-type status (the usual "mark it done" action — sets `date_done` but leaves `date_closed` null) STAYS in the pull, so the connector reads `date_done`/`status.type` and reports completion via `UnifiedTask.doneAt`; reconcile then sets the local `done_at`. Without this, done-but-not-closed tasks linger as open forever.
- **Notion**: the integration must be explicitly shared with each database via the "···" → Connect to menu. Otherwise the API returns `object_not_found`.
- **Things 3**: Mac-only, shells out to `osascript`. First sync triggers a macOS Automation permission prompt.
- **flomo**: RSS pull needs flomo PRO. Webhook push tags every entry `#lighthouse` so the RSS pull skips re-importing it (circular-sync guard).

## Things that aren't here

- No build step on the frontend. Don't add Vite / webpack / a bundler unless explicitly asked.
- No tests yet. Verification is via `curl` against the API + manual UI smoke.
- No multi-tenant. Don't add `user_id` columns, auth middleware on `/api/*`, or per-user scoping. The bearer-token guard on `/api/v1/*` is for external agents only.
