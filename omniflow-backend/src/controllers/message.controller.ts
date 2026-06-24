import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import type { AgentState } from '../types';

// ── Services (imported for injection) ────────────────────────────────────────
import { extractBehavior, generateResponse } from '../services/openai.service';
import {
  getConversationHistory,
  appendMessage,
} from '../services/redis.service';
import prisma from '../models';

// ── Agents ────────────────────────────────────────────────────────────────────
import { MemoryAgent }              from '../agents/memory.agent';
import { BehaviorAgent }            from '../agents/behavior.agent';
import { DigitalTwinAgent }         from '../agents/digitalTwin.agent';
import { RevenuePredictionAgent }   from '../agents/revenuePrediction.agent';
import { SegmentationAgent }        from '../agents/segmentation.agent';
import { StrategyDecisionAgent }    from '../agents/strategyDecision.agent';
import { OfferOptimizationAgent }   from '../agents/offerOptimization.agent';
import { ExecutionAgent }           from '../agents/execution.agent';

// ─────────────────────────────────────────────────────────────────────────────
// Agent singletons — constructed once at module load, services injected here.
// ─────────────────────────────────────────────────────────────────────────────

const memoryAgent            = new MemoryAgent(getConversationHistory, prisma);
const behaviorAgent          = new BehaviorAgent(extractBehavior);
const digitalTwinAgent       = new DigitalTwinAgent(prisma);
const revenuePredictionAgent = new RevenuePredictionAgent(prisma);
const segmentationAgent      = new SegmentationAgent(prisma);
const strategyDecisionAgent  = new StrategyDecisionAgent(prisma);
const offerOptimizationAgent = new OfferOptimizationAgent();
const executionAgent         = new ExecutionAgent(generateResponse);

// ─────────────────────────────────────────────────────────────────────────────
// Request body type
// ─────────────────────────────────────────────────────────────────────────────

interface MessageBody {
  userId: string;
  businessId: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// handleMessage  — POST /api/v1/message
//
// Pipeline order:
//   1. MemoryAgent            — hydrate history from Redis, persist USER msg to PG
//   2. BehaviorAgent          — extract intent / sentiment / urgency via OpenAI
//   3. DigitalTwinAgent       — fetch/update CustomerProfile in Postgres
//   4. RevenuePredictionAgent — ML-based purchase probability + order value (ONNX)
//   5. SegmentationAgent      — rule-based segment assignment; updates Prediction row
//   6. StrategyDecisionAgent  — select discount / bundle / follow-up time by segment
//   7. OfferOptimizationAgent — build headline + copyHint (ephemeral, no DB write)
//   8. ExecutionAgent         — generate final reply via OpenAI, weaves in offer hint
// ─────────────────────────────────────────────────────────────────────────────

export async function handleMessage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId, businessId, message } = req.body as MessageBody;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!userId || !businessId || !message) {
    res.status(400).json({
      status: 'error',
      message: 'Request body must include userId, businessId, and message.',
    });
    return;
  }

  const reqLog = logger.child({ userId, businessId });
  reqLog.info({ message }, 'Incoming message');

  // ── Build initial AgentState ──────────────────────────────────────────────
  let state: AgentState = {
    userId,
    businessId,
    message,
    history: [],
    profile: null,
    intent: null,
    sentiment: null,
    urgency: null,
    response: null,
  };

  try {
    // ── Step 1: MemoryAgent ─────────────────────────────────────────────────
    reqLog.info('Running MemoryAgent');
    state = await memoryAgent.process(state);
    reqLog.info({ historyLength: state.history.length }, 'MemoryAgent complete');

    // ── Step 2: BehaviorAgent ───────────────────────────────────────────────
    reqLog.info('Running BehaviorAgent');
    state = await behaviorAgent.process(state);
    reqLog.info(
      { intent: state.intent, sentiment: state.sentiment, urgency: state.urgency },
      'BehaviorAgent complete',
    );

    // ── Step 3: DigitalTwinAgent ────────────────────────────────────────────
    reqLog.info('Running DigitalTwinAgent');
    state = await digitalTwinAgent.process(state);
    reqLog.info(
      { buyingFrequency: (state.profile as { buyingFrequency?: number })?.buyingFrequency },
      'DigitalTwinAgent complete',
    );

    // ── Step 4: RevenuePredictionAgent ──────────────────────────────────────
    reqLog.info('Running RevenuePredictionAgent');
    state = await revenuePredictionAgent.process(state);
    reqLog.info(
      {
        purchaseProbability: state.predictions?.purchaseProbability,
        expectedOrderValue:  state.predictions?.expectedOrderValue,
        ltv:                 state.predictions?.ltv,
      },
      'RevenuePredictionAgent complete',
    );

    // ── Step 5: SegmentationAgent ───────────────────────────────────────────
    reqLog.info('Running SegmentationAgent');
    state = await segmentationAgent.process(state);
    reqLog.info({ segment: state.segment }, 'SegmentationAgent complete');

    // ── Step 6: StrategyDecisionAgent ───────────────────────────────────────
    reqLog.info('Running StrategyDecisionAgent');
    state = await strategyDecisionAgent.process(state);
    reqLog.info(
      { discount: state.strategy?.discount, bundle: state.strategy?.bundle },
      'StrategyDecisionAgent complete',
    );

    // ── Step 7: OfferOptimizationAgent ──────────────────────────────────────
    reqLog.info('Running OfferOptimizationAgent');
    state = await offerOptimizationAgent.process(state);
    reqLog.info({ headline: state.offer?.headline }, 'OfferOptimizationAgent complete');

    // ── Step 8: ExecutionAgent ──────────────────────────────────────────────
    reqLog.info('Running ExecutionAgent');
    state = await executionAgent.process(state);
    reqLog.info({ responseLength: state.response?.length }, 'ExecutionAgent complete');

    // ── Append BOT reply to Redis history ───────────────────────────────────
    if (state.response) {
      try {
        await appendMessage(userId, {
          sender: 'BOT',
          message: state.response,
          timestamp: new Date().toISOString(),
          intent: state.intent,
          sentiment: state.sentiment,
          urgency: state.urgency,
        });
      } catch (redisErr) {
        // Non-fatal — we still return the response to the client
        reqLog.warn({ err: redisErr }, 'Failed to append BOT reply to Redis');
      }
    }

    reqLog.info('Pipeline complete — sending response');
    res.status(200).json({ response: state.response });
  } catch (err) {
    const error = err as Error;
    reqLog.error({ err: error.message, stack: error.stack }, 'Pipeline failed');
    next(err); // forwards to global error handler in app.ts
  }
}
