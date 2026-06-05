import { z } from 'zod';

/**
 * Request schema for POST /api/v1/notifications/send.
 *
 * `data` values MUST all be strings — FCM rejects non-string data values, so we
 * enforce it here (z.record(z.string(), z.string())) and fail fast with a 400.
 * `target` is exactly one of: a single token, an array of tokens (multicast,
 * max 500), or a topic. Each shape is `.strict()` so mixing keys is rejected.
 */

// FCM topic names: letters, digits, and -_.~%
const TOPIC_REGEX = /^[a-zA-Z0-9-_.~%]+$/;

const dataSchema = z.record(z.string(), z.string());

const tokenTarget = z.object({ token: z.string().min(1) }).strict();

const tokensTarget = z
  .object({
    tokens: z.array(z.string().min(1)).min(1, 'At least one token is required').max(500),
  })
  .strict();

const topicTarget = z
  .object({
    topic: z.string().min(1).regex(TOPIC_REGEX, 'Invalid FCM topic name'),
  })
  .strict();

const targetSchema = z.union([tokenTarget, tokensTarget, topicTarget]);

export const sendNotificationSchema = z
  .object({
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(500),
    data: dataSchema.optional(),
    target: targetSchema,
  })
  .strict();

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
export type NotificationTarget = z.infer<typeof targetSchema>;
