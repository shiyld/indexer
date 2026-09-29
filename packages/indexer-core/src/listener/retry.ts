/**
 * Bounded retry/backoff for a single poll cycle's RPC calls — the same pattern
 * already proven in `packages/wallet-core`'s scanner.ts and `apps/api`'s own
 * listener/retry.ts, against this project's real, repeated rate-limit history on
 * both Infura and the public Base Sepolia RPC. Ported here (not imported from
 * either) since indexer-core is the shared library both should eventually pull
 * this from — apps/api's own copy is expected to be retired once it embeds
 * indexer-core (see CLAUDE.md Phase 3 item #12).
 *
 * Only retries within one poll cycle (a handful of attempts, then gives up and
 * lets the next timer tick try again) — resilience comes from the caller's loop
 * never stopping, not from unbounded per-call retries.
 */
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Too Many Requests") ||
    message.includes("-32005") ||
    message.includes("-32016") ||
    message.includes("-32011") ||
    message.includes("-32007") ||
    message.includes("request limit reached") ||
    message.includes("over rate limit") ||
    message.includes("no backend is currently healthy") ||
    message.includes("429") ||
    // Found live 2026-09-12 verifying this exact module against the real Base
    // Sepolia public RPC: a transient 504 while scanning a real pool wasn't
    // retried at all, since it's a plain gateway timeout, not one of the
    // rate-limit-shaped errors above — same class of gap this project has hit
    // and fixed before (see CLAUDE.md's "-32011" addition to this exact check).
    // 502/503 included preemptively as the same category of transient backend
    // unavailability, not yet observed directly but equally not a real
    // application error worth giving up on immediately.
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("Gateway Timeout") ||
    message.includes("SERVER_ERROR") ||
    // Dropped connections, found live 2026-09-28 indexing Ethereum Sepolia via
    // publicnode: without these a pool failed its whole poll cycle on the first reset.
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("socket hang up") ||
    // Found live 2026-09-22 chasing indexer.shiyld.com's persistent "degraded" health
    // status: chainClient.ts's getBalance() (an eth_call-based read, e.g. ERC-20
    // balanceOf) surfaces a rate-limited public-RPC response as an ethers
    // CALL_EXCEPTION with top-level message "missing revert data (action=\"call\"...)"
    // — the real cause (`code: -32016, message: "over rate limit"`) sits nested at
    // `err.info.error`, invisible to every check above, so this shape got zero
    // retries and failed a pool's whole poll cycle outright on the very first hit.
    // packages/wallet-core/src/scanner.ts already found and fixed this identical
    // symptom on 2026-09-14 (see its own comment on this same line) but the fix was
    // never ported to this copy — same root cause, same fix, just late to arrive here.
    message.includes("missing revert data")
  );
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err) || attempt === RETRY_ATTEMPTS - 1) throw err;
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
