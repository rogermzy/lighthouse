/**
 * Source-name → connector lookup. Used by the PATCH /api/tasks handler to
 * dispatch write-back (markDone / un-mark) without import-cycle gymnastics.
 *
 * Sources not in this map (gcal, gmail, self, agent, linear) are read-only or
 * non-task — the PATCH handler silently skips write-back for them.
 */
import type { Connector } from "./types.js";
import { clickupConnector } from "./clickup.js";
import { gtasksConnector } from "./gtasks.js";
import { notionConnector } from "./notion.js";
import { thingsConnector } from "./things.js";
import { workflowyConnector } from "./workflowy.js";

const REGISTRY: Record<string, Connector> = {
  clickup:   clickupConnector,
  gtasks:    gtasksConnector,
  notion:    notionConnector,
  things:    thingsConnector,
  workflowy: workflowyConnector,
};

export function connectorFor(source: string): Connector | undefined {
  return REGISTRY[source];
}
