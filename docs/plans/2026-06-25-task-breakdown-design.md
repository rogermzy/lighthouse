# Task Breakdown — design

**Date:** 2026-06-25
**Status:** Approved design, not yet implemented

## Problem

When a task is too big to act on, it stalls. We need a way to split one
oversized task into several small, actionable subtasks — surfaced from the
task detail pane, powered by an in-app Claude agent.

## Decisions

1. **Parent stays, children are linked.** The original task remains as an
   umbrella; the breakdown creates N small *local* child tasks linked via a new
   `parent_task_id` column. Children are real, checkable, schedulable tasks. The
   parent auto-completes when all children are done. Works even when the parent
   is synced (we never touch the source).
2. **Review before create.** The agent proposes subtasks; a modal lets the user
   uncheck/edit before committing. Nothing is written until confirm.
3. **Children inherit the parent's lane.** They appear where the big task lived.
   Existing lane-cap / auto-advance logic handles any overflow — no new cap
   logic.
4. **One level only.** A task that already has a `parent_task_id` cannot itself
   be broken down (button hidden). Keeps the model flat-ish and auto-complete
   simple.

## Data model

One nullable column + a partial index, both added in `client.ts` *after* the
existing ALTERs (per the CLAUDE.md watch-out: an index on a freshly-added
column belongs in `client.ts`, not `schema.sql`):

```sql
ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
```

`parent_task_id` is null for every normal task; only breakdown-children point at
their umbrella. The task wire serializer gains `parent_task_id` so the frontend
can group children under parents.

## Flow

1. Open a task → `TaskDetailModal`. A **"Break down"** button shows there, and
   only there (never on list rows).
2. Click → `POST /api/tasks/:id/breakdown` runs the agent and returns proposals.
   **Writes nothing.**
3. Review modal shows proposals (checkbox + editable title + editable estimate).
   User confirms.
4. `POST /api/tasks/:id/breakdown/commit` inserts the checked subtasks as
   `source='self'`, `parent_task_id=:id`, `lane=`parent's lane, position
   `MAX(position)+1` for that lane.
5. Parent now renders with a `[N subtasks]` badge; children render indented
   beneath it within the same lane.
6. Checking off the last open child auto-sets the parent's `done_at`.

## Backend

**New agent `backend/src/agent/split-task.ts`** — named to avoid confusion with
the existing goal-decomposition files `breakdown.ts` (annual→quarterly→monthly)
and `task-breakdown.ts` (monthly→tasks), which operate on the goals tree. This
operates on one `tasks` row.

- **Input:** the task row (title, note, estimate, project) + `getProfileContext()`.
- **Call:** a single Anthropic `messages.create` forcing a `return_subtasks`
  tool — no agent loop, since there's no DB to query iteratively. Forced
  `tool_choice` drops the `thinking` block (CLAUDE.md gotcha).
- **Output:** `{ subtasks: [{ title, estimateMin, note?, tag?, reasoning }] }`.
- **Server-side enforcement** (mechanical over prompt): clamp to 2–8 subtasks,
  drop empty/whitespace titles, clamp `estimateMin`, validate `tag` against the
  existing `VALID_TAGS`. The prompt is a hint; code is the contract.

**Two endpoints**, mirroring `plan-day.ts`'s abort/error branches
(503 if `ANTHROPIC_API_KEY` unset, 499 abort, 429 rate-limited, 502 Anthropic
error, 500 otherwise):

- `POST /api/tasks/:id/breakdown` → runs the agent, returns proposals, writes
  nothing. Pipes `c.req.raw.signal` through so closing the modal cancels the
  in-flight call.
- `POST /api/tasks/:id/breakdown/commit` → body is the user's final edited list.
  Re-validates server-side, inserts children, returns created rows.

Reuses: `config.ts` (MODEL/isAgentConfigured), the `plan-day.ts` endpoint shape,
the `INSERT INTO tasks` pattern from `task-breakdown.ts`.

## Frontend

- **Button** in `TaskDetailModal` only. Hidden when the task already has a
  `parent_task_id`, or when it already has children (show "N subtasks" instead).
  In flight: spinner + disabled, with an `AbortController` cancelled on modal
  close (mirrors `PlanDayModal`; respects the documented abort-error ordering).
- **`BreakdownModal`** (new): renders proposals as rows (checkbox + editable
  title + editable estimate). Footer reads "Create N subtasks" (N = checked),
  disabled at 0. Confirm → commit → close both modals, refresh. Cancel → closes,
  creates nothing.
- **Nested rendering:** children are normal rows carrying `parent_task_id`. The
  lane list-builder adds a sub-group by `parent_task_id` so children sit
  indented under their parent. Parent row gets a `[N subtasks]` badge. The
  detail modal shows a "Subtasks" section listing children with done-checkboxes.

## Edge cases

- **Auto-complete:** on the PATCH that sets a child's `done_at`, if it has a
  `parent_task_id` and no siblings remain open, set the parent's `done_at` too —
  inside the existing `BEGIN IMMEDIATE` transaction. Unchecking a child clears
  the parent's `done_at`.
- **Delete parent:** cascade-delete children (the ADHD-cleaner choice — no
  stranded fragments).
- **Synced parents:** `parent_task_id`, badge, and auto-complete are local-only.
  Auto-completing sets the local `done_at`; reconcile won't clear it; we don't
  write completion back to the source from this path.
- **Empty result:** if the agent returns fewer than 2 usable subtasks, the modal
  shows "Couldn't split this one — it may already be small enough" rather than
  creating a single duplicate.

## Verification

No test suite — verification is curl + live UI smoke (CLAUDE.md).

**Backend (curl against `:7373`):**
1. Migration applied — `parent_task_id` column + index exist after start.
2. `POST …/breakdown` returns 2–8 proposals, writes nothing (task count
   unchanged).
3. `POST …/breakdown/commit` with a subset → children created with correct
   `parent_task_id`, `lane`, `source='self'`; returns rows.
4. Enforcement — empty titles / 20 subtasks / junk tag → clamped/dropped.
5. PATCH last open child done → parent `done_at` auto-set; uncheck → cleared.
6. Delete parent → children gone (cascade).
7. Abort mid-breakdown → 499, no orphaned writes.

**UI (Playwright, live):**
- Button shows only in detail modal; hidden on list rows and on existing
  subtasks.
- Click → spinner → review modal with editable rows.
- Uncheck one, edit a title, confirm → correct children appear indented under
  the parent with the `[N subtasks]` badge.
- Check off all children → parent shows done.
- Clean up all test tasks afterward.
