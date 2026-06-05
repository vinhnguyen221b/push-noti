import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging as getAdminMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from './env';
import { logger } from '../utils/logger';
import { AppError, ErrorCode } from '../utils/errors';

/**
 * Firebase Admin SDK singleton.
 *
 * The SDK is initialised EXACTLY ONCE (guarded by both a module-level cache and
 * `getApps().length`, so re-imports / test re-evaluation never double-init).
 * Credentials are always passed explicitly via `cert(...)` — we never rely on
 * the SDK's implicit GOOGLE_APPLICATION_CREDENTIALS lookup, so dev and prod
 * behave identically.
 */

let appInstance: App | undefined;
let messagingInstance: Messaging | undefined;

export function isFirebaseConfigured(): boolean {
  return env.firebaseCredential !== null;
}

export function getFirebaseApp(): App {
  if (appInstance) return appInstance;

  const credential = env.firebaseCredential;
  if (!credential) {
    throw new AppError(
      ErrorCode.FIREBASE_NOT_CONFIGURED,
      'Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or ' +
        'FIREBASE_SERVICE_ACCOUNT_BASE64 to a valid service account credential.',
    );
  }

  // Reuse an already-initialised app if one exists (idempotent across imports).
  const existing = getApps()[0];
  if (existing) {
    appInstance = existing;
    return existing;
  }

  appInstance = initializeApp({
    credential: cert({
      projectId: credential.projectId,
      clientEmail: credential.clientEmail,
      privateKey: credential.privateKey,
    }),
  });
  logger.info({ firebaseProjectId: credential.projectId }, 'Firebase Admin SDK initialised');
  return appInstance;
}

/** Lazily-initialised, cached FCM messaging client. */
export function getMessaging(): Messaging {
  if (messagingInstance) return messagingInstance;
  messagingInstance = getAdminMessaging(getFirebaseApp());
  return messagingInstance;
}
