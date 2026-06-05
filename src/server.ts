import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { getMessaging, isFirebaseConfigured } from './config/firebase';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function bootstrap(): void {
  const app = createApp();

  // Fail-fast on broken creds: if a credential IS configured, initialise the
  // Admin SDK once at process start so a bad cert crashes here, not mid-request.
  // If absent, env.ts already warned and we defer init to the first send.
  if (isFirebaseConfigured()) {
    try {
      getMessaging();
    } catch (err) {
      logger.fatal({ err }, 'Failed to initialise Firebase Admin SDK at startup');
      process.exit(1);
    }
  }

  const server: Server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, nodeEnv: env.nodeEnv, firebaseConfigured: isFirebaseConfigured() },
      `Server listening on port ${env.port}`,
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Received shutdown signal; closing server');
    const forced = setTimeout(() => {
      logger.error('Could not close connections in time; forcing shutdown');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    server.close((err) => {
      if (err) {
        logger.error({ err }, 'Error during server shutdown');
        process.exit(1);
      }
      logger.info('Server closed; exiting');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap();
