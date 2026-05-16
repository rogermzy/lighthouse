/**
 * A connector pulls data from an external source into our SQLite store.
 * Each connector module exports an object implementing this interface.
 * The sync runner calls `sync()` on each tick.
 */
export interface Connector {
  name: string;
  intervalMs: number;
  /** Returns false if the connector is not configured (no creds/tokens) — runner will skip. */
  isEnabled(): Promise<boolean>;
  /** Pulls from the source and reconciles into the DB. Throws on failure. */
  sync(): Promise<void>;
  /**
   * Two-way sync: reflect a local done/undone change back to the source.
   * Optional — connectors that haven't implemented it (or sources without an
   * API for it) are skipped silently in the PATCH handler. Errors should
   * throw so the caller can log + surface in sync_state.
   */
  setDone?(externalId: string, done: boolean): Promise<void>;
}

export type CalendarEventWire = {
  externalId: string;
  /** Local YYYY-MM-DD the event occurs on. */
  date: string;
  title: string;
  startMin: number;
  endMin: number;
  kind: "meeting" | "external" | "personal";
  color: string;
};

export type InboxItemWire = {
  externalId: string;
  source: string;
  title: string;
};

export type UnifiedTask = {
  externalId: string;
  title: string;
  note?: string | null;
  project?: string | null;
  estimateMin?: number | null;
  due?: string | null;
  /** Direct link back to the task in its source system. Rendered as
   * "Open in {Source} ↗" in the task detail modal. Optional — sources
   * without a useful per-task URL (e.g. Google Tasks) leave it unset. */
  url?: string | null;
};
