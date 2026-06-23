import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import logger from './lib/logger';
import v1Router from './routes';

const app: Application = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/health
 * Health-check endpoint — returns { status: "ok" }
 */
app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Mount the v1 router at /api/v1
app.use('/api/v1', v1Router);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ status: 'error', message: 'Internal Server Error' });
});

export default app;
