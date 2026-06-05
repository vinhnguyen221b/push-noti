import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env';
import { ErrorCode } from '../utils/errors';

/**
 * Per-IP rate limiter for the API. Window and limit come from env. Emits the
 * canonical error shape on 429. Note: behind a reverse proxy, set TRUST_PROXY
 * (preferably to the number of proxy hops) so the real client IP is used.
 */
export function createRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: env.rateLimit.windowMs,
    limit: env.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'Too many requests. Please retry later.',
        },
      });
    },
  });
}
