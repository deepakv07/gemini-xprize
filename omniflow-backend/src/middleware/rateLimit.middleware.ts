import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getClient } from '../services/redis.service';
import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Middleware  (Phase 4)
//
// Three-tier limits by plan:
//   FREE       = 100  requests/hour
//   PRO        = 1000 requests/hour
//   ENTERPRISE = 10000 requests/hour
//
// Key: businessId from JWT (falls back to IP for unauthenticated requests)
// Store: Redis (shared across all server instances)
// ─────────────────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

function buildLimiter(maxRequests: number) {
  return rateLimit({
    windowMs: ONE_HOUR_MS,
    max:      maxRequests,
    keyGenerator: (req: Request) => req.user?.businessId ?? req.ip ?? 'unknown',
    handler: (req: Request, res: Response) => {
      logger.warn({ businessId: req.user?.businessId, plan: req.user?.plan }, '[RateLimit] Limit exceeded');
      res.status(429).json({
        status:     'error',
        message:    'Rate limit exceeded',
        retryAfter: Math.ceil(ONE_HOUR_MS / 1000),
      });
    },
    standardHeaders: true,
    legacyHeaders:   false,
    skip: (req: Request) => {
      // Skip rate limiting if Redis isn't ready (fail open)
      try {
        getClient();
        return false;
      } catch {
        return true;
      }
    },
    store: (() => {
      try {
        return new RedisStore({
          // @ts-expect-error — rate-limit-redis expects ioredis-compatible client
          sendCommand: (...args: string[]) => getClient().call(...args),
        });
      } catch {
        // Fall back to in-memory store if Redis isn't available
        return undefined;
      }
    })(),
  });
}

export const freeLimiter       = buildLimiter(100);
export const proLimiter        = buildLimiter(1000);
export const enterpriseLimiter = buildLimiter(10000);

/**
 * selectLimiter — reads req.user.plan and applies the correct rate limiter.
 * Must be applied AFTER validateJWT middleware.
 */
export function selectLimiter(req: Request, res: Response, next: NextFunction): void {
  const plan = req.user?.plan ?? 'FREE';

  switch (plan.toUpperCase()) {
    case 'ENTERPRISE':
      enterpriseLimiter(req, res, next);
      break;
    case 'PRO':
      proLimiter(req, res, next);
      break;
    default:
      freeLimiter(req, res, next);
  }
}
