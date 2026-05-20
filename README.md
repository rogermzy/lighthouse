# Lighthouse

A calm signal for ADHD brains — a single-user todo dashboard that pulls from your tools (Google Calendar, Gmail, Google Tasks, ClickUp, Notion, Workflowy, Things 3, flomo) and presents the day as a tight time-horizon ladder: **Now → Today → This week → This month → Backlog**.

Local-first, runs entirely on `127.0.0.1`. Your data lives in a SQLite file on disk; the only outbound calls are to your source systems and (optionally) the Anthropic API for the four LLM agents (suggest, enrichment, goal breakdown, task breakdown).

## What's in here

- **Frontend** (`/`) — React 18 + Babel-standalone prototype served as static files. Single HTML entry: `Lighthouse Dashboard.html`.
- **Backend** (`/backend`) — Hono server on Node 24's built-in `node:sqlite`. One process handles HTTP, the sync loop, the OAuth dance, and the LLM agent loops.
- **Mac app** (`/mac-app`) — optional ~140KB native Swift wrapper. Spawns the Node server on launch, embeds the dashboard in a WKWebView, kills the server on quit. Real Dock icon, menu bar, Cmd+Q, launch-at-login toggle. See [`mac-app/README.md`](./mac-app/README.md).

## Two surfaces, separate jobs

- **Today page** = execution surface. Now (active 25-min focus block) + Today's three (committed) + Up next (queue for what fills the slots as you finish). Nothing else.
- **Tasks page** = planning surface. Brain dump (untriaged inflow) at top + the rest of your task pool, organized by **goal** (default) or by **lane** (toggle).

## Features

### Goal-task spine

- **Annual → Quarterly → Monthly** goal hierarchy with editable progress, intent, target, trend, and a free-form **context field per goal** (strategy, constraints, what's been tried) that LLM agents read on every run.
- **✨ Break it down** on annual goals — Claude Opus 4.7 proposes time-aware quarterly + monthly milestones for the remaining year. Forward-only (no retrospective backfill for past quarters). Already-existing milestones get surfaced as "already set" with a fresh alternative proposal alongside.
- **🌳 Break into tasks** on monthly milestones — agent proposes 3–7 concrete next-step tasks (action-verb-starting, pomodoro-bucket estimates, dependency-ordered) AND identifies existing tasks from your pool that already contribute to the milestone (so you can link them in place instead of duplicating work).
- **Linked-tasks expander** on each monthly milestone row in the Goals page — see "N tasks · M done" and click to reveal the list inline, with checkboxes that mark done in place.
- **Tasks page "By goal" view** (default) — section per annual goal grouping its monthly subsections, each listing the tasks linked via `primary_goal_id`. "Unlinked" section at the bottom for tasks not yet classified.

### Lane ladder (time-horizon based)

- **Now** (singleton, active focus block) ⊂ **Today** (hard cap of 3) ⊂ **This week** ⊂ **This month** ⊂ **Backlog**.
- **Quick-lane buttons** appear on row hover: `↑` promotes one step toward Today, `↓` demotes one step toward Backlog.
- **Pin** any This-week task with the 📌 button (5-pin cap). Pinned items sit at the top of the **Up next** queue on the Today page.
- **Lane decay** background job: This-week items untouched 7 days drop to This-month; This-month items untouched 30 days drop to Backlog. Pins clear automatically on decay.
- **Auto-queue on cap-full**: any "promote to Today" action (quick-lane, brain dump triage, Up Next + Pull) that hits the 3-cap automatically routes the task to This week + pinned, queuing it at the top of Up Next. Suggest accept uses an explicit DemoteModal swap instead.

### LLM agents (Claude Opus 4.7)

- **Enrichment** — every task gets a `theme` cluster, `primary_goal_id`, and `weight` (0–1). Content-hash cache makes re-runs free when nothing's changed. Drives Up Next ranking + goal grouping.
- **Suggest from goals** — picks three concrete next-step tasks for today's three. Reads goals tree, today's calendar, and recent completions. Per-row `+ Add` and `Accept all three` buttons commit.
- **Goal breakdown** — annual → quarterly + monthly. Time-aware, forward-only.
- **Task breakdown** — monthly milestone → 3–7 tasks + auto-detected existing contributors.
- All four read your **global "About me" context** (Settings → Profile) for standing facts about you (role, work rhythms, constraints). Goal/task breakdown also read the **per-goal context** for goal-specific strategy.

### Sources + two-way sync

- **Google Calendar, Gmail, Google Tasks, ClickUp, Notion, Workflowy, Things 3, flomo**.
- Marking a task done in Lighthouse writes back to the source (ClickUp status update, Notion archive, GTasks status, Workflowy completedAt, Things AppleScript). New syncs land in **This month** — explicitly triage to This week or Today when ready.
- Each row shows its **source** (ClickUp / Notion / etc.) + **project** (list / database / repo name) inline so you know where it came from at a glance.

### Brain dump

- Captures untriaged inflow at the top of the Tasks page. Sources include manual captures, Gmail messages tagged with the "Lighthouse" label, and ad-hoc items added via the API token.
- Three triage actions per row: **→ Today**, **This week**, **Drop**.
- Tasks created from triage get `primary_goal_id` auto-set by the next enrichment pass.

### Calendar

- 4-day vertical grid, full 24 hours with the 1–7am sleep band compressed into a tagged "SLEEP" zone. Horizontal red line tracks the current minute across all columns.
- Free-time counter on the sidebar ticks down dynamically as the day passes.

### Journal

- 13-mood palette (calm, focused, content, curious, inspired, proud, buzzy, scattered, frustrated, anxious, overwhelmed, drained, low). Default mood = calm.
- Inline edit + delete, streak counter, right-rail mini-calendar to browse past days.
- Two-way flomo sync (RSS pull + webhook push, tagged `#lighthouse` to prevent circular import).

### View controls

- **Hide completed** toggle on Tasks page (default on).
- **By goal / By lane** view toggle on Tasks page (default by goal).
- **Collapsible sidebar + right rail** (click the inner-edge ‹ / › buttons). Sidebar collapses to a 64px icon strip with nav glyphs.
- **Responsive** down to phone widths (5 tiers; below 900px the sidebar becomes icon-only, below 640px it scroll-strips at the top).

### Misc

- **Task detail modal**: full description, theme + weight + reasoning, goal link, lane picker, **Open in {Source} ↗** back-link, pin toggle.
- **Settings**: profile + "About me" context, theme picker (Paper / Apple / Dusk / Slate / Things), per-source API key management, agent token for external integrations.

## Setup

See [`SETUP.md`](./SETUP.md) for the manual walkthrough — Google Cloud OAuth, Anthropic API key, per-source connector keys.

Or for agent-driven install (Claude Code / Cursor / etc.):

```bash
git clone https://github.com/rogermzy/lighthouse && cd lighthouse && claude
```

Then type **"install this"** — Claude reads [`CLAUDE.md`](./CLAUDE.md) + [`INSTALL.md`](./INSTALL.md) and walks you through the rest with curl-verifiable steps.

Quick start (after configuring `backend/.env`):

```bash
cd backend
npm install
npm start
# → http://127.0.0.1:3000
```

## Mac app

```bash
cd mac-app
./build.sh
mv Lighthouse.app /Applications/
open /Applications/Lighthouse.app
```

Real Mac chrome (Dock icon, menu bar, Cmd+Q stops the server cleanly), status bar item with restart/log/launch-at-login toggle. See [`mac-app/README.md`](./mac-app/README.md).

## Architecture notes

- **Data shape**: one `tasks` table is the unified pool. External-source items upsert by `(source, external_id)`. Roger-owned fields (`lane`, `big_rock`, `tag`, `position`, `pinned`, `done_at`) are NEVER overwritten by sync; source-owned fields (`title`, `note`, `project`, `estimate_min`, `due`, `url`) refresh on every tick.
- **Lane storage**: stored as strings (`now`, `today`, `this_week`, `this_month`, `backlog`). The reconciler lands new external items in `this_month`; user explicitly triages from there.
- **Transactions**: any read-then-write pattern (3-cap check, Now-singleton swap, 5-pin cap, position renumber) runs inside `BEGIN IMMEDIATE` so concurrent PATCHes can't both see the same pre-state.
- **Enrichment cache**: `task_enrichment.hash = sha1(title|project|note|goalsSignature)`. Editing a goal shifts the signature and naturally invalidates everything; otherwise re-runs are free.
- **Agent confabulation defense**: task-breakdown's `related_existing` field is intersected with the candidate list server-side; any hallucinated task IDs the model invents are dropped before returning.
- **Trust model**: localhost-only personal app. Bearer-token guard on the `/api/v1/*` write endpoints (for external agents); no auth on the human-facing `/api/*` routes (same-origin from the dashboard).

## Tech choices

- Hono over Express — lighter, native fetch types, runs anywhere.
- `node:sqlite` (Node 24+) over better-sqlite3 — no native build step.
- Babel-standalone in the browser over a Vite build — kept the prototype simple; a Vite migration is an obvious follow-up.
- Anthropic SDK + Claude Opus 4.7 for all four agents. Adaptive thinking on suggest + breakdown; forced `tool_choice` on enrichment + breakdown for guaranteed structured output.
- Native Swift wrapper for the Mac app rather than Electron — WebKit-on-WebKit beats Chromium-on-WebKit for native feel, and the binary is 140KB vs ~150MB.
