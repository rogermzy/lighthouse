# Task Breakdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Break down" button to the task detail pane that uses a Claude agent to split one oversized task into several small, linked child tasks.

**Architecture:** A new `parent_task_id` column links local child tasks to an umbrella parent. A single forced-tool Anthropic call (`split-task.ts`) proposes subtasks; a review modal (`SplitTaskModal`) lets the user edit/uncheck before a commit endpoint inserts them. The parent auto-completes when its last open child is checked off.

**Tech Stack:** Hono + `node:sqlite` backend, Anthropic SDK (Opus 4.7), React 18 via Babel-standalone (no build step).

**Verification:** This repo has **no test framework** (CLAUDE.md: "No tests yet… verification is via curl + manual UI smoke"). Each task is verified with `curl` against `127.0.0.1:7373` and/or a live Playwright UI check — **not** a unit-test runner. Do not add Jest/Vitest/a bundler.

**Naming watch-out:** `breakdown.ts` / `task-breakdown.ts` (backend) and `BreakdownModal` / `TaskBreakdownModal` (frontend) ALREADY EXIST — they decompose the *goals* tree. This feature uses **`split-task`** / **`SplitTaskModal`** to avoid collision.

**Lane reality:** the live lane set is `now / today / this_week / this_month / backlog` (from `VALID_LANES` in `tasks.ts`), not the `now/today/week/later` in CLAUDE.md. Children inherit the parent's lane, so no lane name is hard-coded.

**Deferred (YAGNI):** cascade-delete of children is in the design, but there is **no DELETE endpoint for tasks today** (confirmed). Skip it; revisit when a delete path is added. Noted in Task 8.

---

### Task 1: Schema migration — `parent_task_id` column + index

**Files:**
- Modify: `backend/src/db/client.ts` (after the existing idempotent ALTERs)

**Step 1: Add the migration.** In `client.ts`, after the last existing `ALTER TABLE tasks ADD COLUMN …` block, append (mirroring the existing idempotent ALTER style — wrap in the same try/catch-on-duplicate-column pattern the file already uses):

```ts
// Breakdown feature: links a small child task to its umbrella parent.
// Null for every normal task. Index is partial so it stays tiny.
addColumnIfMissing("tasks", "parent_task_id", "TEXT");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL",
);
```

(Use whatever the file's existing helper is named — read `client.ts` first to match the established ALTER idiom rather than inventing `addColumnIfMissing` if a different pattern is in use. The CREATE INDEX must live HERE, not in `schema.sql`, because the column is freshly added — per the CLAUDE.md watch-out.)

**Step 2: Verify the migration ran.**

Run:
```bash
cd backend && npm start &  # background
sleep 3
sqlite3 backend/data.db "PRAGMA table_info(tasks);" | grep parent_task_id
sqlite3 backend/data.db "PRAGMA index_list(tasks);" | grep idx_tasks_parent
```
Expected: a `parent_task_id|TEXT` row and an `idx_tasks_parent` index. Stop the server after.

**Step 3: Commit.**
```bash
git add backend/src/db/client.ts
git commit -m "Add parent_task_id column + partial index for task breakdown"
```

---

### Task 2: Expose `parent_task_id` on the task wire

**Files:**
- Modify: `backend/src/api/tasks.ts` (`TaskRow` type ~L8, `selectVisible` ~L48, `rowToWire` ~L121)

**Step 1: Add to `TaskRow`** (after `done_at`):
```ts
  parent_task_id: string | null;
```

**Step 2: Add to `selectVisible`** SELECT column list (after `t.done_at,`):
```sql
         t.parent_task_id,
```

**Step 3: Add to `rowToWire`** return object (after `doneAt`):
```ts
    parentTaskId: r.parent_task_id ?? undefined,
```

**Step 4: Verify.**
```bash
cd backend && npm start &  # background
sleep 3
curl -s http://127.0.0.1:7373/api/tasks | jq '.[0] | keys'   # no error; parentTaskId absent (undefined) is fine
```
Expected: 200, valid JSON. (Existing tasks have null parent → `parentTaskId` omitted by the `?? undefined`.) Stop server.

**Step 5: Commit.**
```bash
git add backend/src/api/tasks.ts
git commit -m "Serialize parent_task_id as parentTaskId on the task wire"
```

---

### Task 3: The split-task agent

**Files:**
- Create: `backend/src/agent/split-task.ts`

**Step 1: Write the agent.** Single forced-tool Anthropic call. Mirror the SDK setup in `loop.ts` (`new Anthropic()`, `model: MODEL`, `output_config: { effort: "high" }`) but **drop the `thinking` block** — forced `tool_choice` is incompatible with thinking (CLAUDE.md). Enforce 2–8 results server-side.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/client.js";
import { getProfileContext } from "../api/profile.js";
import { MODEL, isAgentConfigured } from "./config.js";

export { isAgentConfigured };

const VALID_TAGS = ["deep", "shallow", "admin", "comms", "personal", "errand"] as const;
type Tag = typeof VALID_TAGS[number];

export type SubtaskProposal = {
  title: string;
  estimateMin: number;
  note: string;
  tag: Tag;
  reasoning: string;
};

type TaskRow = {
  id: string; title: string; note: string | null;
  project: string | null; estimate_min: number | null; parent_task_id: string | null;
};

const selectTask = db.prepare(
  "SELECT id, title, note, project, estimate_min, parent_task_id FROM tasks WHERE id = :id",
);

const SYSTEM = `You break ONE oversized task into 2–8 small, concrete next-actions for an
ADHD user who stalls on big tasks. Each subtask must be a single sitting
(5–60 min), start with a verb, and be independently checkable. Do NOT restate
the parent; produce the actual steps. Prefer fewer, real steps over padding.
Call return_subtasks exactly once.`;

const TOOL: Anthropic.Tool = {
  name: "return_subtasks",
  description: "Return the breakdown of the task into small subtasks.",
  input_schema: {
    type: "object",
    properties: {
      subtasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:     { type: "string" },
            estimateMin: { type: "number" },
            note:      { type: "string" },
            tag:       { type: "string", enum: [...VALID_TAGS] },
            reasoning: { type: "string" },
          },
          required: ["title", "estimateMin", "reasoning"],
        },
      },
    },
    required: ["subtasks"],
  },
};

export class SplitTaskError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "SplitTaskError"; }
}

/** Returns 2–8 validated proposals. Writes nothing. */
export async function runSplitTaskAgent(taskId: string, signal?: AbortSignal): Promise<SubtaskProposal[]> {
  if (!isAgentConfigured()) throw new Error("ANTHROPIC_API_KEY not set");
  const task = selectTask.get({ id: taskId }) as TaskRow | undefined;
  if (!task) throw new SplitTaskError("not_found", `task ${taskId} not found`);
  if (task.parent_task_id) throw new SplitTaskError("is_subtask", "subtasks can't be broken down further");

  const profile = await getProfileContext();
  const opening =
    `Break down this task.\n\nTitle: ${task.title}\n` +
    (task.note ? `Notes: ${task.note}\n` : "") +
    (task.project ? `Project: ${task.project}\n` : "") +
    (task.estimate_min ? `Current estimate: ${task.estimate_min}m\n` : "") +
    `\nUser context:\n${profile}`;

  const client = new Anthropic();
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 4096,
      output_config: { effort: "high" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "return_subtasks" },
      messages: [{ role: "user", content: opening }],
    },
    { signal },
  );

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "return_subtasks",
  );
  const raw = (block?.input as { subtasks?: unknown })?.subtasks;
  if (!Array.isArray(raw)) throw new SplitTaskError("malformed", "agent returned no subtasks array");

  // Mechanical enforcement — the prompt is a hint, code is the contract.
  const clean = raw
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x.title === "string" && x.title.trim().length > 0)
    .map((x): SubtaskProposal => ({
      title: (x.title as string).trim().slice(0, 200),
      estimateMin: clampEstimate(x.estimateMin),
      note: typeof x.note === "string" ? x.note.trim() : "",
      tag: (VALID_TAGS as readonly string[]).includes(x.tag as string) ? (x.tag as Tag) : "shallow",
      reasoning: typeof x.reasoning === "string" ? x.reasoning.trim() : "",
    }))
    .slice(0, 8);

  if (clean.length < 2) throw new SplitTaskError("too_few", "couldn't split into 2+ subtasks");
  return clean;
}

function clampEstimate(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 15;
  return Math.max(5, Math.min(120, n));
}
```

> Read `profile.ts` first to confirm `getProfileContext` exists and its signature (sync vs async). If it differs, adapt the import/await.

**Step 2: Verify it compiles.**
```bash
cd backend && npx tsc --noEmit
```
Expected: no new errors in `split-task.ts`.

**Step 3: Commit.**
```bash
git add backend/src/agent/split-task.ts
git commit -m "Add split-task agent: forced-tool breakdown with 2-8 enforcement"
```

---

### Task 4: Breakdown endpoints (propose + commit)

**Files:**
- Modify: `backend/src/api/tasks.ts` (add two routes; add an insert statement)

**Step 1: Add the child-insert statement** near the other prepared statements (mirror `task-breakdown.ts`'s insert; `source='self'`, carry `parent_task_id`, position = end of lane):
```ts
const insertChildTask = db.prepare(`
  INSERT INTO tasks
    (id, source, external_id, title, note, project, tag, estimate_min, due, lane,
     big_rock, pinned, position, parent_task_id, done_at, created_at, updated_at)
  VALUES
    (:id, 'self', NULL, :title, :note, NULL, :tag, :estimate_min, NULL, :lane,
     0, 0, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks WHERE lane = :lane),
     :parent_task_id, NULL, :now, :now)
`);
const selectLaneFor = db.prepare("SELECT lane, parent_task_id FROM tasks WHERE id = :id");
```

**Step 2: Add the propose endpoint** (mirror `plan-day.ts` error branches). Import at top: `import Anthropic from "@anthropic-ai/sdk";` and `import { runSplitTaskAgent, SplitTaskError } from "../agent/split-task.js";` plus `randomUUID` from `node:crypto`.
```ts
tasksApi.post("/:id/breakdown", async (c) => {
  const id = c.req.param("id");
  try {
    const subtasks = await runSplitTaskAgent(id, c.req.raw.signal);
    return c.json({ subtasks });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError)
      return new Response(JSON.stringify({ error: "aborted" }), { status: 499, headers: { "content-type": "application/json" } });
    if (err instanceof SplitTaskError && err.code === "not_found") return c.json({ error: "not found" }, 404);
    if (err instanceof SplitTaskError) return c.json({ error: err.code, detail: err.message }, 422);
    if (err instanceof Anthropic.RateLimitError) return c.json({ error: "rate limited", detail: err.message }, 429);
    if (err instanceof Anthropic.APIError) return c.json({ error: "anthropic api error", detail: err.message }, 502);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ANTHROPIC_API_KEY")) return c.json({ error: msg }, 503);
    return c.json({ error: "agent failed", detail: msg }, 500);
  }
});
```

**Step 3: Add the commit endpoint.** Body: `{ subtasks: [{title, note?, estimateMin?, tag?}] }` (the user's edited+checked list). Re-validate, insert under the parent's lane, inside `runTx`.
```ts
tasksApi.post("/:id/breakdown/commit", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body.subtasks) ? body.subtasks : [];
  const parent = selectLaneFor.get({ id }) as { lane: string; parent_task_id: string | null } | undefined;
  if (!parent) return c.json({ error: "not found" }, 404);
  if (parent.parent_task_id) return c.json({ error: "is_subtask" }, 422);

  const clean = items
    .filter((x: any) => x && typeof x.title === "string" && x.title.trim())
    .slice(0, 8)
    .map((x: any) => ({
      title: String(x.title).trim().slice(0, 200),
      note: typeof x.note === "string" ? x.note : "",
      estimate_min: Number.isFinite(x.estimateMin) ? Math.max(5, Math.min(120, Math.round(x.estimateMin))) : 15,
      tag: ["deep","shallow","admin","comms","personal","errand"].includes(x.tag) ? x.tag : "shallow",
    }));
  if (clean.length === 0) return c.json({ error: "no_subtasks" }, 400);

  const now = nowIso();
  const created: string[] = [];
  runTx(() => {
    for (const s of clean) {
      const childId = randomUUID();
      insertChildTask.run({ id: childId, title: s.title, note: s.note, tag: s.tag,
        estimate_min: s.estimate_min, lane: parent.lane, parent_task_id: id, now });
      created.push(childId);
    }
  });
  return c.json({ ok: true, created });
});
```

**Step 4: Verify with curl.**
```bash
cd backend && npm start &  # background
sleep 3
TID=$(curl -s http://127.0.0.1:7373/api/tasks | jq -r '.[0].id')
# propose (writes nothing):
curl -s -X POST http://127.0.0.1:7373/api/tasks/$TID/breakdown | jq '.subtasks | length'   # 2..8
BEFORE=$(curl -s http://127.0.0.1:7373/api/tasks | jq 'length')
# commit a hand-rolled subset:
curl -s -X POST http://127.0.0.1:7373/api/tasks/$TID/breakdown/commit \
  -H 'content-type: application/json' \
  -d '{"subtasks":[{"title":"step one","estimateMin":15},{"title":"step two","estimateMin":20}]}' | jq
AFTER=$(curl -s http://127.0.0.1:7373/api/tasks | jq 'length')
echo "before=$BEFORE after=$AFTER"   # after = before + 2
curl -s http://127.0.0.1:7373/api/tasks | jq --arg p "$TID" '[.[] | select(.parentTaskId==$p)] | length'  # 2
```
Expected: propose returns 2–8 and does NOT change task count; commit adds exactly the 2 children with `parentTaskId == TID`, same lane as parent. Clean up the two test children afterward (DELETE FROM tasks via sqlite3, since there's no API delete). Stop server.

**Step 5: Commit.**
```bash
git add backend/src/api/tasks.ts
git commit -m "Add breakdown propose + commit endpoints"
```

---

### Task 5: Auto-complete parent when last child is checked off

**Files:**
- Modify: `backend/src/api/tasks.ts` (`selectCurrentLane` ~L42, PATCH handler done-branch ~L293 and reopen-branch ~L338)

**Step 1: Add `parent_task_id` to the prior-state read.** Change `selectCurrentLane`:
```ts
const selectCurrentLane = db.prepare("SELECT lane, done_at, position, parent_task_id FROM tasks WHERE id = :id");
```
and widen the `prior` type annotation in the PATCH handler to include `parent_task_id: string | null`.

**Step 2: Add open-sibling statements** near the other prepared statements:
```ts
const countOpenSiblings = db.prepare(
  "SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = :pid AND done_at IS NULL AND id != :childId",
);
const setParentDone   = db.prepare("UPDATE tasks SET done_at = :now, updated_at = :now WHERE id = :pid AND done_at IS NULL");
const clearParentDone = db.prepare("UPDATE tasks SET done_at = NULL, updated_at = :now WHERE id = :pid");
```

**Step 3: In the just-done branch** (`if (body.done === true && prior.done_at === null) {` … inside `runTx`), after the existing completion-log/auto-advance code, add:
```ts
      // Roll completion up: if this was the last open child, complete the parent.
      if (prior.parent_task_id) {
        const { n } = countOpenSiblings.get({ pid: prior.parent_task_id, childId: id }) as { n: number };
        if (n === 0) setParentDone.run({ pid: prior.parent_task_id, now: nowIso() });
      }
```

**Step 4: In the reopen branch** (`else if (body.done === false && prior.done_at !== null) {`), add:
```ts
      // Reopening a child un-completes the umbrella — it's no longer fully done.
      if (prior.parent_task_id) clearParentDone.run({ pid: prior.parent_task_id, now: nowIso() });
```

**Step 5: Verify with curl.**
```bash
cd backend && npm start &  # background; sleep 3
# Use a parent with exactly 2 children (from Task 4 setup, or rebuild it).
# Mark child A done -> parent still open (1 sibling left):
curl -s -X PATCH http://127.0.0.1:7373/api/tasks/$CHILD_A -H 'content-type: application/json' -d '{"done":true}'
curl -s http://127.0.0.1:7373/api/tasks | jq --arg p "$TID" '.[] | select(.id==$p) | .doneAt'   # null
# Mark child B done -> parent auto-completes:
curl -s -X PATCH http://127.0.0.1:7373/api/tasks/$CHILD_B -H 'content-type: application/json' -d '{"done":true}'
curl -s http://127.0.0.1:7373/api/tasks | jq --arg p "$TID" '.[] | select(.id==$p) | .doneAt'   # a timestamp
# Reopen child B -> parent clears:
curl -s -X PATCH http://127.0.0.1:7373/api/tasks/$CHILD_B -H 'content-type: application/json' -d '{"done":false}'
curl -s http://127.0.0.1:7373/api/tasks | jq --arg p "$TID" '.[] | select(.id==$p) | .doneAt'   # null
```
Expected: parent completes only after BOTH children done; reopening a child clears it. Clean up test rows. Stop server.

**Step 6: Commit.**
```bash
git add backend/src/api/tasks.ts
git commit -m "Auto-complete/reopen parent task from child done-state"
```

---

### Task 6: Frontend — SplitTaskModal + "Break down" button

**Files:**
- Modify: `pages.jsx` (new `SplitTaskModal` component near `PlanDayModal` ~L3331; button + Subtasks section in `TaskDetailModal` ~L2743; window export ~L3498)
- Modify: `app.jsx` (wire handlers + pass `subtasks` prop ~L2456)

**Step 1: Add `SplitTaskModal`** to `pages.jsx` (mirror `PlanDayModal`'s AbortController-on-close pattern). It fetches proposals on open, renders editable rows with checkboxes, commits the checked set.

```jsx
function SplitTaskModal({ open, task, onClose, onCommitted }) {
  const [rows, setRows] = React.useState(null);     // [{title, estimateMin, checked}]
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !task) return;
    const ctrl = new AbortController();
    setLoading(true); setRows(null); setError(null); setSaving(false);
    fetch(`/api/tasks/${encodeURIComponent(task.id)}/breakdown`, { method: "POST", signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          const friendly =
            b.error === "too_few"   ? "Couldn't split this one — it may already be small enough." :
            b.error === "is_subtask" ? "This is already a subtask." :
            b.detail || b.error || `status ${r.status}`;
          throw new Error(friendly);
        }
        return r.json();
      })
      .then((data) => setRows((data.subtasks || []).map((s) => ({ ...s, checked: true }))))
      .catch((err) => { if (err?.name !== "AbortError") setError(String(err.message || err)); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [open, task && task.id]);

  if (!open || !task) return null;
  const checkedCount = (rows || []).filter((r) => r.checked).length;
  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const commit = async () => {
    setSaving(true);
    try {
      const subtasks = rows.filter((r) => r.checked).map((r) => ({ title: r.title, estimateMin: r.estimateMin, note: r.note }));
      const r = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/breakdown/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtasks }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `status ${r.status}`);
      await onCommitted?.();
      onClose();
    } catch (err) { setError(String(err.message || err)); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-eyebrow"><span>◎</span> {loading ? "Breaking it down…" : "Broken down by Claude"}</div>
        <h2 className="modal-title">Break down<br/><em>{task.title}</em></h2>
        {error && !loading && <p className="modal-sub" style={{ color: "var(--muted)" }}>{error}</p>}
        {loading && <p className="modal-sub">Splitting into small, doable steps…</p>}
        {!loading && rows && (
          <div className="suggest-list">
            {rows.map((r, i) => (
              <div key={i} className="suggest-row">
                <input type="checkbox" checked={r.checked} onChange={(e) => update(i, { checked: e.target.checked })} />
                <div className="suggest-body" style={{ flex: 1 }}>
                  <input className="task-detail-edit-input" value={r.title}
                         onChange={(e) => update(i, { title: e.target.value })} style={{ width: "100%" }} />
                  <div className="suggest-reason">{r.reasoning}</div>
                </div>
                <input type="number" value={r.estimateMin} min="5" max="120" style={{ width: 56 }}
                       onChange={(e) => update(i, { estimateMin: Number(e.target.value) })} />
              </div>
            ))}
          </div>
        )}
        <div className="modal-foot">
          <button className="modal-secondary" onClick={onClose}>Cancel</button>
          <button className="modal-primary" disabled={loading || saving || checkedCount === 0} onClick={commit}>
            {saving ? "Creating…" : `Create ${checkedCount} subtask${checkedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
```
Add `SplitTaskModal` to the `Object.assign(window, { … })` export at the bottom of `pages.jsx`.

**Step 2: Add the button + Subtasks section to `TaskDetailModal`.** Extend its props to receive `subtasks` (children) and `onBreakdown`:
```jsx
function TaskDetailModal({ open, task, goals, subtasks, onClose, onToggleDone, onChangeLane, onTogglePin, onTriageInbox, onCompleteInbox, onPinInbox, onBreakdown }) {
```
In the non-inbox actions block (before the Done button ~L2767), add the button — shown only when this task is NOT itself a subtask and has NO children yet:
```jsx
            {!task.parentTaskId && (!subtasks || subtasks.length === 0) && (
              <button className="rec-defer" title="Split this into small subtasks"
                      onClick={() => onBreakdown?.(task)}>
                ⑂ Break down
              </button>
            )}
```
And, when children exist, render a Subtasks section (after the Description block ~L2708):
```jsx
        {subtasks && subtasks.length > 0 && (
          <div className="task-detail-subtasks">
            <div className="task-detail-section-label">Subtasks · {subtasks.filter(s => !s.doneAt).length} left</div>
            {subtasks.map((s) => (
              <label key={s.id} className="task-detail-subtask-row">
                <input type="checkbox" checked={Boolean(s.doneAt)} onChange={() => onToggleDone?.(s.id)} />
                <span style={{ textDecoration: s.doneAt ? "line-through" : "none" }}>{s.title}</span>
                {s.estimate && <span className="task-detail-subtask-est">{s.estimate}m</span>}
              </label>
            ))}
          </div>
        )}
```

**Step 3: Wire it in `app.jsx`.** Add state `const [breakdownTask, setBreakdownTask] = React.useState(null);` (declare in read-order to dodge the Babel TDZ trap). Compute the open task's children and pass them in; render `SplitTaskModal`. Find the `<TaskDetailModal … />` usage (~L2456) and add:
```jsx
        subtasks={detailTask ? tasks.filter(t => t.parentTaskId === detailTask.id) : []}
        onBreakdown={(t) => setBreakdownTask(t)}
```
(Use whatever the modal's current task variable is named — read the surrounding code; it may be `detailTask`/`openTask`.) Then near it:
```jsx
      <SplitTaskModal
        open={Boolean(breakdownTask)}
        task={breakdownTask}
        onClose={() => setBreakdownTask(null)}
        onCommitted={async () => { /* reuse the existing tasks refetch */ }}
      />
```
Reuse the existing `/api/tasks` refetch helper for `onCommitted` (the same one the app already calls after a PATCH) so children appear immediately.

**Step 4: Verify (Playwright, live).** Start server, `open http://127.0.0.1:7373`. Open a non-subtask in the detail pane → "⑂ Break down" shows. Click → modal loads proposals → uncheck one, edit a title → "Create N subtasks" → children appear. Confirm the button is GONE on that task now (it has children) and absent on the child rows. Use the Playwright MCP for the live check.

**Step 5: Commit.**
```bash
git add pages.jsx app.jsx
git commit -m "Add SplitTaskModal + Break down button + subtasks section"
```

---

### Task 7: Frontend — nested children in the lane lists + badge

**Files:**
- Modify: `pages.jsx` (`LaneListSection` ~L701 and any other lane renderers that list tasks: `OnDeck`/`TodayList` in `app.jsx` as needed)

**Step 1: Group children under their parent within a lane.** Where a lane's task array is mapped to rows, build a render order that places each child immediately after its parent, indented, and hide top-level rows for tasks whose `parentTaskId` matches a parent present in the same list. Minimal approach inside the list component:
```jsx
const byParent = {};
tasks.forEach(t => { if (t.parentTaskId) (byParent[t.parentTaskId] ||= []).push(t); });
const ordered = [];
tasks.forEach(t => {
  if (t.parentTaskId) return;          // children are emitted under their parent
  ordered.push({ task: t, depth: 0 });
  (byParent[t.id] || []).forEach(ch => ordered.push({ task: ch, depth: 1 }));
});
```
Render each `ordered` entry; apply an indent class when `depth === 1`. On the parent row, when `byParent[t.id]?.length`, show a badge: `<span className="subtask-badge">{byParent[t.id].length} subtasks</span>`.

> Orphan guard: a child whose parent is filtered out of the current view (e.g. parent is done and "hide completed" is on) would never be emitted. Append a final pass that emits any child whose parent isn't in `ordered`, at depth 0, so nothing silently vanishes.

**Step 2: Add minimal CSS** to `styles.css` for `.subtask-badge`, `.task-detail-subtasks`, `.task-detail-subtask-row`, and a `.task-row.depth-1` indent (small left margin + muted). Match the existing visual language.

**Step 3: Verify (Playwright, live).** A broken-down parent shows `[N subtasks]`; its children render indented directly beneath it in the same lane. Check off all children → parent shows done.

**Step 4: Commit.**
```bash
git add pages.jsx app.jsx styles.css
git commit -m "Render subtasks indented under parent with count badge"
```

---

### Task 8: Full verification sweep + cleanup

**Step 1: End-to-end backend curl sweep** — re-run Tasks 4 & 5 curl checks against a fresh big task; confirm propose-writes-nothing, commit-creates-children, last-child auto-completes parent, reopen clears.

**Step 2: Abort check.** Start a breakdown and close the modal immediately (or `curl --max-time 0.2`); confirm a 499 and NO partial writes.

**Step 3: Edge inputs.** POST commit with empty titles / 20 items / junk tag → confirm clamping/dropping (≤8, junk tag → "shallow", empty → dropped, 0 valid → 400).

**Step 4: Full UI smoke (Playwright)** — button visibility rules, review modal edit/uncheck, nested rendering, parent auto-done. **Delete every test task created during verification** (sqlite3, since there's no API delete) per the test-artifact-cleanup rule.

**Step 5: Deferred note.** Add a one-line comment near `parent_task_id` usage that cascade-delete is intentionally not implemented (no DELETE endpoint exists yet).

**Step 6: Final commit (docs/any cleanup).**
```bash
git add -A
git commit -m "Verify task breakdown end-to-end; note deferred cascade-delete"
```

---

## Open risks / things to confirm during execution
- `getProfileContext` signature (sync vs async) — Task 3.
- The exact name of the detail-modal's open-task variable in `app.jsx` — Task 6 Step 3.
- The exact idempotent-ALTER helper name in `client.ts` — Task 1.
- Whether `tool_choice` + `output_config.effort` coexist cleanly on Opus 4.7; if the API rejects the combo, drop `output_config` (thinking is already removed).
