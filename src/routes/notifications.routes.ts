import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { sendNotificationSchema } from '../schemas/notification.schema';
import { sendNotificationHandler } from '../controllers/notification.controller';

export const notificationsRouter = Router();

// Mounted under /api/v1/notifications, which already applies rate-limit + API
// key. Full chain: rateLimit → apiKey → validateBody → controller.
notificationsRouter.post('/send', validateBody(sendNotificationSchema), sendNotificationHandler);
