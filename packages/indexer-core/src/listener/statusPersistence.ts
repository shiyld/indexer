import type { Pool as PgPool } from "pg";
import type { MultiNetworkListener } from "./multiNetworkListener";
import { saveNetworkStatus } from "./networkStatusStore";

/**
 * Periodically persists a MultiNetworkListener's in-memory statuses to
 * network_status, for the split server/worker deployment mode — called by the
 * worker entrypoint only; the combined single-process mode never needs this
 * (its REST layer reads the listener's status directly, same process). Returns
 * a stop function, matching every other stoppable loop in this package.
 */
export function startStatusPersistence(db: PgPool, listener: MultiNetworkListener, intervalMs = 10_000): () => void {
  const timer = setInterval(() => {
    for (const status of listener.getStatuses()) {
      saveNetworkStatus(db, status).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[statusPersistence] failed to save network status:", err);
      });
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
