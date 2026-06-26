import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../models';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Auth Controller  (Phase 4)
//
// POST /api/v1/auth/register  — Create a new Business account
// POST /api/v1/auth/login     — Verify credentials and return JWT
// ─────────────────────────────────────────────────────────────────────────────

const JWT_EXPIRY  = '7d';
const BCRYPT_ROUNDS = 12;

function signToken(businessId: string, email: string, plan: string): string {
  const secret = process.env.JWT_SECRET ?? 'omniflow-dev-secret';
  return jwt.sign({ businessId, email, plan }, secret, { expiresIn: JWT_EXPIRY });
}

/**
 * POST /api/v1/auth/register
 * Body: { name: string, email: string, password: string }
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password } = req.body as {
      name:     string;
      email:    string;
      password: string;
    };

    if (!name || !email || !password) {
      res.status(400).json({ status: 'error', message: 'name, email, and password are required' });
      return;
    }

    // Check if email already exists
    const existing = await prisma.business.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ status: 'error', message: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const apiKey       = uuidv4();

    const business = await prisma.business.create({
      data: { name, email, passwordHash, apiKey },
    });

    logger.info({ businessId: business.id, email }, '[Auth] Business registered');

    const token = signToken(business.id, business.email, business.plan);

    res.status(201).json({
      status:     'success',
      token,
      apiKey:     business.apiKey,
      businessId: business.id,
      plan:       business.plan,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/login
 * Body: { email: string, password: string }
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ status: 'error', message: 'email and password are required' });
      return;
    }

    const business = await prisma.business.findUnique({ where: { email } });
    if (!business) {
      res.status(401).json({ status: 'error', message: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, business.passwordHash);
    if (!valid) {
      res.status(401).json({ status: 'error', message: 'Invalid credentials' });
      return;
    }

    logger.info({ businessId: business.id, email }, '[Auth] Business logged in');

    const token = signToken(business.id, business.email, business.plan);

    res.status(200).json({
      status:     'success',
      token,
      apiKey:     business.apiKey,
      businessId: business.id,
      plan:       business.plan,
      expiresIn:  JWT_EXPIRY,
    });
  } catch (err) {
    next(err);
  }
}
