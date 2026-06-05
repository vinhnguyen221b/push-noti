import { type Message, type MulticastMessage, type Notification } from 'firebase-admin/messaging';
import { getMessaging } from '../config/firebase';
import { AppError, ErrorCode } from '../utils/errors';
import { type SendNotificationInput } from '../schemas/notification.schema';

/**
 * All FCM send logic lives here. The HTTP layer never talks to firebase-admin
 * directly. Results are returned as a discriminated union; the controller maps
 * them to the wire contract.
 */

export interface SingleSendResult {
  kind: 'token';
  successCount: 1;
  messageId: string;
}

export interface FailedToken {
  token: string;
  error: string;
}

export interface MulticastSendResult {
  kind: 'tokens';
  successCount: number;
  failureCount: number;
  failedTokens: FailedToken[];
}

export interface TopicSendResult {
  kind: 'topic';
  messageId: string;
}

export type SendResult = SingleSendResult | MulticastSendResult | TopicSendResult;

/** Extract just the FCM error code (e.g. messaging/registration-token-not-registered). */
function firebaseErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** Wrap an FCM failure as a sanitised 502 — only the error code is surfaced. */
function toFcmError(err: unknown): AppError {
  const code = firebaseErrorCode(err);
  const message = code ? `FCM rejected the request: ${code}` : 'FCM rejected the request.';
  return new AppError(ErrorCode.FCM_ERROR, message, {
    ...(code ? { details: [{ message: code }] } : {}),
    cause: err,
  });
}

function buildNotification(input: SendNotificationInput): Notification {
  return { title: input.title, body: input.body };
}

export async function sendNotification(input: SendNotificationInput): Promise<SendResult> {
  // May throw AppError(FIREBASE_NOT_CONFIGURED) if no credential is configured.
  const messaging = getMessaging();
  const notification = buildNotification(input);
  const { target, data } = input;

  // ── Single token ──────────────────────────────────────────────────────────
  if ('token' in target) {
    const message: Message = { token: target.token, notification };
    if (data) message.data = data;
    try {
      const messageId = await messaging.send(message);
      return { kind: 'token', successCount: 1, messageId };
    } catch (err) {
      throw toFcmError(err);
    }
  }

  // ── Topic ─────────────────────────────────────────────────────────────────
  if ('topic' in target) {
    const message: Message = { topic: target.topic, notification };
    if (data) message.data = data;
    try {
      const messageId = await messaging.send(message);
      return { kind: 'topic', messageId };
    } catch (err) {
      throw toFcmError(err);
    }
  }

  // ── Multicast (array of tokens) ─────────────────────────────────────────────
  const multicast: MulticastMessage = { tokens: target.tokens, notification };
  if (data) multicast.data = data;
  let batchSuccess: number;
  let batchFailure: number;
  const failedTokens: FailedToken[] = [];
  try {
    // Use sendEachForMulticast (NOT the deprecated sendMulticast) so partial
    // failures are reported per token.
    const batch = await messaging.sendEachForMulticast(multicast);
    batchSuccess = batch.successCount;
    batchFailure = batch.failureCount;
    batch.responses.forEach((resp, index) => {
      if (!resp.success) {
        failedTokens.push({
          token: target.tokens[index] ?? '(unknown)',
          error: firebaseErrorCode(resp.error) ?? 'unknown',
        });
      }
    });
  } catch (err) {
    // A thrown error here means the whole batch call failed (e.g. auth), not a
    // per-token failure.
    throw toFcmError(err);
  }

  return {
    kind: 'tokens',
    successCount: batchSuccess,
    failureCount: batchFailure,
    failedTokens,
  };
}
