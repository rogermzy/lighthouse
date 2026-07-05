import { google, calendar_v3 } from "googleapis";
import type { Connector, CalendarEventWire } from "./types.js";
import { googleOAuthClient, isGoogleOAuthConfigured, hasGoogleTokens } from "../auth/oauth.js";
import { replaceTodayCalendarEvents } from "../sync/reconcile.js";

const MEETING_COLOR = "#5e6ad2";
const EXTERNAL_COLOR = "#b8442e";
const PERSONAL_COLOR = "#b86b8e";

const CAL_DAYS = 4; // Today + 3 ahead — covers the visible 4-day grid.

function calendarWindow(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + CAL_DAYS); // exclusive upper bound
  return { start, end };
}

function isoToMinutesPastMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function isoToLocalDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function kindOf(ev: { organizer?: { self?: boolean | null } | null; attendees?: unknown }): CalendarEventWire["kind"] {
  // Heuristic: if the event has attendees and you're not the organizer, treat as external.
  // Anything else with attendees is a meeting; otherwise personal.
  if (Array.isArray(ev.attendees) && ev.attendees.length > 0) {
    if (ev.organizer && ev.organizer.self === false) return "external";
    return "meeting";
  }
  return "personal";
}

function colorFor(kind: CalendarEventWire["kind"]): string {
  if (kind === "external") return EXTERNAL_COLOR;
  if (kind === "personal") return PERSONAL_COLOR;
  return MEETING_COLOR;
}

export const gcalConnector: Connector = {
  name: "gcal",
  intervalMs: 5 * 60 * 1000,

  async isEnabled() {
    return isGoogleOAuthConfigured() && hasGoogleTokens();
  },

  async sync() {
    const auth = googleOAuthClient();
    const cal = google.calendar({ version: "v3", auth });
    const { start, end } = calendarWindow();

    // events.list caps at 250/page — page through the window so a busy 4-day
    // stretch doesn't silently drop events past the first page.
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const res = await cal.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      for (const e of res.data.items ?? []) items.push(e);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    const events: CalendarEventWire[] = items
      .filter((e) => e.start?.dateTime && e.end?.dateTime) // skip all-day events for now
      .map((e) => {
        const kind = kindOf(e);
        const startIso = e.start!.dateTime!;
        const endIso = e.end!.dateTime!;
        // An event whose end is on a later local date crosses midnight; its
        // naive minutes-past-midnight would be < startMin and render inverted.
        // Clamp to end-of-day so it fills to the bottom of its day column.
        const crossesMidnight = isoToLocalDateStr(endIso) > isoToLocalDateStr(startIso);
        return {
          externalId: e.id ?? `${startIso}-${e.summary ?? "untitled"}`,
          date: isoToLocalDateStr(startIso),
          title: e.summary ?? "(no title)",
          startMin: isoToMinutesPastMidnight(startIso),
          endMin: crossesMidnight ? 24 * 60 : isoToMinutesPastMidnight(endIso),
          kind,
          color: colorFor(kind),
        };
      });

    replaceTodayCalendarEvents(events);
  },
};
