import { type NextFunction, type Request, type Response } from 'express';
import { requestLogger } from '../utils/logger';
import { sendNotification } from '../services/notification.service';
import { type SendNotificationInput } from '../schemas/notification.schema';

/** Derive the (non-sensitive) target shape for logging. */
function targetShape(input: SendNotificationInput): 'token' | 'tokens' | 'topic' {
  if ('token' in input.target) return 'token';
  if ('tokens' in input.target) return 'tokens';
  return 'topic';
}

/**
 * POST /api/v1/notifications/send
 *
 * The body has already been validated by `validateBody`, so it is safe to treat
 * `req.body` as a SendNotificationInput. We log ONLY the target shape and result
 * counts — never the tokens, topic, title, body, or data.
 */
export async function sendNotificationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const input = req.body as SendNotificationInput;
  const log = requestLogger(req);

  try {
    const result = await sendNotification(input);

    switch (result.kind) {
      case 'token':
        log.info({ targetShape: 'token', successCount: 1 }, 'Notification sent');
        res.status(200).json({ successCount: 1, messageId: result.messageId });
        return;
      case 'tokens':
        log.info(
          {
            targetShape: 'tokens',
            successCount: result.successCount,
            failureCount: result.failureCount,
          },
          'Multicast notification sent',
        );
        res.status(200).json({
          successCount: result.successCount,
          failureCount: result.failureCount,
          failedTokens: result.failedTokens,
        });
        return;
      case 'topic':
        log.info({ targetShape: 'topic' }, 'Topic notification sent');
        res.status(200).json({ messageId: result.messageId });
        return;
    }
  } catch (err) {
    log.warn({ targetShape: targetShape(input) }, 'Notification send failed');
    next(err);
  }
}
