
import type { AgentState } from '../types';
import type { PrismaClient, FeedbackOutcome } from '@prisma/client';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// FeedbackAgent
//
// Records what happened after an AI strategy was delivered:
//   PURCHASE → rewardValue = +1
//   IGNORE   → rewardValue =  0
//   REJECT   → rewardValue = -1
//
// After writing the Feedback row:
//  1. Updates the Strategy row (applied=true, outcome=<outcome>)
//  2. Calls RL agent updatePolicy so Q-values self-improve
//  3. On PURCHASE, stores a KG triple (userId PURCHASED productName)
// ─────────────────────────────────────────────────────────────────────────────

const REWARD_MAP: Record<FeedbackOutcome, number> = {
  PURCHASE: 1,
  IGNORE:   0,
  REJECT:  -1,
};

export class FeedbackAgent {
  private readonly prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Process a feedback event — called from the feedback HTTP controller,
   * NOT as part of the main LangGraph pipeline.
   *
   * @param userId      - UUID of the end-user
   * @param strategyId  - UUID of the Strategy row being evaluated
   * @param outcome     - PURCHASE | REJECT | IGNORE
   * @returns           - The created Feedback row
   */
  async process(userId: string, strategyId: string, outcome: FeedbackOutcome) {
    logger.info({ userId, strategyId, outcome }, '[FeedbackAgent] Processing feedback');

    const rewardValue = REWARD_MAP[outcome];
    logger.info({ rewardValue }, '[FeedbackAgent] Mapped reward value');

    // ── 1. Fetch the strategy to get segment / action info ──────────────────
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`[FeedbackAgent] Strategy ${strategyId} not found`);
    }

    // ── 2. Create Feedback row ───────────────────────────────────────────────
    const feedback = await this.prisma.feedback.create({
      data: {
        strategyId,
        userId,
        outcome,
        rewardValue,
      },
    });

    logger.info({ feedbackId: feedback.id }, '[FeedbackAgent] Feedback row created');

    // ── 3. Update Strategy row (applied=true, outcome) ───────────────────────
    await this.prisma.strategy.update({
      where: { id: strategyId },
      data: {
        applied: true,
        outcome: outcome.toLowerCase(),
      },
    });

    logger.info({ strategyId }, '[FeedbackAgent] Strategy marked as applied');

    // ── 4. Extract segment and recommended action for RL ─────────────────────
    const recommendedAction = strategy.recommendedAction as {
      discount: number;
      bundle: string[];
      reason: string;
    };

    // Fetch the segment from the latest prediction for this user
    const latestPrediction = await this.prisma.prediction.findFirst({
      where:   { userId },
      orderBy: { timestamp: 'desc' },
    });

    const segment = latestPrediction?.segment ?? 'new';
    const action  = recommendedAction.bundle?.[0] ?? 'default';

    logger.info({ segment, action, rewardValue }, '[FeedbackAgent] RL update will be called by caller');

    // ── 5. Return feedback result (RL + KG calls happen in controller) ───────
    return {
      feedback,
      segment,
      action,
      rewardValue,
      outcome,
      productName: recommendedAction.bundle?.[0] ?? 'unknown-product',
    };
  }
}
