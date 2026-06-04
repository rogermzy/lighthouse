/* global React, ReactDOM, SOURCES, TAGS, TASKS, WEEK,
          TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSlider, TweakToggle, TweakColor */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* ─────────────────────── small svg icons ─────────────────────── */
const Icon = {
  check: (p) => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}>
      <path d="M2.5 6.3L5 8.5L9.5 3.5" stroke="#fbf8f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  search: (p) => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}>
      <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M9.4 9.4L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  bell: (p) => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M3 10V6.5a4 4 0 018 0V10l1 1.5H2L3 10z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M5.5 12a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  plus: (p) => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  play: (p) => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" {...p}>
      <path d="M3 2.2v7.6L9.5 6 3 2.2z"/>
    </svg>
  ),
  pause: (p) => (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" {...p}>
      <rect x="3" y="2.5" width="2.2" height="7" rx="0.6"/>
      <rect x="6.8" y="2.5" width="2.2" height="7" rx="0.6"/>
    </svg>
  ),
  arrowDown: (p) => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" {...p}>
      <path d="M5 2v6M2.5 5.5L5 8l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  filter: (p) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}>
      <path d="M1.5 2.5h9L7 6.5v3.5L5 9V6.5L1.5 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  ),
  // Clipboard / briefing-notes icon — used for the "Context for the agent"
  // affordance on goal cards. Reads as "background info" / "notes."
  notes: (p) => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}>
      <rect x="2.5" y="2" width="9" height="11" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 1.5v1.5M9 1.5v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M4.5 6h5M4.5 8.5h5M4.5 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  ),
  // Hierarchical splitter — one parent node branching down to three children.
  // Used for the "Break it down" action on annual goals: the visual reads
  // immediately as decomposition (1 → 3) without leaning on an emoji.
  tree: (p) => (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}>
      <circle cx="7" cy="2.5" r="1.3" fill="currentColor"/>
      <path d="M7 4v2.5M7 6.5L3 9.5M7 6.5l4 3M7 6.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="3" cy="11" r="1.1" fill="currentColor"/>
      <circle cx="7" cy="11" r="1.1" fill="currentColor"/>
      <circle cx="11" cy="11" r="1.1" fill="currentColor"/>
    </svg>
  ),
  // ─── Sidebar nav icons (shown only when text labels hide at ≤900px) ───
  target: (p) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="9" cy="9" r="2.5" fill="currentColor"/>
    </svg>
  ),
  list: (p) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <circle cx="4" cy="5" r="1.2" fill="currentColor"/>
      <circle cx="4" cy="9" r="1.2" fill="currentColor"/>
      <circle cx="4" cy="13" r="1.2" fill="currentColor"/>
      <path d="M8 5h7M8 9h7M8 13h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  calendar: (p) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <rect x="2.5" y="3.5" width="13" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M2.5 7h13" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M6 2v3M12 2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  star: (p) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <path d="M9 1.5l1.8 5.5h5.7l-4.6 3.4 1.8 5.5L9 12.5l-4.6 3.4 1.8-5.5L1.5 7h5.7L9 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  ),
  book: (p) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <rect x="3.5" y="2.5" width="11" height="13" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  // Flag on a pole — marks tasks/groups that ladder to a committed goal.
  // Compact at small sizes so it can sit beside a title without crowding.
  milestone: (p) => (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M3.5 1.5v11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M3.5 2.2h7.5l-1.7 2.3 1.7 2.3H3.5z" fill="currentColor"/>
    </svg>
  ),
};

/* ─────────────────────── helpers ─────────────────────── */
function SourceChip({ id }) {
  const s = SOURCES[id];
  if (!s) return null;
  return (
    <span className="chip source-chip">
      <span className="chip-dot" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
function TagChip({ id }) {
  const t = TAGS[id];
  if (!t) return null;
  return <span className={`chip tag-chip tag-${id}`}>{t.label}</span>;
}
function fmtClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

/* ─────────────────────── sidebar ─────────────────────── */
function Sidebar({ activeView, setView, counts, profile, journalTodayEntries, journalStreak, collapsed, onToggleCollapse }) {
  return (
    <aside className="sidebar">
      <button
        className="panel-collapse-btn panel-collapse-left"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}>
        {collapsed ? "›" : "‹"}
      </button>
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">Lighthouse</div>
          <div className="brand-sub">a calm signal</div>
        </div>
      </div>

      {/* Today — the execution surface. Three slot squares fill based on count. */}
      <div className="nav-section tasks-section">
        <button
          className={`nav-tasks ${activeView === "today" ? "active" : ""}`}
          onClick={() => setView("today")}>
          <div className="nav-tasks-halftone" />
          <div className="nav-icon-only" aria-hidden><Icon.target /></div>
          <div className="nav-tasks-main">
            <div className="nav-tasks-eyebrow">
              <span className="nav-tasks-bullet" />
              EXECUTION SURFACE
            </div>
            <div className="nav-tasks-title">Today</div>
            <div className="nav-tasks-sub">
              {counts.now > 0 ? `${counts.now} now · ` : ""}
              {counts.today} committed
            </div>
          </div>
          <div className="nav-tasks-slots">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`nav-tasks-slot ${i < counts.today ? "filled" : ""}`}
              />
            ))}
          </div>
        </button>
      </div>

      {/* Tasks — the planning surface. Brain dump + this_week / this_month / backlog. */}
      <div className="nav-section inbox-section">
        <button
          className={`nav-inbox ${activeView === "tasks" ? "active" : ""}`}
          onClick={() => setView("tasks")}>
          <div className="nav-inbox-halftone" />
          <div className="nav-icon-only" aria-hidden><Icon.list /></div>
          <div className="nav-inbox-main">
            <div className="nav-inbox-eyebrow">
              <span className="nav-inbox-dot" />
              PLANNING SURFACE
            </div>
            <div className="nav-inbox-title">Tasks</div>
            <div className="nav-inbox-sub">
              {counts.inbox > 0 ? `${counts.inbox} brain-dump · ` : ""}
              {counts.this_week} this week
            </div>
          </div>
          <div className="nav-inbox-count">{counts.inbox + counts.this_week}</div>
        </button>
      </div>

      {/* Calendar gets its own section — it's the time-anchor for the day */}
      <div className="nav-section calendar-section">
        <button
          className={`nav-calendar ${activeView === "calendar" ? "active" : ""}`}
          onClick={() => setView("calendar")}>
          <div className="nav-calendar-halftone" />
          <div className="nav-icon-only" aria-hidden><Icon.calendar /></div>
          <div className="nav-calendar-main">
            <div className="nav-calendar-eyebrow">
              <span className="nav-calendar-dot" style={{ background: SOURCES.gcal.color }} />
              TIME LEFT
            </div>
            <div className="nav-calendar-title">Calendar</div>
            <div className="nav-calendar-sub">
              {counts.meetings} meetings today
            </div>
          </div>
          <div className="nav-calendar-stat">
            <div className="nav-calendar-num">{fmtDuration(FREE_TOTAL)}</div>
            <div className="nav-calendar-num-label">free</div>
          </div>
        </button>
      </div>

      {/* Goals — the why. Where everything else ladders to. */}
      <div className="nav-section goals-section">
        <button
          className={`nav-goals ${activeView === "goals" ? "active" : ""}`}
          onClick={() => setView("goals")}>
          <div className="nav-goals-halftone" />
          <div className="nav-icon-only" aria-hidden><Icon.star /></div>
          <div className="nav-goals-main">
            <div className="nav-goals-eyebrow">
              <span className="nav-goals-icon">✦</span>
              NORTH STAR
            </div>
            <div className="nav-goals-title">Goals</div>
            <div className="nav-goals-sub">
              {GOALS.annual.length} annual · {GOALS.quarterly.length} this quarter
            </div>
          </div>
          <div className="nav-goals-rings">
            {GOALS.annual.map(g => {
              const C = 2 * Math.PI * 9;
              return (
                <svg key={g.id} width="22" height="22" className="nav-goals-ring">
                  <circle cx="11" cy="11" r="9" fill="none" stroke="var(--rule)" strokeWidth="2"/>
                  <circle cx="11" cy="11" r="9" fill="none" stroke={g.color} strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${C * g.progress} ${C}`}
                    transform="rotate(-90 11 11)" />
                </svg>
              );
            })}
          </div>
        </button>
      </div>

      {/* Journal — the pause between things. Interstitial journaling. */}
      <div className="nav-section journal-section">
        <button
          className={`nav-journal ${activeView === "journal" ? "active" : ""}`}
          onClick={() => setView("journal")}>
          <div className="nav-journal-halftone" />
          <div className="nav-icon-only" aria-hidden><Icon.book /></div>
          <div className="nav-journal-main">
            <div className="nav-journal-eyebrow">
              <span className="nav-journal-quote">"</span>
              BETWEEN THE THINGS
            </div>
            <div className="nav-journal-title">Journal</div>
            <div className="nav-journal-sub">
              {journalTodayEntries.length} today · {journalStreak}-day streak
            </div>
          </div>
          <div className="nav-journal-strip">
            {/* Cap at 6 most-recent so the button stops growing past ~10
                entries. The actual total is in the sub line above. */}
            {journalTodayEntries.slice(-6).reverse().map((e) => {
              const m = MOODS.find(x => x.id === e.mood);
              return (
                <span
                  key={e.id}
                  className="nav-journal-strip-dot"
                  style={{ background: m?.color || "var(--muted-2)" }}
                />
              );
            })}
          </div>
        </button>
      </div>

      <div className="nav-section">
        <h4>Filters</h4>
        {Object.entries(TAGS).slice(0,4).map(([id, t]) => (
          <div key={id} className="source-row">
            <span className="source-dot" style={{ background: t.color }} />
            <span className="source-name">#{t.label}</span>
          </div>
        ))}
      </div>

      <div className="nav-section">
        <button
          className={`nav-item ${activeView === "settings" ? "active" : ""}`}
          onClick={() => setView("settings")}>
          <span className="nav-glyph">⚙</span>
          <span className="nav-label">Settings</span>
        </button>
      </div>

      <div className="sidebar-footer">
        <div className="avatar">{profile?.initials || "?"}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 12, fontWeight: 500 }}>{profile?.name || "You"}</div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile?.email || "5 sources synced · 2m ago"}
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ─────────────────────── focus / now card ─────────────────────── */
function FocusCard({ task, focusMode, setFocusMode, onOpenDetail, onStepAway, onMarkDone }) {
  const TOTAL = 25 * 60; // 25-minute pomodoro
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(TOTAL);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining(r => (r <= 0 ? 0 : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const pct = remaining / TOTAL;
  const C = 2 * Math.PI * 52;
  const dash = C * pct;

  // Empty Now — render a compact prompt card so the section never silently
  // disappears (previously this returned null, which made it look like a bug
  // after the user clicked Step away).
  if (!task) {
    return (
      <div className="focus-card empty">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="focus-eyebrow">
            <span className="focus-dot" />
            Right now · nothing in focus
          </div>
          <h2 className="focus-title focus-title-empty">
            <em>Pick what's next.</em>
          </h2>
          <p className="focus-note">
            Click <b style={{ color: "rgba(244,236,219,0.9)" }}>▶ Start</b> on any Today task
            to begin a 25-minute focus block. The task lifts here; the timer wakes up.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="focus-card">
      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="focus-eyebrow">
          <span className="focus-dot" />
          Right now · 25-minute focus
        </div>
        <h2 className="focus-title focus-title-clickable" onClick={() => onOpenDetail?.(task.id)}>
          {task.title}
        </h2>
        <p className="focus-note">{task.note}</p>
        <div className="focus-meta">
          <span className="chip">{SOURCES[task.source].label} · {task.project}</span>
          <TagChip id={task.tag} />
          <span><b style={{ color: "rgba(244,236,219,0.85)" }}>{task.estimate}</b> min budgeted</span>
          <span>·</span>
          <button
            className="timer-btn"
            style={{ padding: "2px 10px", fontSize: 11 }}
            onClick={() => onOpenDetail?.(task.id)}>
            Details
          </button>
          <button
            className="timer-btn"
            style={{ padding: "2px 10px", fontSize: 11 }}
            onClick={() => setFocusMode(!focusMode)}>
            {focusMode ? "Exit focus mode" : "Dim everything else"}
          </button>
          {onStepAway && (
            <button
              className="timer-btn"
              style={{ padding: "2px 10px", fontSize: 11 }}
              title="Move back to Today — pick a different focus later"
              onClick={() => onStepAway(task.id)}>
              ← Step away
            </button>
          )}
          {onMarkDone && (
            <button
              className="timer-btn primary"
              style={{ padding: "2px 12px", fontSize: 11 }}
              title="Mark done — the next Today task auto-advances into Now"
              onClick={() => onMarkDone(task.id)}>
              ✓ Done
            </button>
          )}
        </div>
      </div>

      <div className="focus-timer">
        <div className="timer-ring">
          <svg width="124" height="124">
            <circle cx="62" cy="62" r="52" stroke="rgba(244,236,219,0.12)" strokeWidth="3" fill="none" />
            <circle
              cx="62" cy="62" r="52"
              stroke="#f4ecdb" strokeWidth="3" fill="none"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C}`}
              style={{ transition: "stroke-dasharray 1s linear" }}
            />
          </svg>
          <div className="timer-num">
            {fmtClock(remaining)}
            <span>{running ? "in flow" : "paused"}</span>
          </div>
        </div>
        <div className="timer-actions">
          <button className="timer-btn primary" onClick={() => setRunning(r => !r)}>
            {running ? <Icon.pause /> : <Icon.play />}
            <span style={{ marginLeft: 6 }}>{running ? "Pause" : "Begin"}</span>
          </button>
          <button className="timer-btn" onClick={() => { setRunning(false); setRemaining(TOTAL); }}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── today list ─────────────────────── */
const TODAY_CAP = 3;
const REC_MIN_WEIGHT = 0.3;
// Two weights within this distance are treated as equal — the LLM clusters
// scores around round numbers (0.5, 0.7) and we don't want imaginary precision
// to determine ordering. Drops the decision to the next tiebreaker.
const REC_WEIGHT_EPSILON = 0.02;

// Lower rank wins. Anything explicitly dated beats undated;
// "today" beats "tomorrow" beats everything else dated (weekdays, "this week").
function dueRank(due) {
  if (!due) return 3;
  const d = String(due).toLowerCase();
  if (d === "today") return 0;
  if (d === "tomorrow") return 1;
  return 2;
}

// Ranking for the recommendation slots. Tiebreaker chain:
//   0. pinned desc — explicit user "promote this next" beats everything
//   1. weight desc (with epsilon — see REC_WEIGHT_EPSILON)
//   2. due-soon asc (dated tasks beat undated; today > tomorrow > rest)
//   3. user's Week-lane position asc — stable across refreshes and
//      gives the user implicit control via drag-to-reorder.
// Then theme spread: first pass picks ≤1 per theme so the three slots
// aren't all one cluster (e.g. all email triage). If strict spread would
// leave slots empty, a second pass allows repeats. Pinned items are
// exempt from theme spread — explicit intent wins over diversity.
function rankRecommendations(eligible, slotsLeft) {
  const ranked = [...eligible].sort((a, b) => {
    const dp = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    if (dp !== 0) return dp;
    const dw = (b.weight ?? 0) - (a.weight ?? 0);
    if (Math.abs(dw) > REC_WEIGHT_EPSILON) return dw;
    const dd = dueRank(a.due) - dueRank(b.due);
    if (dd !== 0) return dd;
    return (a.position ?? 0) - (b.position ?? 0);
  });

  const picks = [];
  const usedThemes = new Set();
  for (const t of ranked) {
    if (picks.length >= slotsLeft) break;
    // Pinned items always fill a slot, regardless of theme overlap — the
    // user's explicit "promote this next" signal overrides theme spread.
    if (t.pinned) {
      picks.push(t);
      usedThemes.add(t.theme || "_untagged");
      continue;
    }
    const theme = t.theme || "_untagged";
    if (usedThemes.has(theme)) continue;
    picks.push(t);
    usedThemes.add(theme);
  }
  if (picks.length < slotsLeft) {
    const pickedIds = new Set(picks.map(t => t.id));
    for (const t of ranked) {
      if (picks.length >= slotsLeft) break;
      if (!pickedIds.has(t.id)) picks.push(t);
    }
  }
  return picks;
}

function TodayList({ tasks, toggleDone, doneSet, weekTasks, onPromote, onDefer, onOpenDetail, onStartNow, nowTaskId, onReorder }) {
  const openCount = tasks.filter(t => !doneSet.has(t.id)).length;
  const slotsLeft = Math.max(0, TODAY_CAP - openCount);

  // Sort done items to the bottom while preserving relative order within each
  // group. The underlying position field still drives ordering between peers;
  // done-state just partitions the list visually so open work stays on top
  // and finished items become a "ledger" beneath. handleDrop uses this same
  // array so drop indices match what the user sees.
  const displayTasks = useMemo(() => {
    const open = tasks.filter(t => !doneSet.has(t.id));
    const done = tasks.filter(t =>  doneSet.has(t.id));
    return [...open, ...done];
  }, [tasks, doneSet]);

  // Drag-to-reorder state — the id currently being dragged, and the id being
  // hovered (for the insertion-line indicator).
  const [draggingId, setDraggingId] = useState(null);
  const [hoverId, setHoverId]       = useState(null);
  const handleDrop = (targetId) => {
    if (!draggingId || draggingId === targetId) return;
    const targetIdx = displayTasks.findIndex(t => t.id === targetId);
    if (targetIdx === -1) return;
    onReorder?.(draggingId, targetIdx);
    setDraggingId(null);
    setHoverId(null);
  };

  // Compute the FULL ranked queue (no cap) — pinned + theme-spread picks
  // first, then everything else by weight. The visible truncation happens
  // at render time so the user can expand to see the whole queue without
  // re-running the ranking. Number.MAX_SAFE_INTEGER as slotsLeft lets
  // rankRecommendations exhaust the eligible pool through its second
  // "allow repeats" pass.
  const recommendations = useMemo(() => {
    const todayIds = new Set(tasks.map(t => t.id));
    // Pinned bypasses the weight floor — an explicit 📌 (or a "→ Today"
    // overflow that auto-pins) is a stronger signal than enrichment weight,
    // and a freshly-triaged brain-dump item has no weight yet anyway.
    const eligible = (weekTasks || []).filter(
      t => (t.pinned || (t.weight ?? 0) >= REC_MIN_WEIGHT) && !todayIds.has(t.id)
    );
    return rankRecommendations(eligible, Number.MAX_SAFE_INTEGER);
  }, [weekTasks, tasks]);
  // Top-3 collapsed by default; expand to see the rest of the queue.
  const [upNextExpanded, setUpNextExpanded] = useState(false);
  const VISIBLE_REC_COUNT = 3;
  const visibleRecs = upNextExpanded
    ? recommendations
    : recommendations.slice(0, VISIBLE_REC_COUNT);
  const hiddenRecCount = Math.max(0, recommendations.length - VISIBLE_REC_COUNT);

  // One "acting" lock per row covers both Pull and Defer — they're mutually
  // exclusive on the same rec, and either action triggers a refresh that
  // replaces the row anyway.
  const [actingId, setActingId] = useState(null);
  const handlePromote = async (id) => {
    if (actingId || !onPromote) return;
    setActingId(id);
    try { await onPromote(id); } finally { setActingId(null); }
  };
  const handleDefer = async (id) => {
    if (actingId || !onDefer) return;
    setActingId(id);
    try { await onDefer(id); } finally { setActingId(null); }
  };

  return (
    <>
    <section className="today-section" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="section-head">
        <div>
          <div className="section-title">Today's three</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Hard cap. If a fourth thing wants in, something else has to move.
          </div>
        </div>
        <div className="section-meta">
          <b>{openCount}</b> remaining
          <span className="divider-dot" />
          <b>{tasks.reduce((a,t) => a + (t.estimate||0), 0)}</b> min total
        </div>
      </div>

      <div className="task-list">
        {displayTasks.map(t => {
          const done = doneSet.has(t.id);
          const isDragging = draggingId === t.id;
          const isHover    = hoverId === t.id && draggingId && draggingId !== t.id;
          return (
            <div
              key={t.id}
              className={`task-row draggable ${done ? "done" : ""} ${t.bigRock ? "big-rock" : ""} ${isDragging ? "dragging" : ""} ${isHover ? "drop-target" : ""}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", t.id);
                setDraggingId(t.id);
              }}
              onDragEnd={() => { setDraggingId(null); setHoverId(null); }}
              onDragOver={(e) => {
                if (!draggingId || draggingId === t.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverId !== t.id) setHoverId(t.id);
              }}
              onDragLeave={() => { if (hoverId === t.id) setHoverId(null); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(t.id); }}
              onClick={() => onOpenDetail?.(t.id)}>
              <span className="drag-handle" aria-hidden>⋮⋮</span>
              <button
                className="check check-btn"
                onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }}
                aria-label={done ? "Mark undone" : "Mark done"}>
                <Icon.check />
              </button>
              <div className="task-main">
                <div className="task-title">
                  {t.primaryGoalId && (t.weight ?? 0) >= MILESTONE_WEIGHT && (
                    <span className="row-milestone-flag" title="Direct contributor to a milestone">
                      <Icon.milestone />
                    </span>
                  )}
                  {t.title}
                  {t.bigRock && (
                    <span className="chip" style={{ background: "var(--accent)", color: "#fbf8f1", borderColor: "transparent", fontSize: 10 }}>
                      big rock
                    </span>
                  )}
                </div>
                {t.note && <div className="task-note task-note-preview">{t.note}</div>}
              </div>
              <div className="task-right">
                <TagChip id={t.tag} />
                <SourceChip id={t.source} />
                {t.project && <span className="row-project mono">{t.project}</span>}
                <span className="estimate mono">{t.estimate}m</span>
                {onStartNow && (
                  <button
                    className="start-now-btn"
                    title="Pull into Now — start a 25-min focus block"
                    onClick={(e) => { e.stopPropagation(); onStartNow(t.id); }}>
                    ▶ Start
                  </button>
                )}
              </div>
            </div>
          );
        })}

      </div>
    </section>

    <section className="rec-section" style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 28 }}>
        <div className="section-head">
          <div>
            <div className="section-title">Up next</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {slotsLeft > 0
                ? "Pinned items first, then highest-weighted picks from this week. Pull what fits."
                : "Today is full — these queue up after you finish the current three."}
            </div>
          </div>
          <div className="section-meta">
            {slotsLeft > 0
              ? <><b>{slotsLeft}</b> open slot{slotsLeft === 1 ? "" : "s"} · <b>{recommendations.length}</b> queued</>
              : <><b>{recommendations.length}</b> queued <span style={{ color: "var(--muted-2)" }}>· preview</span></>}
          </div>
        </div>

        {recommendations.length > 0 ? (
          <div className="task-list">
            {visibleRecs.map(t => (
              <div
                key={`rec-${t.id}`}
                className={`task-row rec-row ${t.pinned ? "rec-pinned" : ""}`}
                onClick={() => onOpenDetail?.(t.id)}
                title={t.reasoning || "Recommended from this week — click for details"}>
                {/* Empty rail span — keeps the grid alignment with regular
                    task-rows (which have a drag-handle + check in cols 1-2).
                    Pinned items show 📌; non-pinned leave the gutter clean. */}
                <span className="rec-rail" aria-hidden>{t.pinned ? "📌" : ""}</span>
                <div className="task-main">
                  <div className="task-title">
                    {t.title}
                    {t.pinned && (
                      <span style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700,
                        letterSpacing: "0.1em", color: "var(--accent)",
                        textTransform: "uppercase",
                      }}>
                        Pinned
                      </span>
                    )}
                  </div>
                  <div className="task-note rec-meta">
                    <span className="rec-theme">{t.theme || "This week"}</span>
                    {t.reasoning && <span className="rec-reason"> · {t.reasoning}</span>}
                  </div>
                </div>
                <div className="task-right">
                  <SourceChip id={t.source} />
                  <span className="ondeck-weight high" title={`Weight ${Math.round((t.weight ?? 0) * 100)}%`}>
                    {Math.round((t.weight ?? 0) * 100)}
                  </span>
                  <button
                    className="rec-defer"
                    disabled={actingId === t.id}
                    title="Not a good fit — push to Later"
                    onClick={(e) => { e.stopPropagation(); handleDefer(t.id); }}>
                    → Later
                  </button>
                  <button
                    className="rec-pull"
                    disabled={actingId === t.id}
                    onClick={(e) => { e.stopPropagation(); handlePromote(t.id); }}>
                    {actingId === t.id ? "…" : "+ Pull"}
                  </button>
                </div>
              </div>
            ))}
            {hiddenRecCount > 0 && !upNextExpanded && (
              <button
                className="up-next-expand"
                onClick={() => setUpNextExpanded(true)}>
                Show {hiddenRecCount} more ▾
              </button>
            )}
            {upNextExpanded && recommendations.length > VISIBLE_REC_COUNT && (
              <button
                className="up-next-expand"
                onClick={() => setUpNextExpanded(false)}>
                Hide ▴
              </button>
            )}
          </div>
        ) : (
          <div className="rec-empty">
            No strong picks above the line. <em>Re-rank the week list or add a goal these would ladder to.</em>
          </div>
        )}
      </section>
    </>
  );
}

/* ─────────────────────── on-deck list ─────────────────────── */
/* ─────────────────────────────────────────────────────────────
   This week — synced tasks grouped by LLM-derived theme + weight.
   Each task has a weight (0-1) and a theme assigned by the
   enrichment agent. Themes are sorted by max weight; tasks with
   weight < 0.3 fold under "Below the line" per theme.
   ───────────────────────────────────────────────────────────── */
const UNSORTED_THEME = "Awaiting triage";
const BELOW_LINE = 0.3;
// Threshold for treating a primary_goal_id link as a true milestone
// association vs. the agent's loose "could-plausibly-ladder" tagging.
// Tasks below this still keep their goal_id in the data, but render in
// theme-grouped clusters and skip the milestone flag.
const MILESTONE_WEIGHT = 0.5;

// Quick-action lane shortcuts shown on row hover. Each lane gets only the 1-2
// most-likely moves from where it currently sits — cuts triage clicks for the
// common path without crowding the row with all 4 destinations. Edge-case
// moves (e.g. backlog → today) still go through the detail modal.
function quickLaneActions(lane) {
  // Convention: ↑ always promotes toward Today (more committed), ↓ always
  // demotes toward Backlog (less committed). Each row has at most one of
  // each direction so there's no within-row ambiguity. Tooltips name the
  // specific destination on hover.
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

function OnDeck({ tasks, toggleDone, doneSet, onReenrich, onOpenDetail, onTogglePin, onChangeLane, goals }) {
  const [reenriching, setReenriching] = useState(false);
  const [showBelow, setShowBelow] = useState(() => new Set());
  const dueClass = (d) => (d === "tomorrow" || d === "fri") ? "warn" : "";

  const groups = useMemo(() => {
    // Build a goal-id → {title, horizon} lookup so tasks with a
    // primary_goal_id can be grouped under their milestone name. The
    // monthly title is the strongest signal (e.g. "May: MVP 内核开发完成");
    // quarterly + annual are fallbacks if a task ladders higher.
    const goalsById = new Map();
    (goals?.monthly   || []).forEach((g) => goalsById.set(g.id, { title: g.title, horizon: "monthly" }));
    (goals?.quarterly || []).forEach((g) => goalsById.set(g.id, { title: g.title, horizon: "quarterly" }));
    (goals?.annual    || []).forEach((g) => goalsById.set(g.id, { title: g.title, horizon: "annual" }));

    // Pinned items used to render in a dedicated "📌 Pinned · next up" group
    // at the top of This week — but that visually claimed the "next lineup"
    // role on the Tasks page, when actual Today-execution lives on the Today
    // tab (which has its own "Up next" section that already surfaces pins
    // first). Removed: pins now sit inside their own theme/milestone group
    // with the row-level 📌 marker for identification.
    const rest = tasks;

    // Bucket map: key → { label, tasks, isMilestone }
    // Only treat as milestone-group when weight >= MILESTONE_WEIGHT — the
    // enrichment agent can be liberal with primary_goal_id ("plausibly
    // related") and we want this view to surface direct contributors, not
    // ambient work that pattern-matches a goal. Lower-weight goal-linked
    // tasks fall back to theme grouping.
    const buckets = new Map();
    for (const t of rest) {
      const goal = t.primaryGoalId ? goalsById.get(t.primaryGoalId) : null;
      const strongLink = goal && (t.weight ?? 0) >= MILESTONE_WEIGHT;
      let key, label, isMilestone;
      if (strongLink) {
        key = `goal:${t.primaryGoalId}`;
        label = goal.title;
        isMilestone = true;
      } else {
        const theme = t.theme || UNSORTED_THEME;
        key = `theme:${theme}`;
        label = theme;
        isMilestone = false;
      }
      if (!buckets.has(key)) buckets.set(key, { label, tasks: [], isMilestone });
      buckets.get(key).tasks.push(t);
    }
    for (const v of buckets.values()) {
      v.tasks.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    }
    // Two-tier sort: milestone groups first (they're the spine — what
    // ladders to your committed goals), then loose theme groups. Within
    // each tier, sort by max weight desc so highest-impact surfaces first.
    // Awaiting-triage theme always lands at the very bottom.
    const entries = [...buckets.entries()].map(([k, v]) => ({ key: k, ...v }));
    const maxW = (tasks) => tasks.reduce((m, t) => Math.max(m, t.weight ?? 0), 0);
    const milestoneGroups = entries.filter((e) => e.isMilestone).sort((a, b) => maxW(b.tasks) - maxW(a.tasks));
    const themeGroups = entries.filter((e) => !e.isMilestone).sort((a, b) => {
      if (a.label === UNSORTED_THEME) return 1;
      if (b.label === UNSORTED_THEME) return -1;
      return maxW(b.tasks) - maxW(a.tasks);
    });
    const sorted = [...milestoneGroups, ...themeGroups].map((e) => [e.label, e.tasks, e.isMilestone]);
    return sorted;
  }, [tasks, goals]);

  const totalAbove = useMemo(
    () => tasks.filter((t) => (t.weight ?? 0) >= BELOW_LINE).length,
    [tasks]
  );

  const handleReenrich = async () => {
    if (reenriching || !onReenrich) return;
    setReenriching(true);
    try { await onReenrich(); } finally { setReenriching(false); }
  };

  const toggleBelow = (theme) => {
    setShowBelow((prev) => {
      const next = new Set(prev);
      next.has(theme) ? next.delete(theme) : next.add(theme);
      return next;
    });
  };

  return (
    <section className="ondeck-section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="section-head">
        <div>
          <div className="section-title">This week</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Pulled into the week's plan. Grouped by what they're about, ranked by alignment with your goals.
            {totalAbove > 0 && <> Showing <b style={{ color: "var(--ink-2)" }}>{totalAbove}</b> above the line.</>}
          </div>
        </div>
        <div className="section-meta">
          <button
            className="ondeck-reenrich"
            onClick={handleReenrich}
            disabled={reenriching}
            title="Re-run the enrichment agent">
            {reenriching ? "Re-ranking…" : "↻ Re-rank"}
          </button>
        </div>
      </div>

      {groups.map(([theme, themeTasks, isMilestone]) => {
        const above = themeTasks.filter((t) => (t.weight ?? 0) >= BELOW_LINE);
        const below = themeTasks.filter((t) => (t.weight ?? 0) < BELOW_LINE);
        const open = showBelow.has(theme);
        const isUnsorted = theme === UNSORTED_THEME;
        const visible = isUnsorted ? themeTasks : above;

        return (
          <div key={theme} className={`ondeck-theme ${isMilestone ? "milestone-group" : ""}`}>
            <div className="ondeck-theme-head">
              <span className="ondeck-theme-name">
                {isMilestone && (
                  <span className="milestone-eyebrow" title="Milestone">
                    <Icon.milestone />
                  </span>
                )}
                {theme}
              </span>
              <span className="ondeck-theme-meta">{themeTasks.length}</span>
            </div>
            <div className="ondeck-list">
              {visible.map((t) => (
                <OnDeckRow
                  key={t.id}
                  task={t}
                  done={doneSet.has(t.id)}
                  toggleDone={toggleDone}
                  dueClass={dueClass}
                  onOpenDetail={onOpenDetail}
                  onTogglePin={onTogglePin}
                  onChangeLane={onChangeLane}
                />
              ))}
              {!isUnsorted && below.length > 0 && (
                <>
                  <button className="ondeck-below-toggle" onClick={() => toggleBelow(theme)}>
                    {open ? "− Hide" : "+ Below the line"} · {below.length} {below.length === 1 ? "item" : "items"}
                  </button>
                  {open && below.map((t) => (
                    <OnDeckRow
                      key={t.id}
                      task={t}
                      done={doneSet.has(t.id)}
                      toggleDone={toggleDone}
                      dueClass={dueClass}
                      dimmed
                      onOpenDetail={onOpenDetail}
                      onTogglePin={onTogglePin}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}

      {tasks.length === 0 && (
        <div className="empty-state" style={{ padding: "40px 20px" }}>
          <div className="empty-state-icon" />
          <div className="empty-state-title">No tasks pulled into this week yet.</div>
          <div className="empty-state-sub">New syncs land in Later — open one and move it here to commit.</div>
        </div>
      )}
    </section>
  );
}

function OnDeckRow({ task: t, done, toggleDone, dueClass, dimmed, onOpenDetail, onTogglePin, onChangeLane }) {
  const w = t.weight ?? null;
  const weightCls =
    w === null      ? "none" :
    w >= 0.7        ? "high" :
    w >= BELOW_LINE ? "mid"  :
                      "low";
  return (
    <div
      className={`ondeck-row ${done ? "done" : ""} ${dimmed ? "dim" : ""} ${t.pinned ? "pinned" : ""}`}
      onClick={() => onOpenDetail?.(t.id)}
      title={t.reasoning || "Click for details"}>
      <button
        className="check check-btn"
        onClick={(e) => { e.stopPropagation(); toggleDone(t.id); }}
        aria-label={done ? "Mark undone" : "Mark done"}>
        <Icon.check />
      </button>
      <span className="ondeck-title">{t.title}</span>
      <TagChip id={t.tag} />
      <SourceChip id={t.source} />
      {t.project && <span className="row-project mono">{t.project}</span>}
      <span className={`due ${dueClass(t.due)}`}>{t.due}</span>
      {w !== null && (
        <span className={`ondeck-weight ${weightCls}`}>
          {Math.round(w * 100)}
        </span>
      )}
      {onChangeLane && quickLaneActions(t.lane).map((a) => (
        <button
          key={a.target}
          className="quick-lane-btn"
          title={a.title}
          onClick={(e) => { e.stopPropagation(); onChangeLane(t.id, a.target); }}>
          {a.icon}
        </button>
      ))}
      {onTogglePin && (
        <button
          className={`ondeck-pin ${t.pinned ? "active" : ""}`}
          title={t.pinned ? "Unpin" : "Pin — promote next when Today opens up"}
          onClick={(e) => { e.stopPropagation(); onTogglePin(t.id, !t.pinned); }}>
          📌
        </button>
      )}
    </div>
  );
}

/* ─────────────────────── right rail components ─────────────────────── */
// Encouragement scales with the day's completion count. Pure function of n —
// no state, no cost — so it recomputes live as tasks are checked off/undone.
function doneEncouragement(n) {
  if (n === 0) return "A fresh page. Pick one small thing.";
  if (n === 1) return "One done — the hardest part was starting.";
  if (n === 2) return "Two down. You've got momentum.";
  if (n <= 4)  return `${n} today. You're in a groove.`;
  return `${n} today. That's a strong day, Roger.`;
}

function DoneTodayCard({ count }) {
  return (
    <div className="rail-card tinted done-card">
      <div className="rail-head">
        <h3>Done today</h3>
        <span className="muted">✦ keep going</span>
      </div>
      <div className="done-stat">
        <span className="done-num">{count}</span>
        <span className="done-label">{count === 1 ? "task" : "tasks"}</span>
      </div>
      <div className="done-encourage">{doneEncouragement(count)}</div>
    </div>
  );
}

function WeekGlance() {
  return (
    <div className="rail-card">
      <div className="rail-head">
        <h3>The week</h3>
        <span className="muted">May 11 – 17</span>
      </div>
      <div className="week-grid">
        {WEEK.map((d, i) => (
          <div key={i} className={`week-col ${d.today ? "today" : ""} ${d.past ? "past" : ""}`}>
            <span className="week-day">{d.day}</span>
            <div className="week-bar">
              <div className="week-bar-fill" style={{ height: `${d.load * 100}%` }} />
            </div>
            <span className="week-date mono">{d.date}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Friday is heavy. Consider <b style={{ color: "var(--ink-2)" }}>moving the contractor doc</b> to Wednesday.
      </div>
    </div>
  );
}

function EnergyCard() {
  const [energy, setEnergy] = useState(3);
  const [focus, setFocus]   = useState(4);
  const [mood, setMood]     = useState(3);

  const Row = ({ label, value, set, cls }) => (
    <div className="energy-row">
      <span className="energy-label">{label}</span>
      <div className={`energy-bar ${cls}`}>
        {[1,2,3,4,5].map(n => (
          <div
            key={n}
            className={`seg ${n <= value ? "on" : ""}`}
            onClick={() => set(n)}
          />
        ))}
      </div>
    </div>
  );

  const suggest =
    energy >= 4 && focus >= 4 ? "Strike now — start the deep work block."
    : energy <= 2             ? "Low battery. A shallow task + walk would beat forcing focus."
    : focus  <= 2             ? "Wandering mind. Try 10 min of single-task warmup first."
    :                           "Steady. Begin the 25-minute focus on the highlighted task.";

  return (
    <div className="rail-card tinted">
      <div className="rail-head">
        <h3>Right now</h3>
        <span className="muted">honest check-in</span>
      </div>
      <div className="energy">
        <Row label="energy" value={energy} set={setEnergy} cls="" />
        <Row label="focus"  value={focus}  set={setFocus}  cls="focus" />
        <Row label="mood"   value={mood}   set={setMood}   cls="calm" />
      </div>
      <div className="energy-note" style={{ marginTop: 12 }}>
        {suggest}
      </div>
    </div>
  );
}

function InboxCard({ items, triage, onComplete, onOpenDetail, onOpen }) {
  return (
    <div className="rail-card">
      <div className="rail-head">
        <h3>Inbox</h3>
        <button className="rail-link" onClick={onOpen}>
          Open <Icon.arrowDown style={{ transform: "rotate(-90deg)" }} />
        </button>
      </div>
      <div>
        {items.slice(0, 4).map(it => (
          <div key={it.id} className="inbox-row" onClick={() => onOpenDetail?.(it.id)} title="Open detail">
            <button
              className="check check-btn"
              onClick={(e) => { e.stopPropagation(); onComplete?.(it.id); }}
              aria-label="Mark done">
              <Icon.check />
            </button>
            <span className="inbox-source" style={{ background: SOURCES[it.source].color }}>
              {SOURCES[it.source].glyph}
            </span>
            <div className="inbox-body">
              <span className="inbox-title">{it.title}</span>
              <div className="inbox-actions">
                <button className="today" onClick={(e) => { e.stopPropagation(); triage(it.id, "today"); }}>Today</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "this_week"); }}>Week</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "this_month"); }}>Month</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "backlog"); }}>Later</button>
                <button onClick={(e) => { e.stopPropagation(); triage(it.id, "drop"); }}>Drop</button>
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ padding: "10px 0", fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
            Inbox zero. Breathe.
          </div>
        )}
        {items.length > 4 && (
          <button className="inbox-see-all" onClick={onOpen}>
            See all {items.length} →
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Rail calendar — Journal view only. Mini month grid with a dot
   on days that have at least one entry; click a date to filter
   the JournalPage feed to just that day.
   ───────────────────────────────────────────────────────────── */
function localDayStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function JournalDateRail({ days, selectedDate, onSelectDate, startOfTodayMs }) {
  const todayStr = useMemo(() => localDayStr(new Date(startOfTodayMs)), [startOfTodayMs]);
  const daySet = useMemo(() => new Set(days || []), [days]);

  // The month currently displayed in the grid. Anchored to the selected date
  // when set, otherwise the current month.
  const [viewMonth, setViewMonth] = useState(() => {
    const seed = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date(startOfTodayMs);
    return new Date(seed.getFullYear(), seed.getMonth(), 1);
  });

  // Keep the grid in sync if selection changes (e.g., from Today button).
  useEffect(() => {
    if (!selectedDate) return;
    const d = new Date(`${selectedDate}T00:00:00`);
    setViewMonth(prev => {
      if (prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth()) return prev;
      return new Date(d.getFullYear(), d.getMonth(), 1);
    });
  }, [selectedDate]);

  // 6×7 grid — start from the Monday on or before the 1st, fill 42 cells.
  const cells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    // JS: 0=Sun..6=Sat. Convert so Mon=0..Sun=6.
    const dow = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - dow);
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [viewMonth]);

  const goPrev = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const goNext = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  const goToday = () => {
    const today = new Date(startOfTodayMs);
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(null); // null = "recent" view (today + last 7 days)
  };

  const monthLabel = `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  return (
    <div className="rail-card">
      <div className="rail-head">
        <h3>Journal · pick a day</h3>
        <button className="rail-link" onClick={goToday}>Today</button>
      </div>

      <div className="rail-cal-nav">
        <button className="rail-cal-arrow" onClick={goPrev} aria-label="Previous month">‹</button>
        <div className="rail-cal-month">{monthLabel}</div>
        <button className="rail-cal-arrow" onClick={goNext} aria-label="Next month">›</button>
      </div>

      <div className="rail-cal-dow">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <span key={i} className="rail-cal-dow-cell">{d}</span>
        ))}
      </div>

      <div className="rail-cal-grid">
        {cells.map((d) => {
          const ds = localDayStr(d);
          const inMonth = d.getMonth() === viewMonth.getMonth();
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          const isFuture = d.getTime() > startOfTodayMs + 24 * 60 * 60 * 1000 - 1;
          const hasEntry = daySet.has(ds);
          const cls = [
            "rail-cal-cell",
            inMonth ? "in-month" : "out-month",
            isToday ? "today" : "",
            isSelected ? "selected" : "",
            isFuture ? "future" : "",
            hasEntry ? "has-entry" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={ds}
              className={cls}
              disabled={isFuture}
              onClick={() => onSelectDate(isSelected ? null : ds)}
              title={hasEntry ? `${ds} — has entries` : ds}>
              <span className="rail-cal-num">{d.getDate()}</span>
              {hasEntry && <span className="rail-cal-dot" />}
            </button>
          );
        })}
      </div>

      <div className="rail-cal-foot">
        {selectedDate ? (
          <>
            <span className="rail-cal-foot-label">Viewing</span>
            <span className="mono rail-cal-foot-date">{selectedDate}</span>
            <button className="rail-cal-clear" onClick={() => onSelectDate(null)}>clear</button>
          </>
        ) : (
          <span className="rail-cal-foot-label">Showing recent 7 days. Click any day with a dot.</span>
        )}
      </div>
    </div>
  );
}

function CalendarCard({ focusTask, onSchedule, scheduled, onOpen }) {
  const day = CALENDAR.dayEnd - CALENDAR.dayStart;
  const pct = (m) => ((m - CALENDAR.dayStart) / day) * 100;
  const dur = (b) => ((b.end - b.start) / day) * 100;
  const nowMin = nowInMinutes();
  const nextEvent = CALENDAR.events.find((e) => e.start > nowMin);

  return (
    <div className="rail-card cal-widget">
      <div className="rail-head">
        <h3>Calendar</h3>
        <button className="rail-link" onClick={onOpen}>
          Open <Icon.arrowDown style={{ transform: "rotate(-90deg)" }} />
        </button>
      </div>

      <div className="cal-widget-stat">
        <div>
          <div className="cal-widget-num">{fmtDuration(FREE_TOTAL)}</div>
          <div className="cal-widget-label">free today</div>
        </div>
        <div className="cal-widget-best">
          <div className="cal-widget-best-eyebrow">deep-work pocket</div>
          <div className="cal-widget-best-time">{fmtTime(BEST_BLOCK.start)} – {fmtTime(BEST_BLOCK.end)}</div>
        </div>
      </div>

      {/* horizontal mini-timeline */}
      <div className="cal-widget-strip">
        <div
          className="cal-widget-best-marker"
          style={{ left: `${pct(BEST_BLOCK.start)}%`, width: `${dur(BEST_BLOCK)}%` }}
        />
        {CALENDAR.events.map(e => (
          <div
            key={e.id}
            className="cal-widget-event"
            style={{
              background: e.color,
              left: `${pct(e.start)}%`,
              width: `${dur(e)}%`,
            }}
            title={`${e.title} · ${fmtTime(e.start)}–${fmtTime(e.end)}`}
          />
        ))}
      </div>
      <div className="cal-widget-axis">
        <span>{fmtTime(CALENDAR.dayStart)}</span>
        <span>12pm</span>
        <span>{fmtTime(CALENDAR.dayEnd)}</span>
      </div>

      {nextEvent ? (
        <div className="cal-widget-next">
          <span className="cal-widget-next-dot" style={{ background: nextEvent.color }} />
          <span className="cal-widget-next-title">Next: {nextEvent.title}</span>
          <span className="cal-widget-next-time mono">{fmtTime(nextEvent.start)}</span>
        </div>
      ) : (
        <div className="cal-widget-next" style={{ color: "var(--muted)" }}>
          <span className="cal-widget-next-title">No more meetings today.</span>
        </div>
      )}

      <button
        className={`cal-cta ${scheduled ? "scheduled" : ""}`}
        onClick={onSchedule}>
        {scheduled
          ? `Scheduled for ${fmtTime(BEST_BLOCK.start)}`
          : `Block ${fmtTime(BEST_BLOCK.start)} for focus`}
      </button>
    </div>
  );
}

/* ─────────────────────── top bar ─────────────────────── */
function TopBar({ onSuggest, profile }) {
  const firstName = (profile?.name || "you").trim().split(/\s+/)[0];
  const meetingCount = CALENDAR.events.length;
  return (
    <div className="topbar">
      <div>
        <div className="greeting-eyebrow">
          {todayLong()}
          <span className="divider-dot" />
          <span style={{ color: "var(--accent-3)", fontWeight: 600, letterSpacing: "0.04em" }}>
            {fmtDuration(FREE_TOTAL).toUpperCase()} FREE
          </span>
          <span className="divider-dot" />
          {meetingCount} {meetingCount === 1 ? "meeting" : "meetings"}
        </div>
        <h1 className="greeting">
          {timeBasedGreeting()}, {firstName}.<br />
          One thing at a time — <em>start with the bold one.</em>
        </h1>
      </div>
      <div className="topbar-actions">
        <button className="suggest-btn" onClick={onSuggest}>
          <span className="suggest-btn-icon">✦</span>
          Suggest from goals
        </button>
        <button className="icon-btn" title="Notifications"><Icon.bell /></button>
        <button className="icon-btn" title="New"><Icon.plus /></button>
      </div>
    </div>
  );
}

/* ─────────────────────── app shell ─────────────────────── */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "halftone": 55,
  "warmth": "cream",
  "accent": "#b8442e",
  "showInbox": true
}/*EDITMODE-END*/;

function App() {
  const [activeView, setActiveView] = useState("today");
  const [doneSet, setDoneSet] = useState(() => window.__initialDoneSet ?? new Set());
  const [focusMode, setFocusMode] = useState(false);
  // Manual collapse toggles — persisted to localStorage so the chosen
  // layout survives reloads. Independent of the responsive breakpoints
  // (those still take over below their threshold widths).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("lighthouse.sidebarCollapsed") === "true");
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem("lighthouse.railCollapsed") === "true");
  useEffect(() => { localStorage.setItem("lighthouse.sidebarCollapsed", String(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => { localStorage.setItem("lighthouse.railCollapsed", String(railCollapsed)); }, [railCollapsed]);
  const [toast, setToast] = useState(null); // { kind: "warn"|"ok", text: string }
  const [capModal, setCapModal] = useState(null); // { newItemTitle, retry: async () => Response, onResolve?: (ok: boolean) => void }
  const [capBusy, setCapBusy] = useState(false);

  // Single source of truth for the task pool — initialized from data.jsx's preload,
  // refreshed via refreshTasks() after any mutation or background sync trigger.
  const [tasks, setTasks] = useState(() => window.TASKS ?? []);

  // Currently-open task detail modal. Lives at App level so any view (Today,
  // OnDeck, Focus card, rec rows) can open the same modal. Must come AFTER
  // `tasks` is declared — the in-browser Babel downgrade of `const` to `var`
  // doesn't give us a temporal-dead-zone, so referencing it before init reads
  // `undefined` instead of throwing.
  const [detailTaskId, setDetailTaskId] = useState(null);
  const detailTask = useMemo(
    () => (detailTaskId ? tasks.find(t => t.id === detailTaskId) || null : null),
    [detailTaskId, tasks]
  );
  const openDetail = useCallback((id) => setDetailTaskId(id), []);
  const inbox = useMemo(() => tasks.filter(t => t.lane === "inbox"), [tasks]);
  const [scheduled, setScheduled] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [profile, setProfile] = useState(() => window.PROFILE ?? { name: "You", email: "", initials: "?" });
  const [goals, setGoals] = useState(() => window.GOALS ?? { annual: [], quarterly: [], monthly: [] });

  const refreshGoals = useCallback(async () => {
    try {
      const data = await fetch("/api/goals").then(r => r.json());
      setGoals(data);
      window.GOALS = data;
    } catch (err) {
      console.warn("refreshGoals failed:", err);
    }
  }, []);

  const [journal, setJournal] = useState(() => window.JOURNAL ?? []);
  const [journalStreak, setJournalStreak] = useState(() => window.JOURNAL_STREAK ?? 0);
  // Days (YYYY-MM-DD, local TZ) that have at least one entry — drives the rail calendar dots.
  const [journalDays, setJournalDays] = useState(() => window.JOURNAL_DAYS ?? []);
  // null = "recent / today + 7d" mode; "YYYY-MM-DD" = single-day filter from the rail calendar.
  const [journalSelectedDate, setJournalSelectedDate] = useState(null);

  // Today-boundary state — refreshed every minute. Both the sidebar mood-strip
  // and JournalPage's bucket memo depend on it, so day rollover at midnight
  // re-buckets entries automatically.
  const [startOfTodayMs, setStartOfTodayMs] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      const ms = d.getTime();
      setStartOfTodayMs(prev => (prev === ms ? prev : ms));
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Calendar free-time ticker: re-fetch /api/calendar/today every 60s and
  // bump a tick state so components reading the (now updated) globals
  // re-render. The server's `freeTotal` is computed dynamically from the
  // current minute, so this is what makes "7h 30m free" count down to
  // "0h 0m" as the day passes — no client-side math needed.
  const [calTick, setCalTick] = useState(0);
  useEffect(() => {
    const refresh = async () => {
      await window.refreshCalendar?.();
      setCalTick((t) => t + 1);
    };
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, []);

  const journalTodayEntries = useMemo(() => {
    return journal
      .filter(e => new Date(e.createdAt).getTime() >= startOfTodayMs)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }, [journal, startOfTodayMs]);

  // Tasks checked off today, across every lane — feeds the "Done today" rail
  // card. Keyed off doneSet (live: updates the instant a checkbox flips) rather
  // than the server's done_at, which only lands on the local task after a
  // refresh. The done_at clause drops tasks completed on earlier days while
  // still counting a just-toggled one (whose local done_at is null → today).
  // doneSet.has() gates it, so an accidental check + undo nets back to zero.
  const doneToday = useMemo(() =>
    tasks.filter(t =>
      doneSet.has(t.id) &&
      (!t.doneAt || new Date(t.doneAt).getTime() >= startOfTodayMs)
    ).length,
    [tasks, doneSet, startOfTodayMs]);

  const refreshJournal = useCallback(async (dateArg) => {
    // Read current selection at call time so callers don't have to pass it explicitly.
    const date = dateArg !== undefined ? dateArg : journalSelectedDate;
    const url = date ? `/api/journal?date=${encodeURIComponent(date)}` : "/api/journal";
    try {
      const data = await fetch(url).then(r => r.json());
      setJournal(data.entries || []);
      setJournalStreak(data.streak || 0);
      if (Array.isArray(data.days)) setJournalDays(data.days);
      window.JOURNAL = data.entries || [];
      window.JOURNAL_STREAK = data.streak || 0;
      window.JOURNAL_DAYS = data.days || [];
    } catch (err) {
      console.warn("refreshJournal failed:", err);
    }
  }, [journalSelectedDate]);

  // Re-fetch entries whenever the rail calendar selection changes.
  useEffect(() => { refreshJournal(journalSelectedDate); }, [journalSelectedDate]);

  const addJournalEntry = useCallback(async ({ mood, note }) => {
    let ok = false;
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood, note }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      const body = await res.json();
      // Optimistic: prepend the new entry locally, then refresh for canonical state.
      if (body.entry) {
        setJournal(prev => [body.entry, ...prev]);
        if (typeof body.streak === "number") setJournalStreak(body.streak);
      }
      ok = true;
    } catch (err) {
      console.warn("addJournalEntry failed:", err);
      setToast({ kind: "warn", text: `Couldn't save the moment${err.message ? ` (${err.message})` : ""}.` });
    } finally {
      refreshJournal();
    }
    return ok;
  }, [refreshJournal]);

  // Cancel any in-flight refresh when a new one fires so a slow earlier response
  // can't overwrite fresher state. Rapid nav switches were the easy way to hit it.
  const refreshAbortRef = useRef(null);
  const refreshTasks = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const ctrl = new AbortController();
    refreshAbortRef.current = ctrl;
    try {
      const [taskList, inboxList] = await Promise.all([
        fetch("/api/tasks", { signal: ctrl.signal }).then(r => r.json()),
        fetch("/api/inbox", { signal: ctrl.signal }).then(r => r.json()),
      ]);
      if (ctrl.signal.aborted) return;
      const merged = [...taskList, ...inboxList];
      setTasks(merged);
      window.TASKS = merged; // keep the global in sync for legacy free-variable consumers
      // Fold any server-confirmed completions into doneSet. Completions can now
      // arrive from sync (e.g. a task marked done in ClickUp), not just local
      // toggles — without this, a synced done task would come back with done_at
      // set but render as open because the UI keys off doneSet, not done_at.
      // Union only (never remove): preserves optimistic local toggles, and a
      // genuine local un-done already cleared done_at server-side so it won't
      // be re-added.
      setDoneSet(prev => {
        let changed = false;
        const next = new Set(prev);
        for (const t of taskList) {
          if (t.doneAt && !next.has(t.id)) { next.add(t.id); changed = true; }
        }
        return changed ? next : prev;
      });
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.warn("refreshTasks failed:", err);
    }
  }, []);

  // Re-pull when navigating into Today — covers background sync ticks and
  // sync-now actions taken on the settings page.
  useEffect(() => {
    if (activeView === "today") refreshTasks();
  }, [activeView, refreshTasks]);

  // Toast auto-dismiss after 4 seconds.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Visual theme — defaults to Paper, persisted on the device.
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem("lighthouse:theme") || "paper"; }
    catch { return "paper"; }
  });
  const setTheme = useCallback((name) => {
    if (!window.THEMES?.[name]) return;
    setThemeState(name);
    try { localStorage.setItem("lighthouse:theme", name); } catch {}
  }, []);
  // Apply tweaks to :root
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--halftone-opacity", String((t.halftone || 55) / 100));
    root.style.setProperty("--accent", t.accent || "#b8442e");
    const warmthMap = {
      cream: { bg: "#f3efe6", paper: "#fbf8f1", paper2: "#f7f3ea", ink: "#1a1714" },
      bone:  { bg: "#efece4", paper: "#f7f4eb", paper2: "#f1ede2", ink: "#1c1a16" },
      slate: { bg: "#edeeec", paper: "#f6f7f4", paper2: "#eef0ec", ink: "#171a18" },
      ink:   { bg: "#1a1714", paper: "#231f1a", paper2: "#1f1c18", ink: "#f4ecdb" },
    };
    const w = warmthMap[t.warmth] || warmthMap.cream;
    root.style.setProperty("--bg", w.bg);
    root.style.setProperty("--paper", w.paper);
    root.style.setProperty("--paper-2", w.paper2);
    root.style.setProperty("--ink", w.ink);
    if (t.warmth === "ink") {
      root.style.setProperty("--ink-2", "#d7cdb8");
      root.style.setProperty("--muted", "#8a8278");
      root.style.setProperty("--muted-2", "#5b554c");
      root.style.setProperty("--rule", "#2c2823");
      root.style.setProperty("--rule-2", "#262219");
    } else {
      root.style.setProperty("--ink-2", "#3b3631");
      root.style.setProperty("--muted", "#8a8278");
      root.style.setProperty("--muted-2", "#b8afa1");
      root.style.setProperty("--rule", "#e3dccd");
      root.style.setProperty("--rule-2", "#ece6d6");
    }
    document.body.style.fontSize = t.density === "compact" ? "12.5px" : "13.5px";
  }, [t]);

  // Theme overlay — runs AFTER the tweaks useEffect so it gets the final word.
  // Depends on `t` too so any tweak-driven write is immediately re-overlaid
  // (tweaks panel only opens inside the Claude Design editor; in production
  // it's invisible but its useEffect still writes defaults on mount).
  useEffect(() => {
    const theming = window.THEMES?.[theme] || window.THEMES?.paper;
    if (!theming) return;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theming.vars)) {
      root.style.setProperty(key, value);
    }
    root.setAttribute("data-theme", theme);
  }, [theme, t]);

  const toggleDone = (id) => {
    const willBeDone = !doneSet.has(id);
    setDoneSet(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    // Return the fetch promise so callers that need to refresh *after* the
    // server has committed (FocusCard Done → auto-advance, modal Mark done →
    // refresh new Now task) can await it. Fire-and-forget callers ignore.
    return fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: willBeDone }),
    }).catch(err => console.warn("toggleDone failed:", err));
  };

  // Pin/unpin a task. Same error-toast + refresh pattern as patchLane.
  const togglePin = useCallback(async (id, pinned) => {
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setToast({
          kind: "warn",
          text: body.message || `Couldn't ${pinned ? "pin" : "unpin"} (${r.status}).`,
        });
        return false;
      }
      return true;
    } catch (err) {
      console.warn("togglePin failed:", err);
      return false;
    } finally {
      await refreshTasks();
    }
  }, [refreshTasks]);

  // Generic lane mutation — used by Start Now, Step away, modal lane picker,
  // and recommendation pull. Centralizes error toast + refresh so individual
  // call sites stay one-liners.
  //
  // Special-case: when target is "today" and the cap is full, fall back to
  // this_week (unpinned). The task still moves closer to action, and if
  // it's heavy enough it'll surface in Up next on weight merit. Pin is
  // reserved for explicit 📌 clicks — auto-pinning a failed promotion
  // collapses two distinct user intents into the same state, which makes
  // the pin cap eat impulse clicks the user didn't mean as deliberate
  // queue picks. Suggest's accept flow handles its own cap-handoff via
  // DemoteModal, so it doesn't go through here.
  const patchLane = useCallback(async (id, lane, extra = {}) => {
    try {
      const r = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane, ...extra }),
      });
      if (r.ok) return true;

      const body = await r.json().catch(() => ({}));

      if (r.status === 409 && lane === "today" && body.error === "today_full") {
        // Soft fallback: move to this_week without pin. No silent pin =
        // pin stays a deliberate-only signal.
        const r2 = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane: "this_week" }),
        });
        if (r2.ok) {
          setToast({ kind: "warn", text: "Today is full — moved to This week." });
          return true;
        }
      }

      setToast({ kind: "warn", text: body.message || `Couldn't change lane (${r.status}).` });
      return false;
    } catch (err) {
      console.warn("patchLane failed:", err);
      return false;
    } finally {
      await refreshTasks();
    }
  }, [refreshTasks]);

  const triageInbox = async (id, where) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triaged_to: where }),
      });
      if (res.ok) {
        // Backend falls back to this_week + pinned=1 when triage="today" and
        // Today is at cap — the task is parked at the top of Up next instead
        // of failing. Surface that to the user so the "→ Today" click doesn't
        // look like it silently went somewhere else.
        const body = await res.json().catch(() => ({}));
        if (body.fellBackToUpNext) {
          setToast({ kind: "warn", text: "Today is full — pinned to Up next." });
        }
      }
    } catch (err) {
      console.warn("triageInbox failed:", err);
    } finally {
      refreshTasks();
    }
  };

  // "Mark done" on a brain-dump item. An inbox row has no done state of its
  // own — it isn't in the tasks table — so we promote it to a real task (via
  // the normal triage path, which lands it in This week) and immediately mark
  // that task done. This routes the completion through the standard done path
  // (completions log, source write-back, hide-completed, mark-undone) instead
  // of duplicating any of it. The intermediate open task is never rendered:
  // we don't refresh until both calls resolve.
  const completeInboxItem = async (id) => {
    setTasks(prev => prev.filter(t => t.id !== id)); // optimistic: clear from brain dump
    try {
      const r = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triaged_to: "later" }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.createdTaskId) {
        await toggleDone(body.createdTaskId);
      } else if (!r.ok) {
        setToast({ kind: "warn", text: body.message || `Couldn't mark done (${r.status}).` });
      }
    } catch (err) {
      console.warn("completeInboxItem failed:", err);
    } finally {
      await refreshTasks();
    }
  };

  // "Pin for next" on a brain-dump item. Like completeInboxItem, an inbox row
  // isn't a real task yet, so we triage it into This week (the up-next queue's
  // home lane), then pin the freshly-created task through the normal task-pin
  // path — which enforces the 5-pin cap and toasts on overflow. If the pin
  // fails the task still lives in This week; nothing is lost.
  const pinInbox = async (id) => {
    setTasks(prev => prev.filter(t => t.id !== id)); // optimistic: leave the inbox
    try {
      const r = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triaged_to: "this_week" }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok && body.createdTaskId) {
        await togglePin(body.createdTaskId, true); // togglePin refreshes + cap-toasts
      } else {
        if (!r.ok) setToast({ kind: "warn", text: body.message || `Couldn't pin (${r.status}).` });
        await refreshTasks();
      }
    } catch (err) {
      console.warn("pinInbox failed:", err);
      await refreshTasks();
    }
  };

  /**
   * User picked a today task to demote so the pending add can take its place.
   *   PATCH chosen → ondeck → refresh → re-fire the original action → close modal.
   * On any failure, surface a toast and leave the modal open so the user can retry.
   */
  const handleDemote = async (taskIdToDemote) => {
    if (!capModal) return;
    setCapBusy(true);
    try {
      const demoteRes = await fetch(`/api/tasks/${encodeURIComponent(taskIdToDemote)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lane: "this_week" }),
      });
      if (!demoteRes.ok) throw new Error(`demote ${demoteRes.status}`);

      // Bring local state in line so the retry sees the freed slot.
      await refreshTasks();

      const retryRes = await capModal.retry();
      if (!retryRes.ok) {
        const body = await retryRes.json().catch(() => ({}));
        throw new Error(body.message || `retry ${retryRes.status}`);
      }

      const callback = capModal.onResolve;
      setCapModal(null);
      setToast({ kind: "ok", text: "Swapped." });
      callback?.(true);
    } catch (err) {
      setToast({ kind: "warn", text: `Couldn't swap: ${String(err.message || err)}` });
      capModal.onResolve?.(false);
    } finally {
      setCapBusy(false);
      refreshTasks();
    }
  };

  // Lane taxonomy is the explicit time-horizon ladder:
  //   now → today → this_week → this_month → backlog
  // `now` is singleton (current focus block), `today` is hard-capped at 3,
  // `this_week` is the planning set for the next 7 days, `this_month` is the
  // 1–4 week pool, `backlog` is the uncommitted holding pen. A background
  // decay job demotes stale items down the ladder so nothing rots in place.
  const tasksByLane = useMemo(() => {
    const f = (lane) => tasks.filter(x => x.lane === lane);
    return {
      now:        f("now")[0],
      today:      f("today"),
      this_week:  f("this_week"),
      this_month: f("this_month"),
      backlog:    f("backlog"),
    };
  }, [tasks]);

  const counts = {
    now:        tasksByLane.now && !doneSet.has(tasksByLane.now.id) ? 1 : 0,
    today:      tasksByLane.today.filter(t => !doneSet.has(t.id)).length,
    this_week:  tasksByLane.this_week.filter(t => !doneSet.has(t.id)).length,
    this_month: tasksByLane.this_month.filter(t => !doneSet.has(t.id)).length,
    backlog:    tasksByLane.backlog.filter(t => !doneSet.has(t.id)).length,
    inbox:      inbox.length,
    meetings:   CALENDAR.events.length,
  };

  // Hide-completed toggle on the Tasks page. Persisted to localStorage so it
  // survives reloads. Default is hide — Tasks is a planning surface, and
  // recently-done rows just add noise to the lane lists.
  const [tasksHideCompleted, setTasksHideCompleted] = useState(() => {
    const saved = localStorage.getItem("lighthouse.tasksHideCompleted");
    return saved === null ? true : saved === "true";
  });
  useEffect(() => {
    localStorage.setItem("lighthouse.tasksHideCompleted", String(tasksHideCompleted));
  }, [tasksHideCompleted]);
  // View mode on the Tasks page: "byGoal" (default) groups all tasks by
  // their primary_goal_id; "byLane" shows the lane-based view (This week
  // / This month / Backlog). Persisted to localStorage.
  const [tasksView, setTasksView] = useState(() => {
    return localStorage.getItem("lighthouse.tasksView") || "byGoal";
  });
  useEffect(() => {
    localStorage.setItem("lighthouse.tasksView", tasksView);
  }, [tasksView]);
  const stripDone = useCallback(
    (arr) => tasksHideCompleted ? arr.filter(t => !doneSet.has(t.id)) : arr,
    [tasksHideCompleted, doneSet],
  );

  const addInboxItem = async (title) => {
    if (typeof title !== "string" || !title.trim()) return;
    try {
      await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch (err) {
      console.warn("addInboxItem failed:", err);
    } finally {
      refreshTasks();
    }
  };

  return (
    <div className={`app ${focusMode ? "focus-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${railCollapsed ? "rail-collapsed" : ""}`} data-screen-label={
      activeView === "calendar" ? "Calendar" :
      activeView === "tasks"    ? "Tasks" :
      activeView === "goals"    ? "Goals" :
      activeView === "journal"  ? "Journal" :
      activeView === "settings" ? "Settings" :
                                  "Today"
    }>
      <Sidebar
        activeView={activeView}
        setView={setActiveView}
        counts={counts}
        profile={profile}
        journalTodayEntries={journalTodayEntries}
        journalStreak={journalStreak}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
      />
      {/* No floating expand tab for the left — the sidebar stays visible
          as an icon-only column when "collapsed", and its built-in
          panel-collapse-btn toggles it back to full width. */}
      {railCollapsed && (
        <button
          className="panel-expand-tab panel-expand-right"
          title="Expand right rail"
          onClick={() => setRailCollapsed(false)}>
          ‹
        </button>
      )}

      {activeView === "calendar" ? (
        <CalendarPage
          focusTask={tasksByLane.now}
          onSchedule={() => setScheduled(s => !s)}
          scheduled={scheduled}
        />
      ) : activeView === "tasks" ? (
        <TasksPage
          inbox={inbox}
          triage={triageInbox}
          onCompleteInbox={completeInboxItem}
          addInboxItem={addInboxItem}
          weekSlot={
            <OnDeck
              tasks={stripDone(tasksByLane.this_week)}
              toggleDone={toggleDone}
              doneSet={doneSet}
              goals={goals}
              onOpenDetail={openDetail}
              onTogglePin={togglePin}
              onChangeLane={patchLane}
              onReenrich={async () => {
                await fetch("/api/tasks/reenrich", { method: "POST" });
                await refreshTasks();
              }}
            />
          }
          thisMonthTasks={stripDone(tasksByLane.this_month)}
          backlogTasks={stripDone(tasksByLane.backlog)}
          allTasks={tasksHideCompleted ? tasks.filter(t => !doneSet.has(t.id)) : tasks}
          goals={goals}
          toggleDone={toggleDone}
          doneSet={doneSet}
          onOpenDetail={openDetail}
          onChangeLane={patchLane}
          hideCompleted={tasksHideCompleted}
          onToggleHideCompleted={() => setTasksHideCompleted(v => !v)}
          view={tasksView}
          onSetView={setTasksView}
        />
      ) : activeView === "goals" ? (
        <GoalsPage
          onSuggest={() => setSuggestOpen(true)}
          goals={goals}
          tasks={tasks}
          doneSet={doneSet}
          toggleDone={toggleDone}
          onOpenDetail={openDetail}
          onGoalsChange={async () => {
            // Refresh BOTH — TaskBreakdownModal can create new tasks and
            // link existing ones, both of which the Goals page's expander
            // reads from the tasks prop. Refreshing only goals would leave
            // the expander showing stale data until something else (e.g.
            // navigating back to Today) triggers a tasks refresh.
            await Promise.all([refreshGoals(), refreshTasks()]);
          }}
        />
      ) : activeView === "journal" ? (
        <JournalPage
          entries={journal}
          streak={journalStreak}
          startOfTodayMs={startOfTodayMs}
          onAddEntry={addJournalEntry}
          onEditEntry={async (id, patch) => {
            try {
              const r = await fetch(`/api/journal/${encodeURIComponent(id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                setToast({ kind: "warn", text: body.error || `Couldn't save (${r.status}).` });
                return false;
              }
              const body = await r.json();
              setJournal(prev => prev.map(e => e.id === id ? (body.entry || { ...e, ...patch }) : e));
              return true;
            } catch (err) {
              setToast({ kind: "warn", text: `Edit failed: ${err.message || err}` });
              return false;
            } finally {
              refreshJournal();
            }
          }}
          onDeleteEntry={async (id) => {
            setJournal(prev => prev.filter(e => e.id !== id));
            try {
              const r = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" });
              if (!r.ok) {
                setToast({ kind: "warn", text: `Couldn't delete (${r.status}).` });
              }
            } finally {
              refreshJournal();
            }
          }}
          selectedDate={journalSelectedDate}
          onSelectDate={setJournalSelectedDate}
        />
      ) : activeView === "settings" ? (
        <SettingsPage
          profile={profile}
          onProfileChange={setProfile}
          onTasksMutated={refreshTasks}
          theme={theme}
          onThemeChange={setTheme}
        />
      ) : (
        <main className="main">
          <TopBar onSuggest={() => setSuggestOpen(true)} profile={profile} />
          <FocusCard
            task={tasksByLane.now}
            focusMode={focusMode}
            setFocusMode={setFocusMode}
            onOpenDetail={openDetail}
            onStepAway={(id) => patchLane(id, "today")}
            onMarkDone={async (id) => {
              // Await the PATCH so the auto-advance commit is visible to
              // refreshTasks — otherwise the GET can race ahead of the PATCH
              // and see the pre-promotion state, leaving the FocusCard stale.
              await toggleDone(id);
              await refreshTasks();
            }}
          />
          <TodayList
            tasks={tasksByLane.today}
            toggleDone={toggleDone}
            doneSet={doneSet}
            weekTasks={tasksByLane.this_week.filter(t => !doneSet.has(t.id))}
            onOpenDetail={openDetail}
            nowTaskId={tasksByLane.now?.id}
            onStartNow={(id) => patchLane(id, "now")}
            onPromote={(id) => patchLane(id, "today")}
            onDefer={(id) => patchLane(id, "this_month")}
            onReorder={async (id, index) => {
              // Optimistic local reorder so the row jumps immediately; the
              // PATCH call writes through to the server and refreshTasks()
              // pulls the canonical order back.
              setTasks(prev => {
                const todays = prev.filter(t => t.lane === "today");
                const others = prev.filter(t => t.lane !== "today");
                const without = todays.filter(t => t.id !== id);
                const moving  = todays.find(t => t.id === id);
                if (!moving) return prev;
                const target  = Math.max(0, Math.min(index, without.length));
                without.splice(target, 0, moving);
                return [...others, ...without.map((t, i) => ({ ...t, position: i + 1 }))];
              });
              await patchLane(id, "today", { index });
            }}
          />
        </main>
      )}

      <aside className="rail">
        <button
          className="panel-collapse-btn panel-collapse-right"
          title="Collapse right rail"
          onClick={() => setRailCollapsed(true)}>
          ›
        </button>
        {activeView === "journal" ? (
          <JournalDateRail
            days={journalDays}
            selectedDate={journalSelectedDate}
            onSelectDate={setJournalSelectedDate}
            startOfTodayMs={startOfTodayMs}
          />
        ) : (
          <>
            <DoneTodayCard count={doneToday} />
            <CalendarCard
              focusTask={tasksByLane.now}
              onSchedule={() => setScheduled(s => !s)}
              scheduled={scheduled}
              onOpen={() => setActiveView("calendar")}
            />
            <WeekGlance />
            {t.showInbox && (
              <InboxCard
                items={inbox}
                triage={triageInbox}
                onComplete={completeInboxItem}
                onOpenDetail={openDetail}
                onOpen={() => setActiveView("tasks")}
              />
            )}
          </>
        )}
      </aside>

      <SuggestionModal
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        onAcceptAll={() => setSuggestOpen(false)}
        onAccept={async (suggestion) => {
          // Suggest agent returns either:
          //   - a concrete existing task → promote it to Today
          //   - just a goal + reason     → create a new task and route to Today
          // On 409 (Today full), open the DemoteModal so the user picks which
          // Today task to bump — same pattern as inbox triage. Returns a
          // promise that resolves with the eventual outcome so the button's
          // per-row state machine reflects success/cancel correctly.
          try {
            if (suggestion.task?.id) {
              const taskId = suggestion.task.id;
              const doPatch = () => fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lane: "today" }),
              });
              const r = await doPatch();
              if (r.status === 409) {
                // Hand off to DemoteModal; await its resolution before
                // reporting back to the Suggest button.
                return await new Promise((resolve) => {
                  setCapModal({
                    newItemTitle: suggestion.task.title,
                    retry: doPatch,
                    onResolve: (ok) => resolve({ ok }),
                  });
                });
              }
              if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                setToast({ kind: "warn", text: body.message || `Couldn't add (${r.status}).` });
                return { ok: false };
              }
              await refreshTasks();
              return { ok: true };
            }
            // No existing task — create one via the milestone-commit endpoint
            // (pre-populates primary_goal_id). Lands in this_week by default.
            const goalId = suggestion.goal?.id;
            const title = suggestion.task?.title || suggestion.goal?.nextStep || suggestion.goal?.title;
            if (!goalId || !title) {
              setToast({ kind: "warn", text: "Suggestion missing goal/title — can't add." });
              return { ok: false };
            }
            const r = await fetch(`/api/goals/monthly/${encodeURIComponent(goalId)}/commit-tasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                tasks: [{
                  title,
                  note: suggestion.reason || "",
                  estimateMin: 25,
                  tag: "shallow",
                  due: null,
                  reasoning: suggestion.reason || "",
                }],
              }),
            });
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              setToast({ kind: "warn", text: body.detail || body.error || `Couldn't add (${r.status}).` });
              return { ok: false };
            }
            // The created task lands in this_week. Promote to Today; if the
            // cap is full now, hand off to DemoteModal same as above.
            const created = await r.json();
            const newId = (created.created || [])[0];
            if (newId) {
              const doPromote = () => fetch(`/api/tasks/${encodeURIComponent(newId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lane: "today" }),
              });
              const p = await doPromote();
              if (p.status === 409) {
                return await new Promise((resolve) => {
                  setCapModal({
                    newItemTitle: title,
                    retry: doPromote,
                    onResolve: (ok) => resolve({ ok }),
                  });
                });
              }
            }
            await refreshTasks();
            return { ok: true };
          } catch (err) {
            setToast({ kind: "warn", text: String(err.message || err) });
            return { ok: false };
          }
        }}
      />

      {toast && (
        <div className={`top-toast top-toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}

      <DemoteModal
        open={!!capModal}
        newItemTitle={capModal?.newItemTitle ?? ""}
        todayTasks={tasksByLane.today.filter(t => !doneSet.has(t.id))}
        onPick={handleDemote}
        onCancel={() => {
          if (capBusy) return;
          const callback = capModal?.onResolve;
          setCapModal(null);
          callback?.(false);
        }}
        busy={capBusy}
      />

      <TaskDetailModal
        open={!!detailTaskId}
        task={detailTask}
        goals={goals}
        onClose={() => setDetailTaskId(null)}
        onTogglePin={togglePin}
        onToggleDone={async (id) => {
          // Close immediately for snappy UX; PATCH + refresh run in the
          // background so the auto-advance (if the task was the now-task)
          // surfaces in the FocusCard.
          setDetailTaskId(null);
          await toggleDone(id);
          await refreshTasks();
        }}
        onChangeLane={async (id, lane) => {
          try {
            const r = await fetch(`/api/tasks/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lane }),
            });
            if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              setToast({ kind: "warn", text: body.message || `Couldn't change lane (${r.status}).` });
            }
          } finally {
            await refreshTasks();
          }
        }}
        onTriageInbox={(id, where) => {
          // Triage from the detail modal: close, then route through the same
          // cap-aware handler the brain-dump rows use.
          setDetailTaskId(null);
          triageInbox(id, where);
        }}
        onCompleteInbox={(id) => {
          setDetailTaskId(null);
          completeInboxItem(id);
        }}
        onPinInbox={(id) => {
          setDetailTaskId(null);
          pinInbox(id);
        }}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Surface">
          <TweakRadio
            label="Paper"
            value={t.warmth}
            onChange={v => setTweak("warmth", v)}
            options={[
              { value: "cream", label: "Cream" },
              { value: "bone",  label: "Bone"  },
              { value: "slate", label: "Slate" },
              { value: "ink",   label: "Ink"   },
            ]}
          />
          <TweakSlider
            label="Halftone"
            value={t.halftone}
            onChange={v => setTweak("halftone", v)}
            min={0} max={100} step={5} unit="%"
          />
          <TweakColor
            label="Accent"
            value={t.accent}
            onChange={v => setTweak("accent", v)}
            options={["#b8442e", "#8a7530", "#4e6a55", "#5e6ad2", "#b86b8e", "#1a1714"]}
          />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={t.density}
            onChange={v => setTweak("density", v)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact",     label: "Compact"     },
            ]}
          />
          <TweakToggle
            label="Show inbox in rail"
            value={t.showInbox}
            onChange={v => setTweak("showInbox", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// Wait for the backend fetches in data.jsx to populate window.TASKS / CALENDAR / GOALS / etc.
window.__dataReady
  .then(() => {
    ReactDOM.createRoot(document.getElementById("root")).render(<App />);
  })
  .catch((err) => {
    document.getElementById("root").innerHTML =
      `<div style="font:14px system-ui;padding:40px;color:#8a3322">` +
      `<b>Couldn't reach the Lighthouse backend.</b><br/>` +
      `Run <code>npm start</code> in <code>/Users/rogeryin/claude/adhd/backend</code>.<br/>` +
      `<small>${String(err)}</small>` +
      `</div>`;
  });
