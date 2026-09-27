import rateLimit from "express-rate-limit";
import type { Request } from "express";

const API_KEY_HEADER = "x-indexer-api-key";

/**
 * Per-IP rate limiting by default, per-API-key instead when the caller supplied
 * one — so multiple restricted-mode consumers behind the same NAT/proxy don't
 * share one global bucket. Same abuse-prevention discipline already proven in
 * the faucet's per-address+per-IP cooldown. `requestsPerMinute` is the only
 * knob, per CLAUDE.md's INDEXER_RATE_LIMIT_PER_MINUTE env var.
 */
export function createRateLimitMiddleware(requestsPerMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: requestsPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.header(API_KEY_HEADER) ?? req.ip ?? "unknown",
    message: { error: "Too many requests — rate limit exceeded" },
  });
}
