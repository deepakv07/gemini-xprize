import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import { FeedbackAgent } from '../agents/feedback.agent';
import { rlAgent } from '../agents/reinforcementLearning.agent';
import prisma from '../models';
import type { FeedbackOutcome } from '@prisma/client';

const feedbackAgent = new FeedbackAgent(prisma);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/feedback
//
// Body: { userId: string, strategyId: string, outcome: "PURCHASE"|"REJECT"|"IGNORE" }
//
// 1. Validates outcome enum value
// 2. FeedbackAgent writes Feedback row + updates Strategy row
// 3. RL agent updates Q-table for the segment
// 4. On PURCHASE: KnowledgeGraph stores the purchase triple
// ─────────────────────────────────────────────────────────────────────────────

export async function handleFeedback(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, strategyId, outcome } = req.body as {
      userId: string;
      strategyId: string;
      outcome: string;
    };

    // ── Validate required fields ──────────────────────────────────────────────
    if (!userId || !strategyId || !outcome) {
      res.status(400).json({
        status: 'error',
        message: 'Request body must include userId, strategyId, and outcome.',
      });
      return;
    }

    const validOutcomes = ['PURCHASE', 'REJECT', 'IGNORE'];
    if (!validOutcomes.includes(outcome.toUpperCase())) {
      res.status(400).json({
        status: 'error',
        message: `outcome must be one of: ${validOutcomes.join(', ')}`,
      });
      return;
    }

    const normalizedOutcome = outcome.toUpperCase() as FeedbackOutcome;

    logger.info({ userId, strategyId, outcome: normalizedOutcome }, '[FeedbackController] Processing feedback');

    // ── FeedbackAgent: write row, update strategy ─────────────────────────────
    const result = await feedbackAgent.process(userId, strategyId, normalizedOutcome);

    // ── RL Agent: update Q-table ──────────────────────────────────────────────
    await rlAgent.updatePolicy(result.segment, result.action, result.rewardValue);
    logger.info({ segment: result.segment, action: result.action }, '[FeedbackController] RL policy updated');

    // ── KnowledgeGraph: store purchase triple ─────────────────────────────────
    if (normalizedOutcome === 'PURCHASE') {
      try {
        // Lazy import to avoid circular deps — KG agent is optional
        const { KnowledgeGraphAgent } = await import('../agents/knowledgeGraph.agent');
        const kgAgent = new KnowledgeGraphAgent(prisma);
        await kgAgent.storeTriple(
          `customer:${userId}`,
          'PURCHASED',
          `product:${result.productName}`
        );
        logger.info({ userId }, '[FeedbackController] KG triple stored for PURCHASE');
      } catch (kgErr) {
        logger.warn({ err: (kgErr as Error).message }, '[FeedbackController] KG store failed (non-fatal)');
      }
    }

    res.status(201).json({
      status: 'success',
      feedback: {
        id:          result.feedback.id,
        outcome:     result.feedback.outcome,
        rewardValue: result.feedback.rewardValue,
        recordedAt:  result.feedback.recordedAt,
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message, stack: error.stack }, '[FeedbackController] Error');
    next(error);
  }
}
