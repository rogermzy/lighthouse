import type { Connector } from "../connectors/types.js";
import { recordSyncOk, recordSyncError } from "./reconcile.js";

async function runOnce(connector: Connector): Promise<void> {
  try {
    const enabled = await connector.isEnabled();
    if (!enabled) {
      // Quietly skip — the connector isn't configured. Common on first boot.
      return;
    }
    await connector.sync();
    recordSyncOk(connector.name);
    console.log(`[sync] ${connector.name}: ok`);
  } catch (err) {
    recordSyncError(connector.name, err);
    console.warn(`[sync] ${connector.name}: error — ${String(err)}`);
  }
}

/**
 * Starts a per-connector setTimeout chain. Each connector reschedules itself
 * after every run so a slow sync can't pile up overlapping ticks.
 */
export function startSync(connectors: Connector[]): void {
  for (const c of connectors) {
    const tick = async () => {
      await runOnce(c);
      setTimeout(tick, c.intervalMs);
    };
    // Kick off the first sync soon, not blocking server startup.
    setTimeout(tick, 500);
  }
}
