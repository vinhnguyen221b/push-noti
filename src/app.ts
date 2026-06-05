import path from 'node:path';
import express, { type Application, Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { healthRouter } from './routes/health.routes';
import { notificationsRouter } from './routes/notifications.routes';
import { createRateLimiter } from './middleware/rateLimit';
import { requireApiKey } from './middleware/apiKey';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

/**
 * Builds the Express application. Intentionally does NOT call `listen()` so the
 * app can be imported by tests.
 *
 * Order matters:
 *   helmet → json → request logging → public /health
 *   → /api/v1 (rate limit → api key → feature routes)
 *   → 404 → central error handler
 */
export function createApp(): Application {
  const app = express();

  // Behind a proxy, let express-rate-limit see the real client IP.
  app.set('trust proxy', env.trustProxy);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  // Structured request logging. Custom serializers ensure we log ONLY safe
  // request/response metadata (id, method, url, status) plus pino-http's
  // duration — never headers (which carry the API key) or bodies (tokens).
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );

  // Optional same-origin browser UI for manually triggering notifications.
  // Served from /public at the site root. The /send endpoint it calls is still
  // API-key protected, so loading the page grants no send capability on its own.
  if (env.enableUi) {
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }

  // Public health probe — no auth, no rate limit.
  app.use(healthRouter);

  // Versioned API: rate-limited and API-key protected. Feature routers are
  // mounted onto this in later phases (notifications in Phase 5).
  const apiV1 = Router();
  apiV1.use(createRateLimiter());
  apiV1.use(requireApiKey);
  apiV1.use('/notifications', notificationsRouter);
  app.use('/api/v1', apiV1);

  // 404 for anything unmatched, then the central error handler (last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
