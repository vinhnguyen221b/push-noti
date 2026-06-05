import { type RequestHandler } from 'express';
import { type ZodTypeAny } from 'zod';
import { AppError, ErrorCode } from '../utils/errors';
import { zodIssuesToDetails } from './errorHandler';

/**
 * Builds a middleware that validates `req.body` against a Zod schema. On
 * success the parsed (and coerced) value replaces `req.body`; on failure a
 * 400 VALIDATION_ERROR is forwarded with per-issue details. Malformed requests
 * are rejected here and never reach the controller / FCM.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(ErrorCode.VALIDATION_ERROR, 'Request validation failed', {
          details: zodIssuesToDetails(result.error),
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
