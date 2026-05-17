/**
 * Lane decay — keep items honest about how stale they've gotten.
 *
 * Tasks in this_week that haven't been touched in 7 days drop to this_month.
 * Tasks in this_month that haven't been touched in 30 days drop to backlog.
 * "Touched" means updated_at (which the API bumps on lane changes, edits,
 * and the sync reconciler bumps on source-field refreshes).
 *
 * The decay job is idempotent and safe to run on every tick — no row moves
 * twice in the same tick because the WHERE clause uses both lane and age.
 * It does NOT touch tasks in `now` or `today` (those are explicit user
 * commitment), `backlog` (already at the floor), or done tasks.
 */
import { db } from "../db/client.js";

const TICK_MS = 60 * 60 * 1000; // hourly is enough — decay happens on day-scale

function ageCutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const decayThisWeek = db.prepare(`
  UPDATE tasks
     SET lane = 'this_month',
         updated_at = updated_at
   WHERE lane = 'this_week'
     AND done_at IS NULL
     AND updated_at < :cutoff
`);

const decayThisMonth = db.prepare(`
  UPDATE tasks
     SET lane = 'backlog',
         updated_at = updated_at
   WHERE lane = 'this_month'
     AND done_at IS NULL
     AND updated_at < :cutoff
`);

export function runDecayOnce(): { weekDecayed: number; monthDecayed: number } {
  // Note we deliberately preserve updated_at on the decay UPDATE so the next
  // tier's age clock keeps counting from the original last-touch, not from
  // when we shuffled lanes. Otherwise a task could pinball indefinitely.
  const week = decayThisWeek.run({ cutoff: ageCutoffIso(7) });
  const month = decayThisMonth.run({ cutoff: ageCutoffIso(30) });
  return {
    weekDecayed: Number(week.changes),
    monthDecayed: Number(month.changes),
  };
}

export function startDecayLoop(): void {
  const tick = () => {
    try {
      const { weekDecayed, monthDecayed } = runDecayOnce();
      if (weekDecayed > 0 || monthDecayed > 0) {
        console.log(`[decay] week→month=${weekDecayed} month→backlog=${monthDecayed}`);
      }
    } catch (err) {
      console.warn(`[decay] error — ${String(err)}`);
    }
    setTimeout(tick, TICK_MS);
  };
  // First run delayed slightly so it doesn't race seed inserts on cold start.
  setTimeout(tick, 30_000);
}
