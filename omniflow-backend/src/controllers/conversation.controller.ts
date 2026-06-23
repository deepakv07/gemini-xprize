import { Request, Response, NextFunction } from 'express';
import prisma from '../models';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/conversations?userId=<uuid>&limit=<n>
//
// Returns the most recent N conversations for a user, newest first.
// ─────────────────────────────────────────────────────────────────────────────

export async function listConversations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId, limit } = req.query as { userId?: string; limit?: string };

  if (!userId) {
    res.status(400).json({ status: 'error', message: 'Query param "userId" is required.' });
    return;
  }

  const take = Math.min(parseInt(limit ?? '20', 10) || 20, 100);

  try {
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take,
      select: {
        id: true,
        message: true,
        sender: true,
        timestamp: true,
        intent: true,
        sentiment: true,
        urgency: true,
      },
    });

    logger.info({ userId, count: conversations.length }, 'listConversations');
    res.status(200).json({ conversations });
  } catch (err) {
    logger.error({ err }, 'listConversations failed');
    next(err);
  }
}
