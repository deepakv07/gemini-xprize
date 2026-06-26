import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// JWT Auth Middleware  (Phase 4)
//
// validateJWT — verifies the Bearer token in Authorization header.
// Attaches decoded { businessId, email, plan } to req.user.
// Returns 401 if missing or invalid.
// ─────────────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  businessId: string;
  email:      string;
  plan:       string;
}

// Extend Express Request to carry decoded JWT payload
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function validateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ status: 'error', message: 'Missing or malformed Authorization header' });
    return;
  }

  const token  = authHeader.slice(7);
  const secret = process.env.JWT_SECRET ?? 'omniflow-dev-secret';

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = decoded;
    logger.debug({ businessId: decoded.businessId }, '[Auth] JWT verified');
    next();
  } catch (err) {
    const msg = err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token';
    logger.warn({ err: (err as Error).message }, `[Auth] ${msg}`);
    res.status(401).json({ status: 'error', message: msg });
  }
}
