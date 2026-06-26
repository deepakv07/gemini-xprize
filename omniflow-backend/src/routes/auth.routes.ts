import { Router } from 'express';
import { register, login } from '../controllers/auth.controller';

// ─────────────────────────────────────────────────────────────────────────────
// Auth routes — public, no JWT middleware
// ─────────────────────────────────────────────────────────────────────────────

const authRouter = Router();

/**
 * POST /api/v1/auth/register
 * Body: { name: string, email: string, password: string }
 */
authRouter.post('/register', register);

/**
 * POST /api/v1/auth/login
 * Body: { email: string, password: string }
 */
authRouter.post('/login', login);

export default authRouter;
