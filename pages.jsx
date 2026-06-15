/* global React, SOURCES, TAGS, TASKS, CALENDAR, FREE_BLOCKS, FREE_TOTAL, BEST_BLOCK,
          fmtTime, fmtDuration, Icon, SourceChip, TagChip */

const { useState } = React;

/* ─────────────────────────────────────────────────────────────
   Calendar page — full day view
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   4-day calendar grid. Vertical time axis, day columns, events
   absolutely positioned by start time and duration. The grid
   visually expresses meetings AND free time, so the separate
   "meeting list" / "free pockets" sections are no longer needed.
   ───────────────────────────────────────────────────────────── */
const CAL_HOUR_START = 0;          // midnight
const CAL_HOUR_END   = 24;         // midnight (full 24 hours)
const CAL_PX_PER_MIN = 0.7;        // active-hour density
// Sleep band — compressed roughly 5x so the 1am-7am stretch doesn't dominate
// the grid for hours that are almost always empty. Hour labels still appear,
// just closer together with a tinted background.
const CAL_QUIET_START_MIN = 60;          // 1am
const CAL_QUIET_END_MIN   = 7 * 60;      // 7am
const CAL_QUIET_PX_PER_MIN = 0.15;

/** Piecewise-linear minutes → pixels from CAL_HOUR_START. */
function calMinutesToY(min) {
  const qStart = CAL_QUIET_START_MIN;
  const qEnd   = CAL_QUIET_END_MIN;
  if (min <= qStart) return min * CAL_PX_PER_MIN;
  if (min <= qEnd) {
    return qStart * CAL_PX_PER_MIN + (min - qStart) * CAL_QUIET_PX_PER_MIN;
  }
  return qStart * CAL_PX_PER_MIN
       + (qEnd - qStart) * CAL_QUIET_PX_PER_MIN
       + (min - qEnd) * CAL_PX_PER_MIN;
}

function fmtHour(h) {
  const ap = h < 12 || h === 24 ? "am" : "pm";
  const display = ((h + 11) % 12) + 1;
  return `${display}${ap}`;
}

function dayHeader(dateStr, todayStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const num = d.getDate();
  const isToday = dateStr === todayStr;
  return { dow, num, isToday };
}

function CalendarPage({ focusTask, onSchedule, scheduled, focusBlockStartMin }) {
  const labelStartMin = scheduled && focusBlockStartMin != null
    ? focusBlockStartMin
    : BEST_BLOCK.start;
  const gridStartMin = CAL_HOUR_START * 60;
  const gridEndMin   = CAL_HOUR_END * 60;
  // With the quiet band compressed, gridHeight comes from the piecewise map
  // rather than a flat multiplication. Pin gridStart at y=0.
  const gridHeight   = calMinutesToY(gridEndMin) - calMinutesToY(gridStartMin);
  const yAt = (min) => calMinutesToY(min) - calMinutesToY(gridStartMin);

  // Scroll the now-line into view on mount — otherwise opening Calendar at
  // 3pm dumps you at midnight and you have to scroll down 9 hours to find
  // yourself. Centers the line vertically in the viewport.
  const nowLineRef = React.useRef(null);
  React.useEffect(() => {
    if (nowLineRef.current) {
      nowLineRef.current.scrollIntoView({ behavior: "auto", block: "center" });
    }
  }, []);

  // Hour ticks for the left axis.
  const hours = [];
  for (let h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) hours.push(h);

  // Today's local date — used to highlight the "today" column.
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  })();

  // The "now" line — only drawn if the current time is within the grid
  // AND there's a column for today (the rolling window starts at today).
  const nowMinutes = (() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();
  const nowInGrid = nowMinutes >= gridStartMin && nowMinutes < gridEndMin;

  const days = CALENDAR.days?.length
    ? CALENDAR.days
    : [{ date: todayStr, events: CALENDAR.events || [] }];

  // Clip events to the visible window so a 7am meeting doesn't render off-screen.
  const placeEvent = (e) => {
    const start = Math.max(e.start, gridStartMin);
    const end   = Math.min(e.end, gridEndMin);
    return {
      top: yAt(start),
      height: Math.max(18, yAt(end) - yAt(start)),
      clippedTop: e.start < gridStartMin,
      clippedBot: e.end > gridEndMin,
    };
  };

  // Within a day, events that overlap render side-by-side. Group overlapping
  // events into "columns" — classic week-view layout algorithm (no library).
  const layoutDay = (events) => {
    const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
    const cols = []; // each col is an array of events (occupying that column)
    const placement = new Map(); // event.id → { colIndex, totalCols }
    for (const ev of sorted) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        const last = cols[i][cols[i].length - 1];
        if (last.end <= ev.start) {
          cols[i].push(ev);
          placement.set(ev.id, { colIndex: i });
          placed = true;
          break;
        }
      }
      if (!placed) {
        cols.push([ev]);
        placement.set(ev.id, { colIndex: cols.length - 1 });
      }
    }
    // Determine the local total cols per event (overlap-cluster width).
    // For simplicity, just use the global cols.length — produces stable widths
    // within the day even if some clusters could be wider individually.
    for (const v of placement.values()) v.totalCols = Math.max(1, cols.length);
    return placement;
  };

  return (
    <main className="main" data-screen-label="Calendar">
      <div className="topbar">
        <div>
          <div className="greeting-eyebrow">
            <span className="source-dot" style={{ background: SOURCES.gcal.color, display: "inline-block", marginRight: 6 }} />
            Google Calendar · {CALENDAR.account} · synced {CALENDAR.syncedMinAgo}m ago
          </div>
          <h1 className="greeting">
            {todayLongComma()}.<br/>
            <em>{fmtDuration(FREE_TOTAL)} free</em> today
            {BEST_BLOCK.end > BEST_BLOCK.start && (
              <> · deep-work pocket at <em>{fmtTime(BEST_BLOCK.start)}</em></>
            )}.
          </h1>
        </div>
        <div className="topbar-actions">
          {focusTask && BEST_BLOCK.end > BEST_BLOCK.start && (
            <button
              className={`suggest-btn ${scheduled ? "" : ""}`}
              onClick={onSchedule}
              title={`Block ${fmtTime(labelStartMin)} for "${focusTask.title}"`}>
              <span className="suggest-btn-icon">✦</span>
              {scheduled ? "✓ Focus block scheduled" : `Schedule focus at ${fmtTime(labelStartMin)}`}
            </button>
          )}
        </div>
      </div>

      <div className="cal-grid">
        {/* Day-header row spans the time-axis + each day column. */}
        <div className="cal-grid-axis-cell" />
        {days.map((d) => {
          const h = dayHeader(d.date, todayStr);
          return (
            <div
              key={`head-${d.date}`}
              className={`cal-day-header ${h.isToday ? "today" : ""}`}>
              <span className="cal-day-dow">{h.dow}</span>
              <span className="cal-day-num">{h.num}</span>
              <span className="cal-day-count">
                {d.events.length} event{d.events.length === 1 ? "" : "s"}
              </span>
            </div>
          );
        })}

        {/* Time axis: hour labels on the left, positioned via the piecewise
            scale so the compressed sleep band shows hour labels squished
            together rather than evenly spaced. The "sleep" tag identifies
            the compressed zone. */}
        <div className="cal-axis" style={{ height: gridHeight }}>
          <div
            className="cal-quiet-band"
            style={{
              top: yAt(CAL_QUIET_START_MIN),
              height: yAt(CAL_QUIET_END_MIN) - yAt(CAL_QUIET_START_MIN),
            }}>
            <span>sleep</span>
          </div>
          {hours.map((h) => {
            // Inside the compressed sleep band, hour labels collide. Keep
            // only the boundary labels (1am, 7am); the SLEEP tag carries
            // the rest of the meaning.
            const minOfHour = h * 60;
            const inQuietInterior =
              minOfHour > CAL_QUIET_START_MIN && minOfHour < CAL_QUIET_END_MIN;
            if (inQuietInterior) return null;
            return (
              <div
                key={`hour-${h}`}
                className="cal-axis-label"
                style={{ top: yAt(minOfHour) }}>
                {fmtHour(h)}
              </div>
            );
          })}
        </div>

        {/* One column per day. Hour gridlines as individual divs since the
            variable spacing of the compressed sleep band breaks the old
            repeating-gradient approach. */}
        {days.map((d) => {
          const isToday = d.date === todayStr;
          const placement = layoutDay(d.events);
          return (
            <div
              key={`col-${d.date}`}
              className={`cal-day-col ${isToday ? "today" : ""}`}
              style={{ height: gridHeight }}>
              <div
                className="cal-quiet-band-col"
                style={{
                  top: yAt(CAL_QUIET_START_MIN),
                  height: yAt(CAL_QUIET_END_MIN) - yAt(CAL_QUIET_START_MIN),
                }}
              />
              {hours.slice(1).map((h) => {
                const minOfHour = h * 60;
                // Skip gridlines inside the compressed band so it reads as a
                // single tinted region rather than 5 stacked stripes.
                if (minOfHour > CAL_QUIET_START_MIN && minOfHour < CAL_QUIET_END_MIN) {
                  return null;
                }
                return (
                  <div
                    key={`gridline-${h}`}
                    className="cal-hour-line"
                    style={{ top: yAt(minOfHour) }}
                  />
                );
              })}
              {/* The current-time line spans every day column. Only today's
                  column gets the dot + the scroll-anchor ref. */}
              {nowInGrid && (
                <div
                  ref={isToday ? nowLineRef : undefined}
                  className="cal-now-line"
                  style={{ top: yAt(nowMinutes) }}>
                  {isToday && <span className="cal-now-dot" />}
                </div>
              )}
              {d.events.map((e) => {
                const p = placeEvent(e);
                const slot = placement.get(e.id) || { colIndex: 0, totalCols: 1 };
                const widthPct = 100 / slot.totalCols;
                return (
                  <div
                    key={e.id}
                    className={`cal-event ${e.kind || ""}`}
                    style={{
                      top: p.top,
                      height: p.height,
                      left: `${slot.colIndex * widthPct}%`,
                      width: `calc(${widthPct}% - 2px)`,
                      background: e.color,
                    }}
                    title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)}`}>
                    <div className="cal-event-title">{e.title}</div>
                    {p.height >= 30 && (
                      <div className="cal-event-time">
                        {fmtTime(e.start)} – {fmtTime(e.end)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   Tasks page — the planning surface.

   Structure (top to bottom):
     1. Brain dump — capture box + untriaged inflow with → Today / This week / Drop
     2. This week — the active planning pool (themed, weight-ranked)
     3. This month — the soonish backlog (compact)
     4. Backlog — the holding pen (collapsible)

   The Today page is the execution surface; this page is the planning
   surface. Crossing between the two is a deliberate context switch.
   ───────────────────────────────────────────────────────────── */
// Same lane-shortcut table as app.jsx — duplicated here because pages.jsx is a
// separate Babel-standalone script and can't import. Keep them in sync.
function quickLaneActionsForRow(lane) {
  // Mirror of app.jsx quickLaneActions — keep in sync. ↑ promotes (toward
  // Today), ↓ demotes (toward Backlog). Tooltip names the destination.
  switch (lane) {
    case "this_week":  return [
      { icon: "↑", title: "Promote to Today",     target: "today" },
      { icon: "↓", title: "Demote to This month", target: "this_month" },
    ];
    case "this_month": return [
      { icon: "↑", title: "Promote to This week", target: "this_week" },
      { icon: "↓", title: "Demote to Backlog",    target: "backlog" },
    ];
    case "backlog":    return [
      { icon: "↑", title: "Promote to This week", target: "this_week" },
    ];
    default:           return [];
  }
}

function TasksPage({
  inbox, triage, onCompleteInbox, addInboxItem,
  weekSlot,
  thisMonthTasks, backlogTasks,
  allTasks, goals,
  toggleDone, doneSet, onOpenDetail, onChangeLane,
  hideCompleted, onToggleHideCompleted,
  view, onSetView,
}) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("all");
  const [showBacklog, setShowBacklog] = useState(false);

  const visible = filter === "all"
    ? inbox
    : inbox.filter(it => it.source === filter);
  const counts = Object.keys(SOURCES).reduce((a, k) => {
    a[k] = inbox.filter(it => it.source === k).length;
    return a;
  }, {});

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    addInboxItem(v);
    setDraft("");
  };

  return (
    <main className="main" data-screen-label="Tasks">
      <div className="topbar">
        <div>
          <div className="greeting-eyebrow">Planning surface</div>
          <h1 className="greeting">
            All the things.<br/>
            <em>Triage, sort, defer.</em>
          </h1>
        </div>
        <div className="topbar-actions">
          <div className="view-toggle" role="group" aria-label="Tasks view">
            <button
              className={`view-toggle-btn ${view === "byGoal" ? "active" : ""}`}
              onClick={() => onSetView("byGoal")}
              title="Group tasks by the goal they contribute to">
              By goal
            </button>
            <button
              className={`view-toggle-btn ${view === "byLane" ? "active" : ""}`}
              onClick={() => onSetView("byLane")}
              title="Group tasks by lane (This week / This month / Backlog)">
              By lane
            </button>
          </div>
          <button
            className="hide-completed-toggle"
            onClick={onToggleHideCompleted}
            title={hideCompleted ? "Show completed tasks" : "Hide completed tasks"}>
            {hideCompleted ? "Show completed" : "Hide completed"}
          </button>
        </div>
      </div>

      {/* ─── Brain dump ─── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 0 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Brain dump</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Untriaged inflow. Decide → Today, This week, or Drop. No fourth option.
            </div>
          </div>
          <div className="section-meta">
            <b>{inbox.length}</b> waiting
          </div>
        </div>

        <div className="capture-hero">
          <Icon.plus style={{ color: "var(--muted)", flex: "0 0 auto" }} />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            placeholder="What's in your head right now?"
          />
          <button className="capture-submit" onClick={submit}>
            Capture <span className="kbd">⏎</span>
          </button>
        </div>

        {inbox.length > 0 && (
          <div className="filter-row">
            <button
              className={`filter-chip ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}>
              All <span className="mono">{inbox.length}</span>
            </button>
            {Object.entries(SOURCES).map(([id, s]) => (
              counts[id] > 0 && (
                <button
                  key={id}
                  className={`filter-chip ${filter === id ? "active" : ""}`}
                  onClick={() => setFilter(id)}>
                  <span className="source-dot" style={{ background: s.color }} />
                  {s.label} <span className="mono">{counts[id]}</span>
                </button>
              )
            ))}
          </div>
        )}

        <div className="inbox-page-list">
          {visible.length === 0 ? (
            <div className="empty-state" style={{ padding: "28px 20px" }}>
              <div className="empty-state-icon" />
              <div className="empty-state-title">Brain dump is empty.</div>
              <div className="empty-state-sub">Anything that pops into your head, drop it in the box above.</div>
            </div>
          ) : visible.map(it => (
            <div
              key={it.id}
              className="inbox-page-row inbox-page-row-clickable"
              onClick={() => onOpenDetail?.(it.id)}
              title="Open detail">
              <button
                className="check check-btn"
                onClick={(e) => { e.stopPropagation(); onCompleteInbox?.(it.id); }}
                aria-label="Mark done">
                <Icon.check />
              </button>
              <span className="inbox-source" style={{ background: SOURCES[it.source]?.color || "var(--muted-2)", width: 18, height: 18, fontSize: 10 }}>
                {SOURCES[it.source]?.glyph || "·"}
              </span>
              <div className="inbox-page-main">
                <div className="inbox-page-title">{it.title}</div>
                <div className="inbox-page-meta">
                  from {SOURCES[it.source]?.label || it.source}
                </div>
              </div>
              <div className="inbox-page-actions">
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "today"); }}      className="action today">→ Today</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "this_week"); }}  className="action">→ Week</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "this_month"); }} className="action">→ Month</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "backlog"); }}    className="action">→ Later</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "drop"); }}       className="action drop">Drop</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {view === "byGoal" ? (
        <GoalGroupedTasks
          tasks={allTasks || []}
          goals={goals}
          doneSet={doneSet}
          toggleDone={toggleDone}
          onOpenDetail={onOpenDetail}
          onChangeLane={onChangeLane}
        />
      ) : (
        <>
          {/* ─── This week (rendered by parent — uses OnDeck from app.jsx) ─── */}
          <div style={{ marginTop: 28 }}>{weekSlot}</div>

          {/* ─── This month (lighter, no theme groupings) ─── */}
          <LaneListSection
            title="This month"
            sub="Soonish. Items here decay to Backlog after 30 days untouched."
            tasks={thisMonthTasks}
            doneSet={doneSet}
            toggleDone={toggleDone}
            onOpenDetail={onOpenDetail}
            onChangeLane={onChangeLane}
            emptyText="Empty for now. Newly-synced tasks land here after the first triage decision."
          />

          {/* ─── Backlog (collapsed by default) ─── */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
            <div className="section-head">
              <div>
                <div className="section-title">Backlog</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  The holding pen. No timeline. Won't surface in recommendations.
                </div>
              </div>
              <div className="section-meta">
                <button
                  className="ondeck-reenrich"
                  onClick={() => setShowBacklog(s => !s)}>
                  {showBacklog ? "Hide" : `Show ${backlogTasks.length}`}
                </button>
              </div>
            </div>
            {showBacklog && (
              <LaneListSection
                title=""
                sub=""
                tasks={backlogTasks}
                doneSet={doneSet}
                toggleDone={toggleDone}
                onOpenDetail={onOpenDetail}
                onChangeLane={onChangeLane}
                emptyText="Backlog is empty."
                hideHeader
              />
            )}
          </section>
        </>
      )}
    </main>
  );
}

// GoalGroupedTasks — default Tasks view. Walks the goal tree and shows
// one section per monthly milestone with its linked tasks. Goals with no
// active tasks are hidden so the page isn't cluttered with empty cards.
// Tasks without a primary_goal_id fall into the "Unlinked" section at
// the bottom — these are usually freshly-synced items not yet triaged
// against the goal hierarchy.
function GoalGroupedTasks({ tasks, goals, doneSet, toggleDone, onOpenDetail, onChangeLane }) {
  const tasksByGoal = React.useMemo(() => {
    const map = new Map();
    const unlinked = [];
    for (const t of (tasks || [])) {
      if (t.primaryGoalId) {
        if (!map.has(t.primaryGoalId)) map.set(t.primaryGoalId, []);
        map.get(t.primaryGoalId).push(t);
      } else {
        unlinked.push(t);
      }
    }
    // Sort tasks within each bucket by weight desc, then by lane (so this_week
    // floats above this_month above backlog within a goal's task list).
    const LANE_RANK = { now: 0, today: 1, this_week: 2, this_month: 3, backlog: 4 };
    const sortFn = (a, b) => {
      const dw = (b.weight ?? 0) - (a.weight ?? 0);
      if (Math.abs(dw) > 0.02) return dw;
      return (LANE_RANK[a.lane] ?? 5) - (LANE_RANK[b.lane] ?? 5);
    };
    for (const arr of map.values()) arr.sort(sortFn);
    unlinked.sort(sortFn);
    return { map, unlinked };
  }, [tasks]);

  // Build "monthly under annual" hierarchy for ordered rendering.
  const sections = React.useMemo(() => {
    const out = [];
    const annuals = goals?.annual || [];
    const quarterlies = goals?.quarterly || [];
    const monthlies = goals?.monthly || [];
    // Index for resolving parent chain (monthly → quarterly → annual)
    const qById = new Map(quarterlies.map(q => [q.id, q]));
    const aById = new Map(annuals.map(a => [a.id, a]));

    // Walk annual goals in declaration order; within each, list monthly
    // descendants in declaration order; tasks linked to quarterly directly
    // or annual directly get their own subsections.
    for (const annual of annuals) {
      const annualMonthlies = monthlies.filter(m => {
        const q = qById.get(m.parent);
        return q ? q.parent === annual.id : m.parent === annual.id;
      });
      const sectionGoals = [];
      for (const m of annualMonthlies) {
        const linked = tasksByGoal.map.get(m.id) || [];
        if (linked.length > 0) sectionGoals.push({ goal: m, horizon: "monthly", tasks: linked });
      }
      // Quarterly-direct tasks (rare but possible)
      const annualQuarterlies = quarterlies.filter(q => q.parent === annual.id);
      for (const q of annualQuarterlies) {
        const linked = tasksByGoal.map.get(q.id) || [];
        if (linked.length > 0) sectionGoals.push({ goal: q, horizon: "quarterly", tasks: linked });
      }
      // Annual-direct tasks (also rare)
      const annualDirect = tasksByGoal.map.get(annual.id) || [];
      if (annualDirect.length > 0) {
        sectionGoals.push({ goal: annual, horizon: "annual", tasks: annualDirect });
      }
      if (sectionGoals.length > 0) {
        out.push({ annual, sectionGoals });
      }
    }
    return out;
  }, [goals, tasksByGoal]);

  const totalLinked = React.useMemo(
    () => [...tasksByGoal.map.values()].reduce((n, arr) => n + arr.length, 0),
    [tasksByGoal]
  );

  return (
    <>
      {sections.length === 0 && tasksByGoal.unlinked.length === 0 && (
        <div className="empty-state" style={{ padding: "60px 20px", marginTop: 28 }}>
          <div className="empty-state-icon" />
          <div className="empty-state-title">No tasks yet.</div>
          <div className="empty-state-sub">Sync a source or capture something in the brain dump above.</div>
        </div>
      )}

      {sections.map(({ annual, sectionGoals }) => (
        <section key={annual.id} className="goal-tasks-section" style={{ marginTop: 28 }}>
          <div className="section-head">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="goal-color-bar" style={{ background: annual.color || "#5e6ad2", width: 20, height: 3 }} />
              <div>
                <div className="section-title">{annual.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {sectionGoals.reduce((n, g) => n + g.tasks.length, 0)} task{sectionGoals.reduce((n, g) => n + g.tasks.length, 0) === 1 ? "" : "s"} contributing
                </div>
              </div>
            </div>
          </div>
          {sectionGoals.map(({ goal, horizon, tasks }) => (
            <div key={goal.id} className="goal-tasks-subsection">
              <div className="goal-tasks-subhead">
                <span className="goal-tasks-horizon">{horizon}</span>
                <span className="goal-tasks-subname">{goal.title}</span>
                <span className="goal-tasks-subcount">{tasks.length}</span>
              </div>
              <LaneListSection
                title=""
                sub=""
                tasks={tasks}
                doneSet={doneSet}
                toggleDone={toggleDone}
                onOpenDetail={onOpenDetail}
                onChangeLane={onChangeLane}
                emptyText=""
                hideHeader
              />
            </div>
          ))}
        </section>
      ))}

      {tasksByGoal.unlinked.length > 0 && (
        <section className="goal-tasks-section" style={{ marginTop: 32 }}>
          <div className="section-head">
            <div>
              <div className="section-title" style={{ color: "var(--muted)" }}>Unlinked</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Tasks not yet tied to any goal. The enrichment agent may pick these up on the next pass; meanwhile, you can manually link via Goal-page breakdown.
              </div>
            </div>
            <div className="section-meta">
              <b>{tasksByGoal.unlinked.length}</b>
            </div>
          </div>
          <LaneListSection
            title=""
            sub=""
            tasks={tasksByGoal.unlinked}
            doneSet={doneSet}
            toggleDone={toggleDone}
            onOpenDetail={onOpenDetail}
            onChangeLane={onChangeLane}
            emptyText=""
            hideHeader
          />
        </section>
      )}

      {totalLinked === 0 && tasksByGoal.unlinked.length === 0 && (
        <div style={{ marginTop: 28, fontSize: 12, color: "var(--muted-2)", fontStyle: "italic" }}>
          Once tasks are linked to your goals (via the Goal page's ✨ Break into tasks button, or as the enrichment agent classifies new syncs), they'll cluster here.
        </div>
      )}
    </>
  );
}

// Compact list section — used for this_month and backlog. No theming, no
// below-the-line foldout; just a clean grouped list ordered by weight.
function LaneListSection({ title, sub, tasks, doneSet, toggleDone, onOpenDetail, onChangeLane, emptyText, hideHeader }) {
  const sorted = useMemo(
    () => [...tasks].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
    [tasks],
  );
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: hideHeader ? 0 : 28 }}>
      {!hideHeader && (
        <div className="section-head">
          <div>
            <div className="section-title">{title}</div>
            {sub && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {sub}
              </div>
            )}
          </div>
          <div className="section-meta">
            <b>{tasks.length}</b>
          </div>
        </div>
      )}
      {sorted.length === 0 ? (
        <div className="empty-state" style={{ padding: "24px 20px" }}>
          <div className="empty-state-icon" />
          <div className="empty-state-sub">{emptyText}</div>
        </div>
      ) : (
        <div className="task-list">
          {sorted.map(t => (
            <div
              key={t.id}
              className={`task-row no-drag ${doneSet.has(t.id) ? "done" : ""}`}
              onClick={() => onOpenDetail?.(t.id)}>
              <button
                className="check check-btn"
                onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }}
                aria-label={doneSet.has(t.id) ? "Mark undone" : "Mark done"}>
                <Icon.check />
              </button>
              <div className="task-main">
                <div className="task-title">
                  {t.primaryGoalId && (t.weight ?? 0) >= 0.5 && (
                    <span className="row-milestone-flag" title="Direct contributor to a milestone">
                      <Icon.milestone />
                    </span>
                  )}
                  {t.title}
                </div>
                {t.theme && (
                  <div className="task-note" style={{ fontStyle: "italic", color: "var(--muted)" }}>
                    {t.theme}
                  </div>
                )}
              </div>
              <div className="task-right">
                <SourceChip id={t.source} />
                {t.project && <span className="row-project mono">{t.project}</span>}
                {t.due && <span className="estimate mono">{t.due}</span>}
                {typeof t.weight === "number" && (
                  <span className={`ondeck-weight ${t.weight >= 0.7 ? "high" : t.weight >= 0.3 ? "mid" : "low"}`}>
                    {Math.round(t.weight * 100)}
                  </span>
                )}
                {onChangeLane && quickLaneActionsForRow(t.lane).map((a) => (
                  <button
                    key={a.target}
                    className="quick-lane-btn"
                    title={a.title}
                    onClick={(e) => { e.stopPropagation(); onChangeLane(t.id, a.target); }}>
                    {a.icon}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

Object.assign(window, { CalendarPage, TasksPage });

/* ─────────────────────────────────────────────────────────────
   Goals page
   ───────────────────────────────────────────────────────────── */
function ProgressRing({ value, size = 60, stroke = 4, color = "var(--ink)" }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    // viewBox lets CSS scale the ring at narrow breakpoints without distorting
    // the stroke positions — coordinates stay in the original user-unit space.
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${C * value} ${C}`}
        transform={`rotate(-90 ${size/2} ${size/2})`}
      />
    </svg>
  );
}

/* ── Editable helpers ─────────────────────────────────────────────────
   Click a value to edit it; blur or Enter saves, Escape cancels.
   Optimistic updates land in App state via onCommit. */
function EditableText({ value, className, multiline, placeholder, onCommit }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  if (!editing) {
    return (
      <span
        className={`editable ${className || ""}`}
        title="Click to edit"
        onClick={() => setEditing(true)}>
        {value || <span className="editable-empty">{placeholder || "—"}</span>}
      </span>
    );
  }
  const Tag = multiline ? "textarea" : "input";
  const save = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "").trim()) onCommit?.(trimmed);
  };
  return (
    <Tag
      autoFocus
      className={`editable-input ${className || ""}`}
      value={draft}
      placeholder={placeholder}
      rows={multiline ? 3 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
        if (e.key === "Enter" && !multiline) { e.preventDefault(); save(); }
        if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      }}
    />
  );
}

function EditablePercent({ value, onCommit, className }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(Math.round((value || 0) * 100));
  React.useEffect(() => { if (!editing) setDraft(Math.round((value || 0) * 100)); }, [value, editing]);

  const save = () => {
    setEditing(false);
    const n = Math.max(0, Math.min(100, Number(draft) || 0));
    const next = Math.round(n) / 100;
    if (next !== value) onCommit?.(next);
  };
  if (!editing) {
    return (
      <span className={`editable ${className || ""}`} title="Click to edit" onClick={() => setEditing(true)}>
        {Math.round((value || 0) * 100)}%
      </span>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      min={0} max={100} step={5}
      className={`editable-input ${className || ""}`}
      style={{ width: 64, textAlign: "right" }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setDraft(Math.round((value || 0) * 100)); setEditing(false); }
        if (e.key === "Enter") { e.preventDefault(); save(); }
      }}
    />
  );
}

function TrendSelect({ value, onCommit }) {
  const opts = [
    { id: "on-track", label: "→ on track" },
    { id: "ahead",    label: "↑ ahead of pace" },
    { id: "behind",   label: "↓ behind pace" },
  ];
  const cur = opts.find(o => o.id === value) || opts[0];
  const [open, setOpen] = React.useState(false);
  return (
    <span className={`editable goal-trend ${value || "on-track"}`} onClick={() => setOpen(o => !o)} title="Click to change trend">
      {cur.label}
      {open && (
        <span className="trend-popover" onClick={(e) => e.stopPropagation()}>
          {opts.map(o => (
            <button
              key={o.id}
              className={`trend-popover-item ${o.id === value ? "active" : ""}`}
              onClick={() => { onCommit?.(o.id); setOpen(false); }}>
              {o.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// BreakdownModal — runs the breakdown agent on an annual goal, lets the user
// pick which quarterly + monthly milestones to commit. Quarterly goals are
// inserted first so we have their ids to use as `parent` on the monthlies.
function BreakdownModal({ annual, onClose, onCommitted }) {
  const [phase, setPhase] = React.useState("loading"); // loading | review | committing | error
  const [proposal, setProposal] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [refinement, setRefinement] = React.useState("");
  // Per-proposal selection. Keyed by `q:Q1` or `m:May`. Already-existing slots
  // default to unchecked (the user already has something there).
  const [selected, setSelected] = React.useState(new Set());

  const fetchProposal = React.useCallback(async (refinementText) => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const r = await fetch(`/api/goals/annual/${encodeURIComponent(annual.id)}/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refinementText ? { refinement: refinementText } : {}),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `${r.status}`);
      }
      const data = await r.json();
      setProposal(data);
      // Default-select forward-looking proposals that don't conflict with
      // an existing milestone. Skip "past" entries — those are retrospectives
      // the user can opt into as backfill but shouldn't auto-commit.
      const next = new Set();
      for (const p of data.quarterly || []) {
        if (!p.alreadyExists && p.status !== "past") next.add(`q:${p.quarter}`);
      }
      for (const p of data.monthly || []) {
        if (!p.alreadyExists && p.status !== "past") next.add(`m:${p.month}`);
      }
      setSelected(next);
      setPhase("review");
    } catch (err) {
      setErrorMsg(err.message || String(err));
      setPhase("error");
    }
  }, [annual.id]);

  React.useEffect(() => { fetchProposal(); }, [fetchProposal]);

  const toggle = (key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleCommit = async () => {
    if (!proposal || selected.size === 0) return;
    setPhase("committing");
    try {
      // Quarterly first so we know their ids when wiring monthly parents.
      // Map quarter label → created id, for parent linkage.
      const createdQuarterId = {};
      for (const p of proposal.quarterly) {
        if (!selected.has(`q:${p.quarter}`)) continue;
        const r = await fetch("/api/goals/quarterly", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${p.quarter}: ${p.title}`,
            parent: annual.id,
          }),
        });
        if (!r.ok) throw new Error(`quarterly ${p.quarter}: ${r.status}`);
        const created = await r.json();
        createdQuarterId[p.quarter] = created.id;
      }
      // Monthly: parent should be the quarterly we just created (if any),
      // else the existing quarterly in that slot (if any), else fall back
      // to the annual id which the schema accepts as a parent string.
      for (const p of proposal.monthly) {
        if (!selected.has(`m:${p.month}`)) continue;
        const quarterOfMonth = monthToQuarter(p.month);
        let parent = createdQuarterId[quarterOfMonth];
        if (!parent) {
          // No new quarterly committed this round — try to find an existing
          // quarterly under this annual. Fall back to annual.id as parent.
          parent = annual.id;
        }
        const r = await fetch("/api/goals/monthly", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `${p.month}: ${p.title}`,
            parent,
            nextStep: p.target,
          }),
        });
        if (!r.ok) throw new Error(`monthly ${p.month}: ${r.status}`);
      }
      onCommitted?.();
    } catch (err) {
      setErrorMsg(err.message || String(err));
      setPhase("error");
    }
  };

  const Q_ORDER = ["Q1", "Q2", "Q3", "Q4"];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-breakdown" onClick={(e) => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="modal-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon.tree style={{ color: "var(--accent)" }} />
          <span>Break it down</span>
          {proposal && (
            <span style={{ color: "var(--muted)" }}>
              · {proposal.context.year} · current: {proposal.context.currentQuarter} / {proposal.context.currentMonth}
            </span>
          )}
        </div>
        <h2 className="breakdown-annual-title">{annual.title}</h2>
        {annual.intent && <div className="breakdown-annual-intent">{annual.intent}</div>}

        {phase === "loading" && (
          <div className="breakdown-loading">
            <div className="breakdown-spinner" />
            <div>Thinking through quarterly + monthly milestones…</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 4 }}>
              Adaptive thinking on Claude Opus 4.7 — usually 10–20 seconds.
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="breakdown-error">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn't generate a breakdown.</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{errorMsg}</div>
            <button className="rec-pull" style={{ marginTop: 14, marginLeft: 0 }} onClick={() => fetchProposal(refinement)}>
              Try again
            </button>
          </div>
        )}

        {(phase === "review" || phase === "committing") && proposal && (
          <>
            <div className="breakdown-section-label">Quarterly milestones</div>
            <div className="breakdown-list">
              {Q_ORDER.map(q => {
                const p = proposal.quarterly.find(x => x.quarter === q);
                if (!p) return null;
                const key = `q:${q}`;
                const eyebrow = p.status === "past" ? "retrospective"
                              : p.status === "current" ? "current" : null;
                return (
                  <BreakdownCard
                    key={key}
                    label={q}
                    labelMuted={eyebrow}
                    status={p.status}
                    title={p.title}
                    target={p.target}
                    reasoning={p.reasoning}
                    alreadyExists={p.alreadyExists}
                    existingTitle={p.existingTitle}
                    checked={selected.has(key)}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </div>

            <div className="breakdown-section-label">
              Monthly milestones · {proposal.context.currentQuarter}
            </div>
            <div className="breakdown-list">
              {proposal.monthly.map(p => {
                const key = `m:${p.month}`;
                const eyebrow = p.status === "past" ? "retrospective"
                              : p.status === "current" ? "this month" : null;
                return (
                  <BreakdownCard
                    key={key}
                    label={p.month}
                    labelMuted={eyebrow}
                    status={p.status}
                    title={p.title}
                    target={p.target}
                    reasoning={p.reasoning}
                    alreadyExists={p.alreadyExists}
                    existingTitle={p.existingTitle}
                    checked={selected.has(key)}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </div>

            <div className="breakdown-actions">
              <div className="breakdown-refinement">
                <input
                  type="text"
                  placeholder="Regenerate with feedback (optional, e.g. 'more focused on writing')"
                  value={refinement}
                  onChange={(e) => setRefinement(e.target.value)}
                  disabled={phase === "committing"}
                />
                <button
                  className="rec-defer"
                  onClick={() => fetchProposal(refinement)}
                  disabled={phase === "committing"}>
                  ↻ Regenerate
                </button>
              </div>
              <button
                className="rec-pull"
                onClick={handleCommit}
                disabled={selected.size === 0 || phase === "committing"}>
                {phase === "committing"
                  ? "Committing…"
                  : selected.size === 0
                  ? "Select at least one"
                  : `Commit ${selected.size} milestone${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BreakdownCard({ label, labelMuted, status, title, target, reasoning, alreadyExists, existingTitle, checked, onToggle }) {
  return (
    <label className={`breakdown-card ${checked ? "checked" : ""} ${alreadyExists ? "already" : ""} status-${status || "current"}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="breakdown-card-body">
        <div className="breakdown-card-head">
          <span className="breakdown-card-label">{label}</span>
          {labelMuted && <span className="breakdown-card-label-muted">{labelMuted}</span>}
          {alreadyExists && (
            <span className="breakdown-already">
              already set: <em>{existingTitle}</em>
            </span>
          )}
        </div>
        <div className="breakdown-card-title">{title}</div>
        <div className="breakdown-card-target">
          {status === "past" ? "○ " : "→ "}{target}
        </div>
        <div className="breakdown-card-reasoning">{reasoning}</div>
      </div>
    </label>
  );
}

function monthToQuarter(month) {
  const map = {
    Jan: "Q1", Feb: "Q1", Mar: "Q1",
    Apr: "Q2", May: "Q2", Jun: "Q2",
    Jul: "Q3", Aug: "Q3", Sep: "Q3",
    Oct: "Q4", Nov: "Q4", Dec: "Q4",
  };
  return map[month];
}

// TaskBreakdownModal — takes a monthly milestone, runs the task-breakdown
// agent, lets the user review proposals + check the ones to commit. The
// commit endpoint creates tasks atomically with primary_goal_id pre-set so
// they show up correctly ranked + linked from the moment they exist.
function TaskBreakdownModal({ monthly, onClose, onCommitted }) {
  const [phase, setPhase] = React.useState("loading"); // loading | review | committing | error
  const [proposal, setProposal] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  // Selected NEW tasks (indices into proposal.tasks) and selected EXISTING
  // tasks to link (ids from proposal.relatedExisting).
  const [selected, setSelected] = React.useState(new Set());
  const [selectedExisting, setSelectedExisting] = React.useState(new Set());

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading");
      try {
        const r = await fetch(`/api/goals/monthly/${encodeURIComponent(monthly.id)}/break-into-tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || body.error || `${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        setProposal(data);
        // Default-select all new tasks AND all agent-flagged existing links —
        // user unchecks what doesn't apply.
        setSelected(new Set(data.tasks.map((_, i) => i)));
        setSelectedExisting(new Set((data.relatedExisting || []).map((x) => x.id)));
        setPhase("review");
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err.message || String(err));
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [monthly.id]);

  const toggle = (i) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };
  const toggleExisting = (id) => {
    setSelectedExisting(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalSelected = selected.size + selectedExisting.size;

  const handleCommit = async () => {
    if (!proposal || totalSelected === 0) return;
    setPhase("committing");
    try {
      const picks = proposal.tasks.filter((_, i) => selected.has(i));
      const linkExistingIds = [...selectedExisting];
      const r = await fetch(`/api/goals/monthly/${encodeURIComponent(monthly.id)}/commit-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: picks, linkExistingIds }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `${r.status}`);
      }
      onCommitted?.();
    } catch (err) {
      setErrorMsg(err.message || String(err));
      setPhase("error");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-breakdown" onClick={(e) => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="modal-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon.tree style={{ color: "var(--accent)" }} />
          <span>Break into tasks</span>
          {proposal?.parent?.annual && (
            <span style={{ color: "var(--muted)" }}>
              · ladders to {proposal.parent.annual.title}
            </span>
          )}
        </div>
        <h2 className="breakdown-annual-title">{monthly.title}</h2>
        {monthly.nextStep && (
          <div className="breakdown-annual-intent">Next step: {monthly.nextStep}</div>
        )}

        {phase === "loading" && (
          <div className="breakdown-loading">
            <div className="breakdown-spinner" />
            <div>Thinking through concrete next-step tasks…</div>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 4 }}>
              Adaptive thinking on Claude Opus 4.7 — usually 10–20 seconds.
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="breakdown-error">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn't generate tasks.</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{errorMsg}</div>
            <button className="rec-pull" style={{ marginTop: 14, marginLeft: 0 }} onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {(phase === "review" || phase === "committing") && proposal && (
          <>
            {(proposal.relatedExisting || []).length > 0 && (
              <>
                <div className="breakdown-section-label">
                  Existing tasks the agent thinks already ladder here · {proposal.relatedExisting.length}
                </div>
                <div className="breakdown-list">
                  {proposal.relatedExisting.map((t) => (
                    <ExistingLinkCard
                      key={t.id}
                      task={t}
                      checked={selectedExisting.has(t.id)}
                      onToggle={() => toggleExisting(t.id)}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="breakdown-section-label">
              New tasks for this milestone · {proposal.tasks.length} proposed
            </div>
            <div className="breakdown-list">
              {proposal.tasks.map((t, i) => (
                <TaskProposalCard
                  key={i}
                  task={t}
                  checked={selected.has(i)}
                  onToggle={() => toggle(i)}
                />
              ))}
            </div>

            <div className="breakdown-actions">
              <div style={{ flex: 1, fontSize: 11.5, color: "var(--muted)" }}>
                New tasks land in <b>This week</b>. Existing tasks get linked to this milestone in place — no duplicates.
              </div>
              <button
                className="rec-pull"
                onClick={handleCommit}
                disabled={totalSelected === 0 || phase === "committing"}
                style={{ alignSelf: "flex-end", marginLeft: 0 }}>
                {phase === "committing"
                  ? "Committing…"
                  : totalSelected === 0
                  ? "Select at least one"
                  : `Commit ${totalSelected}${selectedExisting.size > 0 ? ` (${selected.size} new, ${selectedExisting.size} linked)` : selected.size === 1 ? " task" : " tasks"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExistingLinkCard({ task, checked, onToggle }) {
  return (
    <label className={`breakdown-card existing-link ${checked ? "checked" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="breakdown-card-body">
        <div className="breakdown-card-head">
          <span className="breakdown-card-label">EXISTING</span>
          {task.lane && <span className="breakdown-card-label-muted">{task.lane.replace("_", " ")}</span>}
          {task.project && <span className="breakdown-card-label-muted">{task.project}</span>}
        </div>
        <div className="breakdown-card-title">{task.title}</div>
        {task.reasoning && <div className="breakdown-card-reasoning">{task.reasoning}</div>}
      </div>
    </label>
  );
}

function TaskProposalCard({ task, checked, onToggle }) {
  return (
    <label className={`breakdown-card ${checked ? "checked" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="breakdown-card-body">
        <div className="breakdown-card-head">
          <span className="breakdown-card-label">{task.estimateMin}m</span>
          {task.tag && <span className="breakdown-card-label-muted">{task.tag}</span>}
          {task.due && (
            <span className="breakdown-card-label-muted" style={{ color: "var(--accent-4)" }}>
              due {task.due}
            </span>
          )}
        </div>
        <div className="breakdown-card-title">{task.title}</div>
        {task.note && <div className="breakdown-card-target">→ {task.note}</div>}
        {task.reasoning && <div className="breakdown-card-reasoning">{task.reasoning}</div>}
      </div>
    </label>
  );
}

// ContextModal — small focused editor for the per-goal "context for the agent"
// field. Opened from the notes-icon button on each annual goal card. Saves
// on commit; doesn't auto-save on close so the user can cancel via Escape.
function ContextModal({ annual, onClose, onSave }) {
  const [draft, setDraft] = React.useState(annual.context || "");
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(draft.trim()); } finally { setSaving(false); }
  };
  // Escape closes without saving (matches OS-native modal behavior).
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-context" onClick={(e) => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon.notes style={{ color: "var(--accent)" }} />
          <span>Context for the agent</span>
        </div>
        <h2 className="breakdown-annual-title">{annual.title}</h2>
        <div className="breakdown-annual-intent" style={{ marginBottom: 18 }}>
          Strategy, constraints, what's already tried, available resources. The breakdown agent reads this on every run — the more specific you are here, the more grounded the proposals.
        </div>
        <textarea
          autoFocus
          rows={12}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Examples:
- "We have 6 months runway and no engineering team. Distribution is Twitter + cold email."
- "Already tried paid ads in Q1 (CAC too high). Best results: long-form SEO + partner intros."
- "Avoid anything that requires a sales team — we're solo founder + 1 PT contractor."`}
          style={{
            width: "100%",
            fontFamily: "inherit",
            fontSize: 13,
            lineHeight: 1.5,
            padding: "12px 14px",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            background: "var(--paper)",
            color: "var(--ink)",
            resize: "vertical",
            position: "relative",
          }}
        />
        <div className="breakdown-actions" style={{ marginTop: 16, paddingTop: 12 }}>
          <div style={{ flex: 1 }} />
          <button className="rec-pull" onClick={handleSave} disabled={saving}
                  style={{ alignSelf: "flex-end", marginLeft: 0 }}>
            {saving ? "Saving…" : "Save context"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoalsPage({ onSuggest, goals, onGoalsChange, tasks, doneSet, toggleDone, onOpenDetail }) {
  // Local copy for optimistic edits; resyncs whenever the prop updates.
  const [local, setLocal] = React.useState(goals);
  React.useEffect(() => setLocal(goals), [goals]);

  // The annual goal currently being broken down (modal target).
  const [breakdownAnnual, setBreakdownAnnual] = React.useState(null);
  // The annual goal whose agent-context is being edited (modal target).
  const [contextAnnual, setContextAnnual] = React.useState(null);
  // The monthly milestone being broken down into tasks (modal target).
  const [taskBreakdownMonthly, setTaskBreakdownMonthly] = React.useState(null);
  // Expanded monthly milestone IDs — show their linked tasks inline.
  const [expandedMonthlyIds, setExpandedMonthlyIds] = React.useState(() => new Set());
  const toggleMonthlyExpand = (id) => {
    setExpandedMonthlyIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Build a map of monthly_id → tasks laddering to it (via primary_goal_id
  // set by enrichment or by task-breakdown commit). Includes done tasks so
  // the "N tasks · M done" counter is honest.
  const tasksByMonthly = React.useMemo(() => {
    const map = new Map();
    (tasks || []).forEach((t) => {
      if (!t.primaryGoalId) return;
      if (!map.has(t.primaryGoalId)) map.set(t.primaryGoalId, []);
      map.get(t.primaryGoalId).push(t);
    });
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    }
    return map;
  }, [tasks]);

  const patchGoal = async (horizon, id, patch) => {
    setLocal(prev => ({
      ...prev,
      [horizon]: prev[horizon].map(g => g.id === id ? { ...g, ...patch } : g),
    }));
    try {
      const r = await fetch(`/api/goals/${horizon}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`${r.status}`);
    } catch (err) {
      console.warn("goal edit failed:", err);
    } finally {
      onGoalsChange?.();
    }
  };

  const deleteGoal = async (horizon, id) => {
    const label = horizon === "annual" ? "annual" : horizon === "quarterly" ? "quarterly" : "monthly";
    if (!confirm(`Delete this ${label} goal? Quarterly/monthly goals that ladder to it will keep a dangling parent.`)) return;
    setLocal(prev => ({
      ...prev,
      [horizon]: prev[horizon].filter(g => g.id !== id),
    }));
    try {
      const r = await fetch(`/api/goals/${horizon}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        // Server rejected — refresh restores the row. Alert the user so the
        // visual "removed then reappeared" isn't a mystery.
        const body = await r.json().catch(() => ({}));
        alert(`Couldn't delete this ${label} goal: ${body.detail || body.error || r.status}`);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message || err}`);
    } finally {
      onGoalsChange?.();
    }
  };

  const addGoal = async (horizon) => {
    try {
      await fetch(`/api/goals/${horizon}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch (err) {
      console.warn("add goal failed:", err);
    } finally {
      onGoalsChange?.();
    }
  };

  const safe = local || { annual: [], quarterly: [], monthly: [], year: "", quarter: "", month: "" };

  return (
    <main className="main" data-screen-label="Goals">
      <div className="topbar">
        <div>
          <div className="greeting-eyebrow">
            North star · {safe.year} · {safe.quarter} · {safe.month}
          </div>
          <h1 className="greeting">
            What this year is for.<br/>
            <em>Three big bets</em> that everything ladders to.
          </h1>
        </div>
        <div className="topbar-actions">
          <button className="suggest-btn" onClick={onSuggest}>
            <span className="suggest-btn-icon">✦</span>
            Suggest today's three
          </button>
        </div>
      </div>

      {/* Annual goals — three big cards */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-head">
          <div className="section-title">
            Annual · {safe.year}
            <button className="section-add" title="Add annual goal" onClick={() => addGoal("annual")}>+</button>
          </div>
          <div className="section-meta">{safe.annual.length} active</div>
        </div>
        <div className="goal-annual-grid">
          {safe.annual.map(g => (
            <div key={g.id} className="goal-annual-card">
              <div className="goal-card-halftone" style={{
                backgroundImage: `radial-gradient(circle at center, ${g.color || "#5e6ad2"} 1px, transparent 1.3px)`
              }} />
              <button className="goal-delete" title="Delete goal" onClick={() => deleteGoal("annual", g.id)}>×</button>
              <div className="goal-annual-head">
                <div className="goal-color-bar" style={{ background: g.color || "#5e6ad2" }} />
                <TrendSelect value={g.trend} onCommit={(v) => patchGoal("annual", g.id, { trend: v })} />
              </div>
              <div className="goal-annual-body">
                <ProgressRing value={g.progress || 0} size={72} stroke={5} color={g.color || "#5e6ad2"} />
                <div className="goal-annual-text">
                  <div className="goal-annual-title">
                    <EditableText value={g.title} placeholder="Untitled goal"
                                  onCommit={(v) => patchGoal("annual", g.id, { title: v })} />
                  </div>
                  <div className="goal-annual-intent">
                    <EditableText value={g.intent} placeholder="Why this matters." multiline
                                  onCommit={(v) => patchGoal("annual", g.id, { intent: v })} />
                  </div>
                </div>
              </div>
              <div className="goal-annual-foot">
                <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                  <span className="goal-pct mono">
                    <EditablePercent value={g.progress} onCommit={(v) => patchGoal("annual", g.id, { progress: v })} />
                  </span>
                  <span>target&nbsp;
                    <EditableText value={g.target} placeholder="Dec 2026"
                                  onCommit={(v) => patchGoal("annual", g.id, { target: v })} />
                  </span>
                </div>
                <button
                  className={`goal-breakdown-btn ${g.context ? "has-data" : ""}`}
                  title={g.context ? "Edit agent context" : "Add context for the agent (strategy, constraints, what's been tried)"}
                  onClick={() => setContextAnnual(g)}>
                  <Icon.notes />
                </button>
                <button
                  className="goal-breakdown-btn"
                  title="Break this goal into quarterly + monthly milestones with an LLM"
                  onClick={() => setBreakdownAnnual(g)}>
                  <Icon.tree />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {breakdownAnnual && (
        <BreakdownModal
          annual={breakdownAnnual}
          onClose={() => setBreakdownAnnual(null)}
          onCommitted={() => {
            setBreakdownAnnual(null);
            onGoalsChange?.();
          }}
        />
      )}

      {contextAnnual && (
        <ContextModal
          annual={contextAnnual}
          onClose={() => setContextAnnual(null)}
          onSave={async (newContext) => {
            await patchGoal("annual", contextAnnual.id, { context: newContext });
            setContextAnnual(null);
          }}
        />
      )}

      {/* Quarterly */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-head">
          <div className="section-title">
            This quarter · {safe.quarter}
            <button className="section-add" title="Add quarterly goal" onClick={() => addGoal("quarterly")}>+</button>
          </div>
          <div className="section-meta">
            <b>{safe.quarterly[0]?.weeksLeft ?? "—"}</b> weeks left
          </div>
        </div>
        <div className="goal-q-grid">
          {safe.quarterly.map(q => {
            const parent = safe.annual.find(a => a.id === q.parent);
            const color = parent?.color || "#5e6ad2";
            return (
              <div key={q.id} className="goal-q-card">
                <button className="goal-delete" title="Delete goal" onClick={() => deleteGoal("quarterly", q.id)}>×</button>
                <div className="goal-q-parent">
                  <span className="goal-q-parent-dot" style={{ background: color }} />
                  laddering to: {parent?.title || "(no parent — set via SQL)"}
                </div>
                <div className="goal-q-title">
                  <EditableText value={q.title} placeholder="Untitled"
                                onCommit={(v) => patchGoal("quarterly", q.id, { title: v })} />
                </div>
                <div className="goal-q-bar">
                  <div className="goal-q-bar-fill" style={{
                    width: `${(q.progress || 0) * 100}%`,
                    background: color,
                  }} />
                </div>
                <div className="goal-q-foot">
                  <span className="goal-pct mono">
                    <EditablePercent value={q.progress} onCommit={(v) => patchGoal("quarterly", q.id, { progress: v })} />
                  </span>
                  <span>{q.weeksLeft ?? "?"} wks left</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Monthly — denser */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-head">
          <div className="section-title">
            This month · {safe.month}
            <button className="section-add" title="Add monthly goal" onClick={() => addGoal("monthly")}>+</button>
          </div>
          <div className="section-meta">
            <b>{safe.monthly.length}</b> active
            <span className="divider-dot" />
            next-step tasks linked
          </div>
        </div>
        <div className="task-list">
          {safe.monthly.map(g => {
            const parent = safe.quarterly.find(q => q.id === g.parent) || safe.annual.find(a => a.id === g.parent);
            const annual = parent
              ? (safe.annual.find(a => a.id === (parent.parent || parent.id)) || parent)
              : safe.annual[0];
            const color = annual?.color || "#5e6ad2";
            const linkedTasks = tasksByMonthly?.get(g.id) || [];
            const linkedDone = linkedTasks.filter(t => (doneSet && doneSet.has(t.id)) || t.doneAt).length;
            const linkedOpen = linkedTasks.length - linkedDone;
            const isExpanded = expandedMonthlyIds.has(g.id);
            return (
              <React.Fragment key={g.id}>
                <div className="task-row no-drag" style={{ cursor: "default" }}>
                  <span className="check" style={{ border: 0 }}>
                    <ProgressRing value={g.progress || 0} size={22} stroke={2.5} color={color} />
                  </span>
                  <div className="task-main">
                    <div className="task-title">
                      <EditableText value={g.title} placeholder="Untitled"
                                    onCommit={(v) => patchGoal("monthly", g.id, { title: v })} />
                    </div>
                    <div className="task-note">
                      <span style={{
                        display: "inline-block", width: 5, height: 5, borderRadius: 999,
                        background: color, marginRight: 6, verticalAlign: "middle"
                      }} />
                      Next:&nbsp;
                      <EditableText value={g.nextStep} placeholder="Next concrete step"
                                    onCommit={(v) => patchGoal("monthly", g.id, { nextStep: v })} />
                    </div>
                  </div>
                  <div className="task-right">
                    {linkedTasks.length > 0 && (
                      <button
                        className="monthly-tasks-count"
                        title={isExpanded ? "Hide linked tasks" : "Show linked tasks"}
                        onClick={() => toggleMonthlyExpand(g.id)}>
                        <span className="mono">{linkedTasks.length}</span>
                        <span style={{ color: "var(--muted-2)" }}>
                          {linkedDone > 0 ? ` · ${linkedDone} done` : ""}
                        </span>
                        <span className="monthly-tasks-chevron">{isExpanded ? "▾" : "▸"}</span>
                      </button>
                    )}
                    <span className="goal-pct mono">
                      <EditablePercent value={g.progress} onCommit={(v) => patchGoal("monthly", g.id, { progress: v })} />
                    </span>
                    <button
                      className="monthly-break-tasks-btn"
                      title="Break this monthly milestone into tasks with an LLM"
                      onClick={() => setTaskBreakdownMonthly(g)}>
                      <Icon.tree />
                    </button>
                    <button className="goal-delete-inline" title="Delete" onClick={() => deleteGoal("monthly", g.id)}>×</button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="monthly-tasks-expanded">
                    {linkedTasks.length === 0 ? (
                      <div className="monthly-tasks-empty">
                        No tasks laddering to this milestone yet. Click the 🌳 button to generate some.
                      </div>
                    ) : (
                      linkedTasks.map((t) => {
                        const done = doneSet?.has(t.id) || Boolean(t.doneAt);
                        return (
                          <div key={t.id} className={`monthly-linked-task ${done ? "done" : ""}`}>
                            <button
                              className="check check-btn"
                              onClick={(e) => { e.stopPropagation(); toggleDone?.(t.id); }}
                              aria-label={done ? "Mark undone" : "Mark done"}>
                              <Icon.check />
                            </button>
                            <span
                              className="monthly-linked-task-title"
                              onClick={() => onOpenDetail?.(t.id)}>
                              {t.title}
                            </span>
                            <span className="monthly-linked-task-meta">
                              {t.lane && <span className="monthly-linked-task-lane">{t.lane.replace("_", " ")}</span>}
                              {t.estimate && <span className="monthly-linked-task-est">{t.estimate}m</span>}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {taskBreakdownMonthly && (
        <TaskBreakdownModal
          monthly={taskBreakdownMonthly}
          onClose={() => setTaskBreakdownMonthly(null)}
          onCommitted={() => {
            setTaskBreakdownMonthly(null);
            onGoalsChange?.();
          }}
        />
      )}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────
   Suggestion modal — shown when the user clicks "Suggest tasks"
   ───────────────────────────────────────────────────────────── */
function SuggestionModal({ open, onClose, onAcceptAll, onAccept }) {
  const [suggestions, setSuggestions] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [source, setSource] = React.useState("agent");
  // Per-row accept state: idx → "idle" | "adding" | "added" | "error"
  const [rowState, setRowState] = React.useState({});
  // All-three commit lock so the user can't double-fire while it's running.
  const [acceptingAll, setAcceptingAll] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSuggestions(null);
    setRowState({});
    setAcceptingAll(false);
    fetch("/api/suggest", { method: "POST", headers: { "Content-Type": "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSuggestions(data.suggestions || []);
        setSource("agent");
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestions(getSuggestions());
        setSource("local");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="modal-eyebrow">
          <span>✦</span> {loading ? "Thinking…" : source === "agent" ? "Suggested by Claude" : "Suggested from your goals"}
        </div>
        <h2 className="modal-title">Today's three.<br/><em>Pulled straight from what you said matters.</em></h2>
        <p className="modal-sub">
          {loading
            ? "Reading your goals, today's calendar, and recent completions to pick three…"
            : "These are the next-step tasks tied to the monthly goals furthest from pace. Pick the ones that feel right — you don't have to accept all three."}
        </p>

        {loading && (
          <div className="suggest-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="suggest-row" style={{ opacity: 0.5 }}>
                <div className="suggest-num" style={{ background: "var(--muted-2)" }}>{i + 1}</div>
                <div className="suggest-body">
                  <div className="suggest-task" style={{ color: "var(--muted)" }}>…</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && suggestions && (
        <div className="suggest-list">
          {suggestions.map((s, i) => {
            const annual = s.annual;
            return (
              <div key={i} className="suggest-row">
                <div className="suggest-num" style={{ background: annual.color }}>{i + 1}</div>
                <div className="suggest-body">
                  <div className="suggest-task">{s.task?.title || s.goal.nextStep}</div>
                  <div className="suggest-chain">
                    laddering to
                    <span className="suggest-chain-link">{s.goal.title}</span>
                    →
                    <span className="suggest-chain-link" style={{ color: annual.color }}>{annual.title}</span>
                  </div>
                  <div className="suggest-reason">{s.reason}</div>
                </div>
                <div className="suggest-actions">
                  <button
                    className="suggest-accept"
                    disabled={rowState[i] === "adding" || rowState[i] === "added" || acceptingAll}
                    onClick={async () => {
                      if (!onAccept) return;
                      setRowState((r) => ({ ...r, [i]: "adding" }));
                      try {
                        const res = await onAccept(s);
                        setRowState((r) => ({ ...r, [i]: res?.ok === false ? "error" : "added" }));
                      } catch {
                        setRowState((r) => ({ ...r, [i]: "error" }));
                      }
                    }}>
                    {rowState[i] === "adding" ? "…" :
                     rowState[i] === "added"  ? "✓ Added" :
                     rowState[i] === "error"  ? "Retry" :
                                                "+ Add"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}

        <div className="modal-foot">
          <button className="modal-secondary" onClick={onClose}>Not now</button>
          <button
            className="modal-primary"
            disabled={loading || acceptingAll || !suggestions || suggestions.length === 0}
            onClick={async () => {
              if (!onAccept || !suggestions) return;
              setAcceptingAll(true);
              // Sequential — each PATCH/POST does a refresh; serial keeps
              // the Today-cap check honest (parallel could fail to enforce).
              for (let i = 0; i < suggestions.length; i++) {
                if (rowState[i] === "added") continue;
                setRowState((r) => ({ ...r, [i]: "adding" }));
                try {
                  const res = await onAccept(suggestions[i]);
                  setRowState((r) => ({ ...r, [i]: res?.ok === false ? "error" : "added" }));
                } catch {
                  setRowState((r) => ({ ...r, [i]: "error" }));
                }
              }
              setAcceptingAll(false);
              onAcceptAll?.();
            }}>
            {acceptingAll ? "Adding…" : "Accept all three →"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Settings page — configure API keys + integrations
   ───────────────────────────────────────────────────────────── */
function SettingsPage({ profile, onProfileChange, onTasksMutated, theme, onThemeChange }) {
  const [fields, setFields] = React.useState(null);
  const [authStatus, setAuthStatus] = React.useState(null);
  const [syncs, setSyncs] = React.useState({});
  const [drafts, setDrafts] = React.useState({});
  const [savedMsg, setSavedMsg] = React.useState({});
  const [profileDraft, setProfileDraft] = React.useState({ name: "", email: "", initials: "", context: "" });
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [profileMsg, setProfileMsg] = React.useState(null);
  const [apiToken, setApiToken] = React.useState(null);
  const [apiTokenMsg, setApiTokenMsg] = React.useState(null);
  const [showGoogleAdvanced, setShowGoogleAdvanced] = React.useState(false);

  const reload = React.useCallback(async () => {
    const [s, a, sy, tk] = await Promise.all([
      fetch("/api/settings").then(r => r.json()),
      fetch("/auth/status").then(r => r.json()),
      fetch("/api/sync").then(r => r.json()),
      fetch("/api/auth/token").then(r => r.json()),
    ]);
    setFields(s.fields);
    setAuthStatus(a);
    setSyncs(Object.fromEntries((sy.syncs || []).map(x => [x.source, x])));
    setApiToken(tk.token || null);
  }, []);

  React.useEffect(() => { reload(); }, [reload]);

  const saveField = async (key) => {
    const value = drafts[key]?.trim();
    if (!value) return;
    setSavedMsg(m => ({ ...m, [key]: { type: "saving" } }));
    try {
      const r = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!r.ok) throw new Error(await r.text());
      setDrafts(d => ({ ...d, [key]: "" }));
      setSavedMsg(m => ({ ...m, [key]: { type: "ok", text: "Saved." } }));
      await reload();
    } catch (err) {
      setSavedMsg(m => ({ ...m, [key]: { type: "err", text: String(err) } }));
    }
  };

  const clearField = async (key) => {
    if (!confirm(`Clear ${key}?`)) return;
    await fetch(`/api/settings/${encodeURIComponent(key)}`, { method: "DELETE" });
    setDrafts(d => ({ ...d, [key]: "" }));
    setSavedMsg(m => ({ ...m, [key]: { type: "ok", text: "Cleared." } }));
    await reload();
  };

  const saveProfile = async () => {
    const name = (profileDraft.name || profile?.name || "").trim();
    if (!name) {
      setProfileMsg({ type: "err", text: "Name required." });
      return;
    }
    setProfileSaving(true);
    setProfileMsg({ type: "saving" });
    try {
      const r = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: profileDraft.email !== "" ? profileDraft.email : (profile?.email ?? ""),
          initials: profileDraft.initials || undefined,
          context: profileDraft.context !== "" ? profileDraft.context : (profile?.context ?? ""),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const updated = await r.json();
      window.PROFILE = updated;
      onProfileChange?.(updated);
      setProfileDraft({ name: "", email: "", initials: "", context: "" });
      setProfileMsg({ type: "ok", text: "Saved." });
    } catch (err) {
      setProfileMsg({ type: "err", text: String(err.message || err) });
    } finally {
      setProfileSaving(false);
    }
  };

  const generateApiToken = async () => {
    // Confirm only when rotating — first-time generation needs no prompt.
    if (apiToken && !confirm("Rotate the token? Anything currently using it will start getting 401s.")) return;
    setApiTokenMsg({ type: "saving" });
    try {
      const r = await fetch("/api/auth/token", { method: "POST" });
      const body = await r.json();
      setApiToken(body.token);
      setApiTokenMsg({ type: "ok", text: apiToken ? "Token rotated. Update your agents with the new value." : "Token generated. Copy it now." });
    } catch (err) {
      setApiTokenMsg({ type: "err", text: String(err.message || err) });
    }
  };

  const revokeApiToken = async () => {
    if (!confirm("Revoke this token? Any agent using it will start getting 401s.")) return;
    setApiTokenMsg({ type: "saving" });
    try {
      await fetch("/api/auth/token", { method: "DELETE" });
      setApiToken(null);
      setApiTokenMsg({ type: "ok", text: "Token revoked." });
    } catch (err) {
      setApiTokenMsg({ type: "err", text: String(err.message || err) });
    }
  };

  const copyApiToken = async () => {
    if (!apiToken) return;
    try {
      await navigator.clipboard.writeText(apiToken);
      setApiTokenMsg({ type: "ok", text: "Copied to clipboard." });
    } catch (err) {
      setApiTokenMsg({ type: "err", text: "Couldn't copy — select and copy by hand." });
    }
  };

  const disconnectGoogle = async () => {
    if (!confirm("Disconnect Google? Calendar / Gmail / Tasks sync will stop until you reconnect.")) return;
    setSavedMsg(m => ({ ...m, "google-disconnect": { type: "saving" } }));
    try {
      const r = await fetch("/auth/google", { method: "DELETE" });
      if (!r.ok) throw new Error(`status ${r.status}`);
      setSavedMsg(m => ({ ...m, "google-disconnect": { type: "ok", text: "Disconnected. Tokens cleared." } }));
      await reload();
    } catch (err) {
      setSavedMsg(m => ({ ...m, "google-disconnect": { type: "err", text: String(err.message || err) } }));
    }
  };

  const syncNow = async (source) => {
    setSavedMsg(m => ({ ...m, [`sync-${source}`]: { type: "saving" } }));
    try {
      const r = await fetch(`/api/sync/${source}`, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.detail || body.error || `status ${r.status}`);
      setSavedMsg(m => ({ ...m, [`sync-${source}`]: { type: "ok", text: "Synced." } }));
      await reload();
      onTasksMutated?.();
    } catch (err) {
      setSavedMsg(m => ({ ...m, [`sync-${source}`]: { type: "err", text: String(err.message || err) } }));
    }
  };

  if (!fields) {
    return <main className="main" data-screen-label="Settings"><div style={{ padding: 40, color: "var(--muted)" }}>Loading…</div></main>;
  }

  const byGroup = (group) => fields.filter(f => f.group === group);

  return (
    <main className="main" data-screen-label="Settings">
      <div className="topbar">
        <div>
          <div className="greeting-eyebrow">CONFIGURE · KEYS &amp; INTEGRATIONS</div>
          <h1 className="greeting">
            Settings.<br/>
            <em>Wire up your sources.</em>
          </h1>
        </div>
      </div>

      <SettingsSection
        eyebrow="YOU"
        title="Profile"
        sub="Drives the greeting, sidebar avatar, and email row. Initials auto-derive from your name if left blank."
        status={profile?.name ? `Hi, ${profile.name.split(/\s+/)[0]}` : "Set your name"}
        statusOn={!!profile?.name}>
        <div className="settings-field-row">
          <label htmlFor="profile-name">Display name</label>
          <div className="settings-field-input">
            <input
              id="profile-name"
              type="text"
              value={profileDraft.name !== "" ? profileDraft.name : (profile?.name ?? "")}
              placeholder="e.g. Roger Yin"
              autoComplete="name"
              onChange={(e) => setProfileDraft(d => ({ ...d, name: e.target.value }))}
            />
          </div>
        </div>
        <div className="settings-field-row">
          <label htmlFor="profile-email">Email</label>
          <div className="settings-field-input">
            <input
              id="profile-email"
              type="email"
              value={profileDraft.email !== "" ? profileDraft.email : (profile?.email ?? "")}
              placeholder="you@example.com"
              autoComplete="email"
              onChange={(e) => setProfileDraft(d => ({ ...d, email: e.target.value }))}
            />
          </div>
        </div>
        <div className="settings-field-row">
          <label htmlFor="profile-initials">Initials</label>
          <div className="settings-field-input">
            <input
              id="profile-initials"
              type="text"
              maxLength={3}
              value={profileDraft.initials !== "" ? profileDraft.initials : (profile?.initials ?? "")}
              placeholder="auto"
              onChange={(e) => setProfileDraft(d => ({ ...d, initials: e.target.value.toUpperCase() }))}
              style={{ flex: "0 0 90px", textAlign: "center", letterSpacing: "0.1em" }}
            />
          </div>
        </div>
        <div className="settings-field-row" style={{ alignItems: "flex-start" }}>
          <label htmlFor="profile-context" style={{ paddingTop: 8 }}>About me</label>
          <div className="settings-field-input">
            <textarea
              id="profile-context"
              rows={6}
              value={profileDraft.context !== "" ? profileDraft.context : (profile?.context ?? "")}
              placeholder="Standing context all LLM agents read on every run — your role, work rhythms, constraints, relationships. Example:

I run Eon Growth Consulting, ~30 retainer clients. Mornings are deep work, afternoons are client comms. Targeting 4-day workweek. Partner runs ops. Asia time zone."
              onChange={(e) => setProfileDraft(d => ({ ...d, context: e.target.value }))}
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.5,
                padding: "8px 10px",
                border: "1px solid var(--rule)",
                borderRadius: 6,
                background: "var(--paper)",
                color: "var(--ink)",
                resize: "vertical",
              }}
            />
          </div>
        </div>
        <div className="settings-actions">
          <button className="settings-btn" onClick={saveProfile} disabled={profileSaving}>
            {profileSaving ? "Saving…" : "Save profile"}
          </button>
          {profileMsg && (
            <span className={`settings-msg ${profileMsg.type}`} style={{ gridColumn: "auto", marginLeft: 8 }}>
              {profileMsg.text || (profileMsg.type === "saving" ? "Saving…" : "")}
            </span>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow="LOOK"
        title="Appearance"
        sub="The dashboard's visual style. Saved on this device — won't affect anyone else."
        status={(window.THEMES?.[theme]?.name) || "Paper"}
        statusOn={true}>
        <div className="theme-grid">
          {Object.entries(window.THEMES || {}).map(([id, t]) => (
            <button
              key={id}
              className={`theme-card ${theme === id ? "active" : ""}`}
              onClick={() => onThemeChange?.(id)}>
              <div className="theme-preview" style={{ background: t.swatches[0], borderColor: t.swatches[1] === t.swatches[0] ? "rgba(0,0,0,0.08)" : t.swatches[1] }}>
                <div className="theme-preview-paper" style={{ background: t.swatches[1] }} />
                <div className="theme-preview-accent" style={{ background: t.swatches[2] }} />
              </div>
              <div className="theme-card-meta">
                <div className="theme-card-name" style={{ fontFamily: t.vars["--font-display"] }}>{t.name}</div>
                <div className="theme-card-desc">{t.description}</div>
              </div>
              {theme === id && <span className="theme-card-badge">CURRENT</span>}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow="CLAUDE AGENT"
        title="Anthropic"
        sub='Powers "Suggest from goals". Without a key the modal falls back to a deterministic local picker.'
        status={fields.find(f => f.key === "ANTHROPIC_API_KEY")?.isSet ? "Configured" : "Not configured"}
        statusOn={!!fields.find(f => f.key === "ANTHROPIC_API_KEY")?.isSet}>
        {byGroup("anthropic").map(f =>
          <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                    onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
        )}
      </SettingsSection>

      <SettingsSection
        eyebrow="GOOGLE WORKSPACE"
        title="Google"
        sub="One OAuth grant covers Calendar, Gmail, and Tasks. Sign in with your Google account to give Lighthouse read access."
        status={authStatus?.google?.connected ? "Connected" : authStatus?.google?.configured ? "Ready to sign in" : "Setup required"}
        statusOn={authStatus?.google?.connected}>

        {/* Primary surface — the "Sign in with Google" button (or the connected state). */}
        <div className="google-primary">
          {!authStatus?.google?.configured ? (
            <div className="google-no-keys">
              <div className="google-no-keys-title">An OAuth client needs to be set up first.</div>
              <div className="google-no-keys-sub">
                Lighthouse runs locally — Google requires you to register a small OAuth client in your own Cloud Console so your data never touches anyone else's project.
                It's a one-time, ~3-minute setup; see <code>SETUP.md</code>. Once the keys are in, the rest is a single button.
              </div>
            </div>
          ) : !authStatus?.google?.connected ? (
            <a href="/auth/google" className="signin-google-btn" aria-label="Sign in with Google">
              <GoogleGMark />
              <span>Sign in with Google</span>
            </a>
          ) : (
            <div className="google-connected">
              <div className="google-connected-headline">
                <span className="google-connected-dot" />
                <span><b>Connected to Google.</b> Calendar, Gmail, and Tasks are syncing.</span>
              </div>
              <div className="settings-actions">
                <a href="/auth/google" className="settings-btn secondary">Reconnect (re-grant scopes)</a>
                <button className="settings-btn secondary" onClick={disconnectGoogle} style={{ color: "var(--accent)" }}>Disconnect</button>
              </div>
              {savedMsg["google-disconnect"] && (
                <div className={`settings-msg ${savedMsg["google-disconnect"].type}`} style={{ marginTop: 8 }}>
                  {savedMsg["google-disconnect"].text}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Per-API status — only meaningful when connected. */}
        {authStatus?.google?.connected && (
          <div className="google-apis">
            <GoogleApiRow label="Calendar"     sync={syncs.gcal}   msg={savedMsg["sync-gcal"]}   onSync={() => syncNow("gcal")} />
            <GoogleApiRow label="Gmail"        sync={syncs.gmail}  msg={savedMsg["sync-gmail"]}  onSync={() => syncNow("gmail")} />
            <GoogleApiRow label="Google Tasks" sync={syncs.gtasks} msg={savedMsg["sync-gtasks"]} onSync={() => syncNow("gtasks")} />
          </div>
        )}

        {/* Credentials live behind a disclosure so the primary surface is the button. */}
        <details
          className="google-advanced"
          open={showGoogleAdvanced || !authStatus?.google?.configured}
          onToggle={(e) => setShowGoogleAdvanced(e.currentTarget.open)}>
          <summary>
            <span className="google-advanced-caret">▸</span>
            <span>Advanced — OAuth client credentials</span>
            <span className="google-advanced-hint">
              {authStatus?.google?.configured ? "configured" : "needs setup"}
            </span>
          </summary>
          <div className="google-advanced-body">
            {byGroup("google").map(f =>
              <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                        onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
            )}
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        eyebrow="TASKS"
        title="ClickUp"
        sub="Personal API token + team and user IDs. Pulls tasks assigned to you."
        status={syncs.clickup?.enabled ? "Connected" : "Not configured"}
        statusOn={!!syncs.clickup?.enabled}>
        {byGroup("clickup").map(f =>
          <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                    onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
        )}
        <div className="settings-actions">
          <button className="settings-btn secondary" onClick={() => syncNow("clickup")} disabled={!syncs.clickup?.enabled}>
            Sync now
          </button>
        </div>
        <SyncStatusLine sync={syncs.clickup} msg={savedMsg["sync-clickup"]} label="ClickUp"/>
      </SettingsSection>

      <SettingsSection
        eyebrow="OUTLINER"
        title="Workflowy"
        sub="API key from Workflowy → Settings → API. The parent node is what gets scanned for children — use 'inbox' (default), 'today' for the date-node, or a specific node id from a Workflowy URL."
        status={syncs.workflowy?.enabled ? "Connected" : "Not configured"}
        statusOn={!!syncs.workflowy?.enabled}>
        {byGroup("workflowy").map(f =>
          <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                    onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
        )}
        <div className="settings-actions">
          <button className="settings-btn secondary" onClick={() => syncNow("workflowy")} disabled={!syncs.workflowy?.enabled}>
            Sync now
          </button>
        </div>
        <SyncStatusLine sync={syncs.workflowy} msg={savedMsg["sync-workflowy"]} label="Workflowy"/>
      </SettingsSection>

      <SettingsSection
        eyebrow="NOTES · JOURNAL"
        title="Flomo"
        sub="Two-way journal sync. Private RSS URL (PRO only — flomo → Settings → 私密 RSS) pulls memos into the journal every 5 min. Incoming webhook URL pushes every journal entry you log here to flomo as a memo tagged #lighthouse. Either side can be left blank."
        status={syncs.flomo?.enabled ? "Connected" : "Not configured"}
        statusOn={!!syncs.flomo?.enabled}>
        {byGroup("flomo").map(f =>
          <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                    onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
        )}
        <div className="settings-actions">
          <button className="settings-btn secondary" onClick={() => syncNow("flomo")} disabled={!syncs.flomo?.enabled}>
            Sync now
          </button>
        </div>
        <SyncStatusLine sync={syncs.flomo} msg={savedMsg["sync-flomo"]} label="Flomo"/>
      </SettingsSection>

      <SettingsSection
        eyebrow="DOCS"
        title="Notion"
        sub="Internal integration token + the tasks database ID. Don't forget to share the database with the integration in Notion."
        status={syncs.notion?.enabled ? "Connected" : "Not configured"}
        statusOn={!!syncs.notion?.enabled}>
        {byGroup("notion").map(f =>
          <FieldRow key={f.key} field={f} drafts={drafts} setDrafts={setDrafts}
                    onSave={saveField} onClear={clearField} savedMsg={savedMsg} />
        )}
        <div className="settings-actions">
          <button className="settings-btn secondary" onClick={() => syncNow("notion")} disabled={!syncs.notion?.enabled}>
            Sync now
          </button>
        </div>
        <SyncStatusLine sync={syncs.notion} msg={savedMsg["sync-notion"]} label="Notion"/>
      </SettingsSection>

      <SettingsSection
        eyebrow="LOCAL"
        title="Things 3"
        sub="Mac-only. No config — if Things 3 is installed and accessible via AppleScript, it's auto-enabled. First sync may prompt for Automation permission."
        status={syncs.things?.enabled ? "Detected" : "Not detected"}
        statusOn={!!syncs.things?.enabled}>
        <div className="settings-actions">
          <button className="settings-btn secondary" onClick={() => syncNow("things")} disabled={!syncs.things?.enabled}>
            Sync now
          </button>
        </div>
        <SyncStatusLine sync={syncs.things} msg={savedMsg["sync-things"]} label="Things"/>
      </SettingsSection>

      <SettingsSection
        eyebrow="PUSH · AGENTS"
        title="API integration"
        sub="Generate a Bearer token so external agents (Claude Code, scripts, automations) can push tasks, captures, and journal moments straight into Lighthouse."
        status={apiToken ? "Active" : "Not generated"}
        statusOn={!!apiToken}>

        {apiToken ? (
          <>
            <div className="api-token-row">
              <code className="api-token-value">{apiToken}</code>
              <button className="settings-btn secondary" onClick={copyApiToken}>Copy</button>
            </div>
            <div className="settings-actions">
              <button className="settings-btn secondary" onClick={generateApiToken}>Rotate</button>
              <button className="settings-btn secondary" onClick={revokeApiToken} style={{ color: "var(--accent)" }}>Revoke</button>
            </div>
          </>
        ) : (
          <div className="settings-actions">
            <button className="settings-btn" onClick={generateApiToken}>Generate token</button>
          </div>
        )}

        {apiTokenMsg && (
          <div className={`settings-msg ${apiTokenMsg.type}`} style={{ gridColumn: "auto", marginTop: 8 }}>
            {apiTokenMsg.text || (apiTokenMsg.type === "saving" ? "Working…" : "")}
          </div>
        )}

        <ApiDocs apiToken={apiToken} />
      </SettingsSection>
    </main>
  );
}

function SettingsSection({ eyebrow, title, sub, status, statusOn, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="settings-eyebrow">{eyebrow}</div>
          <div className="settings-title">{title}</div>
          <div className="settings-sub">{sub}</div>
        </div>
        <span className={`settings-pill ${statusOn ? "on" : "off"}`}>
          {statusOn ? "● " : "○ "}{status}
        </span>
      </div>
      {children}
    </section>
  );
}

function FieldRow({ field, drafts, setDrafts, onSave, onClear, savedMsg }) {
  const draft = drafts[field.key];
  const displayValue = draft !== undefined ? draft : (field.value ?? "");
  const placeholder = field.isSet && field.secret
    ? field.hint
    : field.placeholder || (field.secret ? "(hidden)" : "");
  const msg = savedMsg[field.key];
  const dirty = draft !== undefined && draft.trim() !== "" && draft !== (field.value ?? "");

  return (
    <div className="settings-field-row">
      <label htmlFor={`f-${field.key}`}>{field.label}</label>
      <div className="settings-field-input">
        <input
          id={`f-${field.key}`}
          type={field.secret ? "password" : "text"}
          value={displayValue}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDrafts(d => ({ ...d, [field.key]: e.target.value }))}
        />
        <button className="settings-btn" onClick={() => onSave(field.key)} disabled={!dirty}>
          Save
        </button>
        {field.isSet && (
          <button className="settings-clear-btn" onClick={() => onClear(field.key)}>Clear</button>
        )}
      </div>
      {msg && <div className={`settings-msg ${msg.type}`}>{msg.text || (msg.type === "saving" ? "Saving…" : "")}</div>}
    </div>
  );
}

/** Google's four-color "G" used on the Sign-in button. SVG keeps it crisp at
 *  any DPI and theme — colors are baked in, intentionally not theme-driven. */
function GoogleGMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}

/** Per-Google-API row inside the Google section. Distinguishes "never synced",
 *  "synced recently", "sync error", and the specific scope/403 case. */
function GoogleApiRow({ label, sync, msg, onSync }) {
  const lastErr = sync?.lastError;
  const scopeIssue = lastErr && /insufficient|permission|scope|403/i.test(lastErr);
  const when = sync?.lastPulledAt
    ? new Date(sync.lastPulledAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;

  let stateClass = "idle";
  let stateText = "Not synced yet";
  if (scopeIssue) {
    stateClass = "err";
    stateText = "Re-consent needed — click Reconnect above";
  } else if (lastErr) {
    stateClass = "err";
    stateText = `Error: ${lastErr.slice(0, 80)}`;
  } else if (when) {
    stateClass = "ok";
    stateText = `Synced ${when}`;
  }

  return (
    <div className="google-api-row">
      <span className="google-api-name">{label}</span>
      <span className={`google-api-state ${stateClass}`}>{stateText}</span>
      <button className="settings-btn secondary" onClick={onSync}>
        {msg?.type === "saving" ? "Syncing…" : "Sync now"}
      </button>
      {msg && msg.type !== "saving" && (
        <span className={`settings-msg ${msg.type}`} style={{ gridColumn: "1 / -1", marginTop: 4 }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

function SyncStatusLine({ sync, msg, label }) {
  if (!sync) return null;
  const when = sync.lastPulledAt
    ? new Date(sync.lastPulledAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : null;
  return (
    <div className="settings-sync-line">
      {sync.lastError
        ? <span style={{ color: "var(--accent)" }}>{label} last error: {sync.lastError}</span>
        : when
          ? <span style={{ color: "var(--muted)" }}>{label} last synced {when}</span>
          : null}
      {msg && <span className={`settings-msg ${msg.type}`} style={{ marginLeft: 8 }}>
        {msg.text || (msg.type === "saving" ? "Syncing…" : "")}
      </span>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Demote modal — fired when the user tries to add a 4th task to
   the today lane. Shows the current three; picking one demotes it
   to This week and the original action retries automatically.
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   Task detail modal — opens when a row is clicked. Shows the
   full description, source meta, agent reasoning, and gives
   one-click access to common state changes.
   ───────────────────────────────────────────────────────────── */
function TaskDetailModal({ open, task, goals, onClose, onToggleDone, onChangeLane, onTogglePin, onTriageInbox, onCompleteInbox, onPinInbox }) {
  if (!open || !task) return null;
  const source = SOURCES[task.source];
  const tag = TAGS[task.tag];
  const w = typeof task.weight === "number" ? task.weight : null;
  const weightCls = w === null ? "none" : w >= 0.7 ? "high" : w >= 0.3 ? "mid" : "low";
  const isDone = Boolean(task.doneAt);
  // Brain-dump items live in inbox_items, not the tasks table — the generic
  // lane picker / pin / mark-done all PATCH /api/tasks/:id and would 404 on
  // them. So their controls route through the inbox endpoints instead: the
  // lane buttons *triage* (create the task in that lane), Pin triages to Week
  // then pins, Done promotes-then-completes, and Drop discards. Same buttons
  // as a real task — just a different plumbing underneath, plus a Drop.
  const isInbox = task.lane === "inbox";

  const goal = React.useMemo(() => {
    if (!task.primaryGoalId || !goals) return null;
    const all = [
      ...(goals.annual    || []).map(g => ({ ...g, horizon: "Annual"    })),
      ...(goals.quarterly || []).map(g => ({ ...g, horizon: "Quarterly" })),
      ...(goals.monthly   || []).map(g => ({ ...g, horizon: "Monthly"   })),
    ];
    return all.find(g => g.id === task.primaryGoalId) || null;
  }, [task.primaryGoalId, goals]);

  // Now⊂Today: show the "Now" button only when the task is currently in Now
  // (so we have an active-state indicator) or in Today (where it's a valid
  // promotion target). Hide for further-out lanes — the server would reject.
  const LANES = [
    ...(task.lane === "now" || task.lane === "today" ? [{ id: "now", label: "Now" }] : []),
    { id: "today",      label: "Today" },
    { id: "this_week",  label: "Week" },
    { id: "this_month", label: "Month" },
    { id: "backlog",    label: "Later" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-task-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="task-detail-meta">
          {source && (
            <span className="chip source-chip">
              <span className="chip-dot" style={{ background: source.color }} />
              {source.label}
            </span>
          )}
          {tag && <span className={`chip tag-chip tag-${task.tag}`}>{tag.label}</span>}
          {task.project && <span className="task-detail-project">{task.project}</span>}
          {task.bigRock && (
            <span className="chip" style={{ background: "var(--accent)", color: "#fbf8f1", borderColor: "transparent", fontSize: 10 }}>
              big rock
            </span>
          )}
          {task.url && (
            <a
              className="task-detail-source-link"
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open in ${source?.label || task.source}`}>
              Open in {source?.label || task.source} ↗
            </a>
          )}
        </div>

        <h2 className="task-detail-title">{task.title}</h2>

        {(task.theme || w !== null) && (
          <div className="task-detail-enrichment">
            {task.theme && (
              <div className="task-detail-theme">
                <span className="task-detail-theme-label">Theme</span>
                <span className="task-detail-theme-name">{task.theme}</span>
              </div>
            )}
            {w !== null && (
              <div className="task-detail-weight">
                <span className="task-detail-theme-label">Weight</span>
                <span className={`ondeck-weight ${weightCls}`}>{Math.round(w * 100)}</span>
              </div>
            )}
            {goal && (
              <div className="task-detail-goal">
                <span className="task-detail-theme-label">Ladders to</span>
                <span className="task-detail-goal-name">
                  <span className="task-detail-goal-horizon">{goal.horizon}</span>
                  {goal.title}
                </span>
              </div>
            )}
            {task.reasoning && (
              <div className="task-detail-reasoning">
                <span className="task-detail-theme-label">Why this weight</span>
                <span>{task.reasoning}</span>
              </div>
            )}
          </div>
        )}

        <div className="task-detail-section-label">Description</div>
        {task.note ? (
          <pre className="task-detail-note">{task.note}</pre>
        ) : (
          <div className="task-detail-note-empty">
            {isInbox
              ? "A captured thought. Triage it into a lane, mark it done if it's already handled, or drop it."
              : `No description on the source row. ${source ? `Add one in ${source.label} and it'll sync over.` : ""}`}
          </div>
        )}

        <div className="task-detail-stats">
          {task.due      && <span><b>Due</b> · {task.due}</span>}
          {task.estimate && <span><b>Est</b> · {task.estimate}m</span>}
          {task.doneAt   && <span><b>Done</b> · {new Date(task.doneAt).toLocaleString()}</span>}
        </div>

        {isInbox ? (
          <div className="task-detail-actions">
            <div className="task-detail-lane-picker">
              <span className="task-detail-lane-label">Send to</span>
              <button className="task-detail-lane-btn" onClick={() => onTriageInbox?.(task.id, "today")}>Today</button>
              <button className="task-detail-lane-btn" onClick={() => onTriageInbox?.(task.id, "this_week")}>Week</button>
              <button className="task-detail-lane-btn" onClick={() => onTriageInbox?.(task.id, "this_month")}>Month</button>
              <button className="task-detail-lane-btn" onClick={() => onTriageInbox?.(task.id, "backlog")}>Later</button>
            </div>
            {onPinInbox && (
              <button
                className="rec-defer"
                title="Pin — send to This week and queue it up next"
                onClick={() => onPinInbox(task.id)}>
                📌 Pin for next
              </button>
            )}
            <button
              className="task-detail-lane-btn task-detail-drop"
              title="Discard this thought"
              onClick={() => onTriageInbox?.(task.id, "drop")}>
              Drop
            </button>
            <button className="modal-primary" onClick={() => onCompleteInbox?.(task.id)}>
              Done
            </button>
          </div>
        ) : (
          <div className="task-detail-actions">
            <div className="task-detail-lane-picker">
              <span className="task-detail-lane-label">Lane</span>
              {LANES.map(l => (
                <button
                  key={l.id}
                  className={`task-detail-lane-btn ${task.lane === l.id ? "active" : ""}`}
                  onClick={() => onChangeLane?.(task.id, l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            {/* Pin toggle — only meaningful for the planning lanes (this_week,
                this_month, backlog). Hidden on now/today because those are
                already committed; pin is for "queue this up next". */}
            {onTogglePin && task.lane !== "now" && task.lane !== "today" && (
              <button
                className={`rec-defer ${task.pinned ? "active" : ""}`}
                title={task.pinned ? "Unpin" : "Pin — promote next when Today opens up"}
                onClick={() => onTogglePin(task.id, !task.pinned)}>
                {task.pinned ? "📌 Pinned" : "📌 Pin for next"}
              </button>
            )}
            <button
              className={`modal-primary ${isDone ? "secondary" : ""}`}
              onClick={() => onToggleDone?.(task.id)}>
              {isDone ? "✓ Mark undone" : "Done"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DemoteModal({ open, newItemTitle, todayTasks, onPick, onCancel, busy }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-demote" onClick={e => e.stopPropagation()}>
        <div className="modal-halftone" style={{ backgroundImage: "radial-gradient(circle at center, var(--accent) 1px, transparent 1.3px)" }} />
        <button className="modal-close" onClick={onCancel} aria-label="Close" disabled={busy}>×</button>

        <div className="modal-eyebrow">
          <span style={{ color: "var(--accent)" }}>●</span> HARD CAP · 3 TODAY
        </div>
        <h2 className="modal-title">Today's three is full.<br/><em>Pick one to move.</em></h2>
        <p className="modal-sub">
          So <b style={{ color: "var(--ink)" }}>{newItemTitle}</b> can take its place. Three is non-negotiable — that's the whole point.
        </p>

        <div className="demote-list">
          {todayTasks.map((t) => (
            <button
              key={t.id}
              className="demote-row"
              onClick={() => onPick(t.id)}
              disabled={busy}
            >
              <span className="demote-row-main">
                <span className="demote-row-title">{t.title}</span>
                {t.bigRock && <span className="chip" style={{ background: "var(--accent)", color: "#fbf8f1", borderColor: "transparent", fontSize: 10, marginLeft: 8 }}>big rock</span>}
              </span>
              <span className="demote-row-action">Move to This week →</span>
            </button>
          ))}
        </div>

        <div className="modal-foot">
          <button className="modal-secondary" onClick={onCancel} disabled={busy}>
            {busy ? "Working…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Journal page — interstitial journaling. Single-line composer
   with a guide above + a timestamped mood-coded timeline below.
   ───────────────────────────────────────────────────────────── */
function JournalPage({ entries, streak, startOfTodayMs, onAddEntry, onEditEntry, onDeleteEntry, selectedDate, onSelectDate }) {
  const [text, setText] = React.useState("");
  // Default to calm — softer landing than committing to a high-arousal
  // state at the start of a journal entry. User reclassifies before save.
  const [mood, setMood] = React.useState("calm");
  const [now, setNow]   = React.useState(new Date());

  // Local YYYY-MM-DD for "today" — used to detect when the rail-selected day
  // is actually today (in which case we still show the composer + buckets).
  const todayStr = React.useMemo(() => {
    const d = new Date(startOfTodayMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }, [startOfTodayMs]);
  const isPastDayView = selectedDate && selectedDate !== todayStr;

  // Live clock for the "right now" stamp on the composer.
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const stampNow = fmtTime(minutesNow);
  const canSave = text.trim().length > 0;

  const save = async () => {
    if (!canSave) return;
    // Only clear the input on confirmed success — otherwise a network blip
    // would silently destroy the user's text.
    const ok = await onAddEntry?.({ mood, note: text.trim() });
    if (ok) setText("");
  };

  // Bucket entries relative to "today" — server returns ISO timestamps in UTC,
  // we read them in local time and compare against local midnight. The boundary
  // is driven by App's startOfTodayMs (minute-tick) so a tab left open across
  // midnight re-buckets correctly without a manual refresh.
  const buckets = React.useMemo(() => {
    const today = [];
    const yesterday = [];
    const earlier = [];
    const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
    for (const e of (entries || [])) {
      const t = new Date(e.createdAt).getTime();
      if (t >= startOfTodayMs) today.push(e);
      else if (t >= startOfYesterdayMs) yesterday.push(e);
      else earlier.push(e);
    }
    const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    today.sort(byNewest); yesterday.sort(byNewest); earlier.sort(byNewest);
    return { today, yesterday, earlier };
  }, [entries, startOfTodayMs]);

  const moodCounts = buckets.today.reduce((acc, e) => {
    acc[e.mood] = (acc[e.mood] || 0) + 1;
    return acc;
  }, {});

  // Past-day view: collapse into a single chronological list (the server has
  // already filtered to that day). Drop the composer — you can't journal in
  // the past — and surface a "back to today" affordance.
  if (isPastDayView) {
    const sorted = [...(entries || [])].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const pretty = (() => {
      const d = new Date(`${selectedDate}T00:00:00`);
      const fmt = d.toLocaleDateString(undefined, {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
      return fmt;
    })();
    const moodCounts = sorted.reduce((acc, e) => {
      acc[e.mood] = (acc[e.mood] || 0) + 1; return acc;
    }, {});

    return (
      <main className="main" data-screen-label="Journal">
        <div className="topbar">
          <div>
            <div className="greeting-eyebrow">
              Looking back · interstitial journaling
              <span className="divider-dot" />
              <button className="link-button" onClick={() => onSelectDate?.(null)}>
                ← Back to today
              </button>
            </div>
            <h1 className="greeting">
              {pretty}.<br/>
              <em>{sorted.length} moment{sorted.length === 1 ? "" : "s"}</em> from this day.
            </h1>
          </div>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="section-head">
            <div className="section-title">Entries</div>
            <div className="section-meta">
              <div className="journal-mood-strip">
                {MOODS.map(m => moodCounts[m.id] && (
                  <span key={m.id} className="journal-mood-strip-pill"
                        style={{ background: m.color, color: "#fbf8f1" }}>
                    {m.label} · {moodCounts[m.id]}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="journal-timeline">
            {sorted.length === 0 ? (
              <div className="empty-state" style={{ padding: "40px 20px" }}>
                <div className="empty-state-icon" />
                <div className="empty-state-title">Nothing logged this day.</div>
                <div className="empty-state-sub">Pick a different day from the calendar.</div>
              </div>
            ) : (
              sorted.map((e, i) => <JournalEntry key={e.id} entry={e} isFirst={i === 0} onEdit={onEditEntry} onDelete={onDeleteEntry} />)
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="main" data-screen-label="Journal">
      <div className="topbar">
        <div>
          <div className="greeting-eyebrow">
            Interstitial journaling · between the things
            <span className="divider-dot" />
            <span style={{ color: "var(--accent-5)", fontWeight: 600, letterSpacing: "0.04em" }}>
              {streak}-DAY STREAK
            </span>
          </div>
          <h1 className="greeting">
            A pause, written down.<br/>
            <em>{buckets.today.length} moment{buckets.today.length === 1 ? "" : "s"}</em> logged today.
          </h1>
        </div>
      </div>

      <div className="journal-composer">
        <div className="journal-composer-halftone" />

        <div className="journal-composer-head">
          <div className="journal-stamp">
            <span className="journal-stamp-dot" />
            <span className="journal-stamp-time mono">{stampNow}</span>
            <span className="journal-stamp-label">right now</span>
          </div>
          <div className="journal-mood-row">
            <span className="journal-mood-label">feeling:</span>
            {MOODS.map(m => (
              <button
                key={m.id}
                className={`journal-mood-chip ${mood === m.id ? "active" : ""}`}
                onClick={() => setMood(m.id)}
                style={{ "--mood-color": m.color }}>
                <span className="journal-mood-dot" style={{ background: m.color }} />
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Three prompts as a visual guide — what to think about, not separate inputs */}
        <div className="journal-guide">
          {JOURNAL_PROMPTS.map((p, i) => (
            <React.Fragment key={i}>
              <span>{p}</span>
              {i < JOURNAL_PROMPTS.length - 1 && <span className="journal-guide-sep">·</span>}
            </React.Fragment>
          ))}
        </div>

        <input
          className="journal-input"
          placeholder="One line. Capture the moment."
          value={text}
          maxLength={2000}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
              e.preventDefault();
              save();
            }
          }}
        />

        <div className="journal-composer-foot">
          <button
            className={`journal-save ${canSave ? "" : "disabled"}`}
            onClick={save}
            disabled={!canSave}>
            Log this moment <span className="kbd">⏎</span>
          </button>
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="section-head">
          <div className="section-title">Today</div>
          <div className="section-meta">
            <div className="journal-mood-strip">
              {MOODS.map(m => moodCounts[m.id] && (
                <span key={m.id} className="journal-mood-strip-pill"
                      style={{ background: m.color, color: "#fbf8f1" }}>
                  {m.label} · {moodCounts[m.id]}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="journal-timeline">
          {buckets.today.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px 20px" }}>
              <div className="empty-state-icon" />
              <div className="empty-state-title">Nothing logged yet.</div>
              <div className="empty-state-sub">Drop one line above to start the rhythm.</div>
            </div>
          ) : (
            buckets.today.map((e, i) => <JournalEntry key={e.id} entry={e} isFirst={i === 0} onEdit={onEditEntry} onDelete={onDeleteEntry} />)
          )}
        </div>
      </section>

      {buckets.yesterday.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="section-head">
            <div className="section-title">Yesterday</div>
            <div className="section-meta">{buckets.yesterday.length} entries</div>
          </div>
          <div className="journal-timeline">
            {buckets.yesterday.map(e => <JournalEntry key={e.id} entry={e} muted onEdit={onEditEntry} onDelete={onDeleteEntry} />)}
          </div>
        </section>
      )}

      {buckets.earlier.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="section-head">
            <div className="section-title">Earlier this week</div>
            <div className="section-meta">{buckets.earlier.length} entries</div>
          </div>
          <div className="journal-timeline">
            {buckets.earlier.map(e => <JournalEntry key={e.id} entry={e} muted onEdit={onEditEntry} onDelete={onDeleteEntry} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function JournalEntry({ entry, isFirst, muted, onEdit, onDelete }) {
  const [editing, setEditing] = React.useState(false);
  const [draftNote, setDraftNote] = React.useState(entry.note);
  const [draftMood, setDraftMood] = React.useState(entry.mood);
  const [saving, setSaving] = React.useState(false);

  const mood = MOODS.find(m => m.id === (editing ? draftMood : entry.mood)) || MOODS[0];
  const d = new Date(entry.createdAt);
  const t = d.getHours() * 60 + d.getMinutes();

  const startEdit = () => {
    setDraftNote(entry.note);
    setDraftMood(entry.mood);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = async () => {
    const note = draftNote.trim();
    if (!note) return;
    if (note === entry.note && draftMood === entry.mood) { setEditing(false); return; }
    setSaving(true);
    try {
      const ok = await onEdit?.(entry.id, { mood: draftMood, note });
      if (ok) setEditing(false);
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!confirm("Delete this journal entry? This can't be undone.")) return;
    await onDelete?.(entry.id);
  };

  return (
    <div className={`journal-entry ${muted ? "muted" : ""} ${isFirst ? "first" : ""} ${editing ? "editing" : ""}`}>
      <div className="journal-entry-rail">
        <div className="journal-entry-stamp mono">{fmtTime(t)}</div>
        <div className="journal-entry-dot" style={{ background: mood.color }} />
        <div className="journal-entry-line" />
      </div>
      <div className="journal-entry-body">
        {entry.source && entry.source !== "self" && (
          <span className="journal-entry-source" title={`Synced from ${entry.source}`}>
            {entry.source}
          </span>
        )}
        {editing ? (
          <>
            <div className="journal-mood-row" style={{ marginBottom: 8 }}>
              {MOODS.map(m => (
                <button
                  key={m.id}
                  className={`journal-mood-chip ${draftMood === m.id ? "active" : ""}`}
                  onClick={() => setDraftMood(m.id)}
                  style={{ "--mood-color": m.color }}>
                  <span className="journal-mood-dot" style={{ background: m.color }} />
                  {m.label}
                </button>
              ))}
            </div>
            <textarea
              className="journal-edit-input"
              value={draftNote}
              maxLength={2000}
              rows={3}
              autoFocus
              onChange={(e) => setDraftNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
              }}
            />
            <div className="journal-edit-actions">
              <button className="journal-edit-cancel" onClick={cancel} disabled={saving}>Cancel</button>
              <button className="journal-edit-save" onClick={save} disabled={saving || !draftNote.trim()}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="journal-entry-mood">
              <span className="journal-entry-mood-dot" style={{ background: mood.color }} />
              {mood.label}
              <div className="journal-entry-tools">
                <button className="journal-entry-tool" title="Edit" onClick={startEdit}>edit</button>
                <button className="journal-entry-tool danger" title="Delete" onClick={remove}>×</button>
              </div>
            </div>
            <div className="journal-entry-note">{entry.note}</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── API docs subsection — rendered inside the Settings · API card ─── */
const API_ENDPOINTS = [
  {
    method: "POST",
    path: "/api/v1/capture",
    description: "Drop a one-liner in the brain dump inbox for triage.",
    params: [
      { name: "title",  type: "string",  required: true,  notes: "One-line capture text. Trimmed." },
      { name: "source", type: "string",  required: false, notes: 'Defaults to "agent". Must be in the source enum.' },
    ],
    response: '{ "id": "i-…", "source": "agent", "title": "...", "lane": "inbox" }',
    body: '{"title":"Follow up with Maya about the contractor"}',
  },
  {
    method: "POST",
    path: "/api/v1/tasks",
    description: "Create a task directly. Honors the 3-cap when lane is \"today\".",
    params: [
      { name: "title",    type: "string",  required: true,  notes: "Task title. Trimmed." },
      { name: "lane",     type: "string",  required: false, notes: 'Defaults to "this_month". One of the lane enum.' },
      { name: "tag",      type: "string",  required: false, notes: "One of the tag enum, or omit for none." },
      { name: "project",  type: "string",  required: false, notes: "Free-form project label, shown as a chip." },
      { name: "note",     type: "string",  required: false, notes: "Optional secondary line shown beneath the title." },
      { name: "estimate", type: "number",  required: false, notes: "Minutes. Shown as a pill on the task row." },
      { name: "due",      type: "string",  required: false, notes: 'Relative ("today"/"tomorrow"/"fri"/"this week") or ISO date.' },
      { name: "source",   type: "string",  required: false, notes: 'Defaults to "agent".' },
    ],
    response: '{ "id": "t-…", "source": "agent", "title": "...", "lane": "this_month" }',
    body: '{"title":"Draft the retention narrative","lane":"today","tag":"deep","estimate":25}',
  },
  {
    method: "POST",
    path: "/api/v1/journal",
    description: "Log an interstitial moment — a one-liner between tasks/meetings.",
    params: [
      { name: "mood", type: "string", required: true, notes: "One of the mood enum." },
      { name: "note", type: "string", required: true, notes: "≤ 2000 chars. Trimmed." },
    ],
    response: '{ "id": "j-…", "mood": "focused", "note": "...", "createdAt": "2026-05-15T17:00:00Z" }',
    body: '{"mood":"focused","note":"Build done, tests green. 25 min for review."}',
  },
];

const API_ENUMS = [
  { label: "lane",   values: ["now", "today", "this_week", "this_month", "backlog"] },
  { label: "source", values: ["clickup", "workflowy", "linear", "things", "notion", "email", "gcal", "self", "agent"] },
  { label: "tag",    values: ["deep", "shallow", "admin", "comms", "personal", "errand"] },
  { label: "mood",   values: ["calm", "focused", "content", "curious", "inspired", "proud", "buzzy", "scattered", "frustrated", "anxious", "overwhelmed", "drained", "low"] },
];

const API_ERRORS = [
  { code: "401", name: "unauthorized",  notes: "Missing or invalid Bearer token. Generate or rotate above." },
  { code: "400", name: "title required",  notes: "Body has no title (or it's whitespace-only)." },
  { code: "400", name: "invalid lane / source / tag / mood", notes: "Value not in the relevant enum below." },
  { code: "400", name: "note too long",  notes: "/journal note exceeded 2000 chars." },
  { code: "409", name: "today_full",    notes: "/tasks with lane=\"today\" while 3 today-undone tasks exist. Move one to ondeck first or switch lane to ondeck." },
];

function ApiDocs({ apiToken }) {
  const tokenForCurl = apiToken || "$LIGHTHOUSE_TOKEN";
  const [meta, setMeta] = React.useState(null);

  React.useEffect(() => {
    fetch("/api/meta").then(r => r.json()).then(setMeta).catch(() => setMeta(null));
  }, []);

  // Fall back to the hardcoded lists if /api/meta isn't reachable.
  const liveEnums = meta ? [
    { label: "lane",   values: meta.lanes   },
    { label: "source", values: meta.sources },
    { label: "tag",    values: meta.tags    },
    { label: "mood",   values: meta.moods   },
  ] : API_ENUMS;

  return (
    <div className="api-docs">
      {API_ENDPOINTS.map((ep) => (
        <div key={ep.path} className="api-endpoint">
          <div className="api-endpoint-head">
            <span className="api-method">{ep.method}</span>
            <span className="api-path">{ep.path}</span>
            <span className="api-desc">{ep.description}</span>
          </div>

          <div className="api-subhead">Request body</div>
          <table className="api-params">
            <tbody>
              {ep.params.map((p) => (
                <tr key={p.name}>
                  <td className="api-params-name"><code>{p.name}</code></td>
                  <td className="api-params-type">{p.type}</td>
                  <td className="api-params-required">
                    {p.required
                      ? <span className="api-params-required-yes">required</span>
                      : <span className="api-params-required-no">optional</span>}
                  </td>
                  <td className="api-params-notes">{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="api-subhead">Response · 201</div>
          <pre className="api-snippet">{ep.response}</pre>

          <div className="api-subhead">Example</div>
          <pre className="api-snippet">{`curl -X POST http://127.0.0.1:7373${ep.path} \\
  -H "Authorization: Bearer ${tokenForCurl}" \\
  -H "Content-Type: application/json" \\
  -d '${ep.body}'`}</pre>
        </div>
      ))}

      <div className="api-reference">
        <div className="api-subhead api-subhead-section">Valid enums {meta && <span style={{ color: "var(--muted-2)", fontWeight: 400, letterSpacing: 0, textTransform: "none", marginLeft: 6 }}>live from /api/meta</span>}</div>
        <div className="api-enums">
          {liveEnums.map((e) => (
            <div key={e.label} className="api-enum-row">
              <code className="api-enum-name">{e.label}</code>
              <span className="api-enum-values">
                {e.values.map((v, i) => (
                  <React.Fragment key={v}>
                    <code>{v}</code>
                    {i < e.values.length - 1 && <span className="api-enum-sep"> · </span>}
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>

        <div className="api-subhead api-subhead-section">Errors</div>
        <table className="api-errors">
          <tbody>
            {API_ERRORS.map((e, i) => (
              <tr key={i}>
                <td className="api-error-code">{e.code}</td>
                <td className="api-error-name"><code>{e.name}</code></td>
                <td className="api-error-notes">{e.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Plan-my-day modal — 3-5 picks (vs Suggest's fixed 3), with
   stuck-task surfacing. Accept-all cascades Today → Up next
   automatically (no DemoteModal interrupt).
   ───────────────────────────────────────────────────────────── */
function PlanDayModal({ open, onClose, onAcceptAll, onAccept }) {
  const [picks, setPicks] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  // Per-row state: idx → "idle" | "adding" | "added-today" | "added-upnext" | "error"
  const [rowState, setRowState] = React.useState({});
  const [acceptingAll, setAcceptingAll] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // AbortController so closing the modal mid-run cancels the fetch AND
    // signals the server to bail. Without this, an expensive multi-turn
    // agent run keeps spending Opus tokens after the user closes the modal
    // and discards the result on completion.
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true);
    setPicks(null);
    setError(null);
    setRowState({});
    setAcceptingAll(false);
    fetch("/api/agent/plan-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b.detail || b.error || `status ${r.status}`);
        }
        return r.json();
      })
      .then((data) => { if (!cancelled) setPicks(data.picks || []); })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (!cancelled) setError(String(err.message || err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [open]);

  if (!open) return null;

  const settle = (i, res) => {
    const s = res?.ok === false
      ? "error"
      : res?.lane === "this_week"
        ? "added-upnext"
        : "added-today";
    setRowState((r) => ({ ...r, [i]: s }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-halftone" />
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        <div className="modal-eyebrow">
          <span>◎</span> {loading ? "Reading the day…" : "Planned by Claude"}
        </div>
        <h2 className="modal-title">Today's focus.<br/><em>Goals, stuck items, what fits the calendar.</em></h2>
        <p className="modal-sub">
          {loading
            ? "Checking goals, stuck tasks, today's calendar, and recent completions…"
            : error
              ? "Couldn't reach the planner. Showing nothing rather than a guess — try again in a moment."
              : "Accept the ones that feel right. They land in Today; overflow queues in Up next."}
        </p>

        {error && !loading && (
          <div className="suggest-list">
            <div className="suggest-row" style={{ opacity: 0.7 }}>
              <div className="suggest-body">
                <div className="suggest-task" style={{ color: "var(--muted)" }}>{error}</div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="suggest-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="suggest-row" style={{ opacity: 0.5 }}>
                <div className="suggest-num" style={{ background: "var(--muted-2)" }}>{i + 1}</div>
                <div className="suggest-body">
                  <div className="suggest-task" style={{ color: "var(--muted)" }}>…</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && picks && picks.length > 0 && (
          <div className="suggest-list">
            {picks.map((p, i) => {
              const annual = p.annual;
              const state = rowState[i] || "idle";
              return (
                <div key={i} className="suggest-row">
                  <div className="suggest-num" style={{ background: annual.color }}>{i + 1}</div>
                  <div className="suggest-body">
                    <div className="suggest-task">{p.task?.title || p.goal.nextStep || p.goal.title}</div>
                    <div className="suggest-chain">
                      laddering to
                      <span className="suggest-chain-link">{p.goal.title}</span>
                      →
                      <span className="suggest-chain-link" style={{ color: annual.color }}>{annual.title}</span>
                    </div>
                    <div className="suggest-reason">{p.reason}</div>
                  </div>
                  <div className="suggest-actions">
                    <button
                      className="suggest-accept"
                      disabled={state === "adding" || state.startsWith("added") || acceptingAll}
                      onClick={async () => {
                        if (!onAccept) return;
                        setRowState((r) => ({ ...r, [i]: "adding" }));
                        try { settle(i, await onAccept(p)); }
                        catch { setRowState((r) => ({ ...r, [i]: "error" })); }
                      }}>
                      {state === "adding"        ? "…" :
                       state === "added-today"   ? "✓ Today" :
                       state === "added-upnext"  ? "✓ Up next" :
                       state === "error"         ? "Retry" :
                                                   "+ Add"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="modal-foot">
          <button className="modal-secondary" onClick={onClose}>Not now</button>
          <button
            className="modal-primary"
            disabled={loading || acceptingAll || !picks || picks.length === 0}
            onClick={async () => {
              if (!onAccept || !picks) return;
              setAcceptingAll(true);
              // Sequential so the Today cap-check stays honest — concurrent
              // PATCHes could each see room for one more and both squeeze in.
              for (let i = 0; i < picks.length; i++) {
                if (String(rowState[i] || "").startsWith("added")) continue;
                setRowState((r) => ({ ...r, [i]: "adding" }));
                try { settle(i, await onAccept(picks[i])); }
                catch { setRowState((r) => ({ ...r, [i]: "error" })); }
              }
              setAcceptingAll(false);
              onAcceptAll?.();
            }}>
            {acceptingAll ? "Adding…" : `Accept all ${picks?.length ?? ""} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CalendarPage, GoalsPage, SuggestionModal, PlanDayModal, SettingsPage, DemoteModal, JournalPage });
