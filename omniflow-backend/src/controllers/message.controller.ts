import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import type { AgentState } from '../types';
import { appendMessage } from '../services/redis.service';
import rabbitmqService from '../services/rabbitmq.service';

interface MessageBody {
  userId: string;
  businessId: string;
  message: string;
}

/**
 * handleMessage — POST /api/v1/message
 * 
 * Queues the message state into RabbitMQ and awaits the fully processed state
 * from the LangGraph worker process.
 */
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
    reqLog.info('[MessageController] Delegating processing to RabbitMQ Queue');
    
    // Publish message state and wait for LangGraph worker processing to finish
    state = await rabbitmqService.publishAndReceive(state);
    
    reqLog.info('[MessageController] Queue processing completed');

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

    reqLog.info('Sending reply to client');
    res.status(200).json({ response: state.response });
  } catch (err) {
    const error = err as Error;
    reqLog.error({ err: error.message, stack: error.stack }, 'Pipeline failed');
    next(err); // forwards to global error handler in app.ts
  }
}

