import { timingSafeEqual } from 'node:crypto';
import { type RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError, ErrorCode } from '../utils/errors';

const API_KEY_HEADER = 'x-api-key';

/** Constant-time comparison that won't throw on differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Requires a valid `x-api-key` header. The key value is never logged. Compares
 * in constant time to avoid leaking the key via timing.
 */
export const requireApiKey: RequestHandler = (req, _res, next) => {
  const provided = req.header(API_KEY_HEADER);
  if (!provided || !safeEqual(provided, env.serverApiKey)) {
    next(new AppError(ErrorCode.UNAUTHORIZED, 'Missing or invalid API key.'));
    return;
  }
  next();
};
