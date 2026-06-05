import { Router, type Request, type Response } from 'express';

export const healthRouter = Router();

/**
 * Liveness/health probe. Public — no API key, no rate limit.
 * → 200 { status: "ok", uptime: <seconds> }
 */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
  });
});
