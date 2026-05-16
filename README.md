# Lighthouse

A calm signal for ADHD brains — a single-user todo dashboard that pulls from your tools (Google Calendar, Gmail, Google Tasks, ClickUp, Notion, Workflowy, Things 3) and presents the day as a tight time-commitment ladder: **Now → Today → This week → Later**.

Local-first, runs entirely on `127.0.0.1`. Your data lives in a SQLite file on disk; the only outbound calls are to your source systems and (optionally) the Anthropic API for the "Suggest from goals" + task-enrichment agents.

## What's in here

- **Frontend** (`/`) — React 18 + Babel-standalone prototype served as static files. Single HTML entry: `Lighthouse Dashboard.html`.
- **Backend** (`/backend`) — Hono server on Node 24's built-in `node:sqlite`. One process handles HTTP, the sync loop, the OAuth dance, and the enrichment agent loop.

## Features

- **Lane ladder**: Now (singleton, the active 25-min focus block) ⊂ Today (hard cap of 3) ⊂ This week ⊂ Later. Drag-to-reorder within lanes. Now must come from Today; click ▶ Start to promote, ← Step away to demote. Server enforces both invariants.
- **Two-way source sync**: marking a task done in Lighthouse writes back to the source (ClickUp archive, Notion archive, GTasks status, Workflowy completedAt, Things AppleScript). New syncs land in Later — you triage explicitly.
- **Enrichment agent**: every synced task gets a `theme` cluster, `primary_goal_id`, and `weight` (0–1) via Claude Opus 4.7. Content-hash cache makes re-runs free when nothing's changed. Drives the This week grouping and the Today recommendations.
- **Goal-aware recommendations**: the empty slots in Today's three auto-fill with weighted picks from This week. One click pulls them in.
- **Task detail modal**: full description, theme + weight + reasoning, goal link, lane picker, **Open in {Source} ↗** back-link.
- **Calendar**: 4-day vertical grid, full 24 hours with the 1–7am sleep band compressed into a tagged "SLEEP" zone. Horizontal red line tracks the current minute across all columns.
- **Journal**: interstitial journaling with mood chips, inline edit + delete, streak counter, and a right-rail mini-calendar to browse past days.
- **Settings**: profile, theme picker (Paper / Apple / Dusk / Slate / Things), API key management, agent token for external integrations.

## Setup

See [`SETUP.md`](./SETUP.md) for the full walkthrough — Google Cloud OAuth, Anthropic API key, per-source connector keys.

Quick start (after configuring `backend/.env`):

```bash
cd backend
npm install
npm start
# → http://127.0.0.1:3000
```

## Architecture notes

- **Data shape**: one `tasks` table is the unified pool. External-source items upsert by `(source, external_id)`. Roger-owned fields (`lane`, `big_rock`, `tag`, `position`, `done_at`) are NEVER overwritten by sync; source-owned fields (`title`, `note`, `project`, `estimate_min`, `due`, `url`) refresh on every tick.
- **Transactions**: any read-then-write pattern (3-cap check, Now-singleton swap, position renumber) runs inside `BEGIN IMMEDIATE` so concurrent PATCHes can't both see the same pre-state.
- **Enrichment cache**: `task_enrichment.hash = sha1(title|project|note|goalsSignature)`. Editing a goal shifts the signature and naturally invalidates everything.
- **Trust model**: localhost-only personal app. Bearer-token guard on the `/api/v1/*` write endpoints (for external agents); no auth on the human-facing `/api/*` routes (same-origin from the dashboard).

## Tech choices

- Hono over Express — lighter, native fetch types, runs anywhere.
- `node:sqlite` (Node 24+) over better-sqlite3 — no native build step.
- Babel-standalone in the browser over a Vite build — kept the prototype simple; a Vite migration is an obvious follow-up.
- Anthropic SDK for the two agents; Opus 4.7 for both (effort tuned per task).
