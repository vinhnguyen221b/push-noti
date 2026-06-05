/**
 * Typed application errors.
 *
 * Error codes are a closed union (no "magic strings"); every code maps to a
 * default HTTP status. The central error handler turns an {@link AppError}
 * into the canonical response shape:
 *
 *   { "error": { "code": "...", "message": "...", "details": [...] } }
 */

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  FCM_ERROR: 'FCM_ERROR',
  FIREBASE_NOT_CONFIGURED: 'FIREBASE_NOT_CONFIGURED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** A single, caller-safe detail entry (e.g. one Zod validation issue). */
export interface ErrorDetail {
  path?: string;
  message: string;
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.FCM_ERROR]: 502,
  [ErrorCode.FIREBASE_NOT_CONFIGURED]: 503,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.INTERNAL_ERROR]: 500,
};

export interface AppErrorOptions {
  statusCode?: number;
  details?: ErrorDetail[];
  cause?: unknown;
}

/**
 * Operational error that is safe to surface to the caller. The `message` and
 * `details` are assumed sanitised at construction time.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.statusCode ?? DEFAULT_STATUS[code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    // Restore prototype chain (required when targeting ES2022 with `extends Error`).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
