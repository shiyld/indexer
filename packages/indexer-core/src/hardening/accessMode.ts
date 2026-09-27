import type { Request, Response, NextFunction } from "express";
import type { AccessControlConfig } from "./accessControl";

const API_KEY_HEADER = "x-indexer-api-key";

/**
 * REST-layer enforcement of AccessControlConfig. In "public" mode this is a
 * no-op — every request passes through untouched. In "restricted" mode, a valid
 * `x-indexer-api-key` header is required; missing or wrong key gets a 401, never
 * a silent pass-through.
 */
export function createAccessModeMiddleware(config: AccessControlConfig) {
  return function accessMode(req: Request, res: Response, next: NextFunction): void {
    if (config.mode === "public") return next();

    const key = req.header(API_KEY_HEADER);
    if (!key || !config.apiKeys.has(key)) {
      res.status(401).json({ error: `This indexer instance is in restricted mode — a valid ${API_KEY_HEADER} header is required` });
      return;
    }
    next();
  };
}
