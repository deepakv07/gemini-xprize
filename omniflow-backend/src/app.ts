import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import logger from './lib/logger';
import v1Router from './routes';
import authRouter from './routes/auth.routes';
import { registry } from './services/metrics.service';

const app: Application = express();

// ─── Security Middleware (must be first) ──────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/health
 * Health-check endpoint — no auth required
 */
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /metrics
 * Prometheus metrics endpoint — no auth (internal scraping only)
 */
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    res.status(500).end((err as Error).message);
  }
});

// ── Phase 4: Auth routes (public — no JWT required) ───────────────────────────
app.use('/api/v1/auth', authRouter);

// ── Protected API routes ──────────────────────────────────────────────────────
// Note: JWT validation is applied per-route selectively to allow
//       WhatsApp webhooks (Meta-signed, not JWT) to pass through.
app.use('/api/v1', v1Router);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

export default app;
