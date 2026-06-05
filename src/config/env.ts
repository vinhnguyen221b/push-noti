// Load .env first so process.env is populated before validation.
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { logger } from '../utils/logger';

/**
 * Validated, typed application configuration.
 *
 * Startup credential policy ("fail-fast on broken, defer on absent"):
 *  - App config is validated strictly here; bad values throw at startup.
 *  - A Firebase credential that is PRESENT but invalid (unparseable JSON, or
 *    missing a required field) throws at startup.
 *  - A credential that is ABSENT (or a configured PATH whose file does not yet
 *    exist) is deferred: `firebaseCredential` is null, a warning is logged, and
 *    FCM initialisation happens lazily on first send (where it surfaces a clear
 *    "not configured" error). /health stays available without a credential.
 */

const PINO_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const trustProxySchema = z
  .string()
  .trim()
  .optional()
  .transform((raw): boolean | number => {
    const value = (raw ?? 'false').toLowerCase();
    if (value === 'true') return true;
    if (value === '' || value === 'false') return false;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : false;
  });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(PINO_LEVELS).default('info'),
  SERVER_API_KEY: z.string().min(1, 'SERVER_API_KEY is required'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().trim().optional(),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().trim().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  TRUST_PROXY: trustProxySchema,
  ENABLE_UI: z
    .string()
    .trim()
    .optional()
    .transform((raw) => {
      const value = (raw ?? 'true').toLowerCase();
      return value !== 'false' && value !== '0';
    }),
});

type ParsedEnv = z.infer<typeof EnvSchema>;

/** Minimal shape we require from a service account JSON. */
const ServiceAccountSchema = z
  .object({
    project_id: z.string().min(1),
    client_email: z.string().min(1),
    private_key: z.string().min(1),
  })
  .passthrough();

type ServiceAccountFields = z.infer<typeof ServiceAccountSchema>;

export interface FirebaseCredential {
  source: 'base64' | 'path';
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: ParsedEnv['NODE_ENV'];
  logLevel: ParsedEnv['LOG_LEVEL'];
  serverApiKey: string;
  rateLimit: { windowMs: number; max: number };
  trustProxy: boolean | number;
  /** Serve the browser admin UI at `/`. */
  enableUi: boolean;
  /** null when no credential is configured (deferred init). */
  firebaseCredential: FirebaseCredential | null;
}

function parseServiceAccount(jsonText: string, sourceLabel: string): ServiceAccountFields {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error(`Firebase service account from ${sourceLabel} is not valid JSON.`);
  }
  const result = ServiceAccountSchema.safeParse(raw);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Firebase service account from ${sourceLabel} is missing/invalid required field(s): ${missing}. ` +
        `A valid service account JSON must contain "project_id", "client_email" and "private_key".`,
    );
  }
  return result.data;
}

function resolveFirebaseCredential(parsed: ParsedEnv): FirebaseCredential | null {
  const base64 = parsed.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const filePath = parsed.FIREBASE_SERVICE_ACCOUNT_PATH;

  // (b) Base64 form takes precedence when both are set.
  if (base64 && base64.length > 0) {
    let jsonText: string;
    try {
      jsonText = Buffer.from(base64, 'base64').toString('utf8');
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 could not be base64-decoded.');
    }
    const sa = parseServiceAccount(jsonText, 'FIREBASE_SERVICE_ACCOUNT_BASE64');
    return {
      source: 'base64',
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    };
  }

  // (a) Path form.
  if (filePath && filePath.length > 0) {
    const abs = resolve(process.cwd(), filePath);
    if (!existsSync(abs)) {
      // Configured but the file isn't there yet -> treat as ABSENT (defer),
      // so the server still boots for /health. The warning below names the path.
      logger.warn(
        { path: abs },
        'FIREBASE_SERVICE_ACCOUNT_PATH is set but the file does not exist; deferring Firebase init.',
      );
      return null;
    }
    let jsonText: string;
    try {
      jsonText = readFileSync(abs, 'utf8');
    } catch (err) {
      throw new Error(
        `Could not read Firebase service account file at ${abs}: ${(err as Error).message}`,
      );
    }
    const sa = parseServiceAccount(jsonText, abs);
    return {
      source: 'path',
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    };
  }

  // Neither configured.
  return null;
}

function loadConfig(): AppConfig {
  const parsedResult = EnvSchema.safeParse(process.env);
  if (!parsedResult.success) {
    const issues = parsedResult.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    const message = `Invalid environment configuration:\n${issues}`;
    logger.fatal(message);
    throw new Error(message);
  }
  const parsed = parsedResult.data;

  // May throw on a present-but-broken credential (fail-fast).
  const firebaseCredential = resolveFirebaseCredential(parsed);

  if (firebaseCredential) {
    // Log only the project id and source — NEVER the full service account.
    logger.info(
      {
        firebaseProjectId: firebaseCredential.projectId,
        credentialSource: firebaseCredential.source,
      },
      'Firebase service account credential loaded',
    );
  } else {
    logger.warn(
      'No Firebase service account configured. /health is available, but FCM sends will fail ' +
        'with FIREBASE_NOT_CONFIGURED until FIREBASE_SERVICE_ACCOUNT_PATH or ' +
        'FIREBASE_SERVICE_ACCOUNT_BASE64 is provided.',
    );
  }

  return Object.freeze({
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    serverApiKey: parsed.SERVER_API_KEY,
    rateLimit: { windowMs: parsed.RATE_LIMIT_WINDOW_MS, max: parsed.RATE_LIMIT_MAX },
    trustProxy: parsed.TRUST_PROXY,
    enableUi: parsed.ENABLE_UI,
    firebaseCredential,
  });
}

export const env: AppConfig = loadConfig();
