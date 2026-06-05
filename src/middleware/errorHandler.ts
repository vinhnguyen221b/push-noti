import { type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ErrorCode, isAppError, type ErrorDetail } from '../utils/errors';
import { requestLogger } from '../utils/logger';

/** Canonical error response body shape. */
interface ErrorResponseBody {
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
}

function buildBody(code: ErrorCode, message: string, details?: ErrorDetail[]): ErrorResponseBody {
  const body: ErrorResponseBody = { error: { code, message } };
  if (details && details.length > 0) {
    body.error.details = details;
  }
  return body;
}

/** Convert Zod issues into caller-safe error details. */
export function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    const detail: ErrorDetail = { message: issue.message };
    if (path) {
      detail.path = path;
    }
    return detail;
  });
}

function readStringProp(value: unknown, key: string): string | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const prop = (value as Record<string, unknown>)[key];
    return typeof prop === 'string' ? prop : undefined;
  }
  return undefined;
}

function readNumberProp(value: unknown, key: string): number | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const prop = (value as Record<string, unknown>)[key];
    return typeof prop === 'number' ? prop : undefined;
  }
  return undefined;
}

/**
 * Central error handler. Maps known error types to the canonical response and
 * logs at an appropriate level. Never leaks stack traces or internals to the
 * caller; unknown errors become a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const log = requestLogger(req);

  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      log.error({ err, code: err.code }, err.message);
    } else {
      log.warn({ code: err.code }, err.message);
    }
    res.status(err.statusCode).json(buildBody(err.code, err.message, err.details));
    return;
  }

  if (err instanceof ZodError) {
    const details = zodIssuesToDetails(err);
    log.warn({ code: ErrorCode.VALIDATION_ERROR }, 'Request validation failed');
    res
      .status(400)
      .json(buildBody(ErrorCode.VALIDATION_ERROR, 'Request validation failed', details));
    return;
  }

  // express.json() / body-parser failures (malformed JSON, payload too large, …).
  const bodyParserType = readStringProp(err, 'type');
  if (bodyParserType && bodyParserType.startsWith('entity.')) {
    const status = readNumberProp(err, 'status') ?? readNumberProp(err, 'statusCode') ?? 400;
    const message =
      bodyParserType === 'entity.too.large'
        ? 'Request body too large'
        : 'Malformed JSON request body';
    log.warn({ code: ErrorCode.VALIDATION_ERROR, bodyParserType }, message);
    res.status(status).json(buildBody(ErrorCode.VALIDATION_ERROR, message));
    return;
  }

  // Unknown / unexpected error — do not leak details.
  log.error({ err }, 'Unhandled error');
  res.status(500).json(buildBody(ErrorCode.INTERNAL_ERROR, 'Internal server error'));
};

/** 404 handler for unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(buildBody(ErrorCode.NOT_FOUND, 'Resource not found'));
};
