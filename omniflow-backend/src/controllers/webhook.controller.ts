import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import rabbitmqService from '../services/rabbitmq.service';
import { appendMessage } from '../services/redis.service';
import voiceService from '../services/voice.service';
import type { AgentState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Webhook Controller
//
// GET  /api/v1/webhooks/whatsapp  — Meta webhook verification challenge
// POST /api/v1/webhooks/whatsapp  — Incoming message handler
//
// Incoming text messages AND transcribed voice messages are pushed into
// the same RabbitMQ pipeline as the REST /api/v1/message endpoint.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/webhooks/whatsapp
 * Meta sends a GET request with hub.verify_token for webhook verification.
 */
export function verifyWhatsAppWebhook(req: Request, res: Response): void {
  const mode      = req.query['hub.mode'] as string;
  const token     = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('[WhatsAppWebhook] Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn({ mode, token }, '[WhatsAppWebhook] Webhook verification failed');
    res.sendStatus(403);
  }
}

/**
 * POST /api/v1/webhooks/whatsapp
 * Handles incoming WhatsApp messages (text + voice).
 */
export async function handleWhatsAppMessage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Always acknowledge immediately — Meta retries if we don't respond fast
  res.sendStatus(200);

  try {
    const body = req.body as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string;
              type?: string;
              text?: { body?: string };
              audio?: { id?: string };
              id?: string;
            }>;
            metadata?: { phone_number_id?: string };
          };
        }>;
      }>;
    };

    const value    = body.entry?.[0]?.changes?.[0]?.value;
    const msgObj   = value?.messages?.[0];
    const metadata = value?.metadata;

    if (!msgObj || !msgObj.from) {
      logger.info('[WhatsAppWebhook] No message in payload — ignoring');
      return;
    }

    const phoneNumber  = msgObj.from;                           // sender E.164
    const businessId   = metadata?.phone_number_id ?? 'default'; // business identifier
    const messageType  = msgObj.type ?? 'text';

    let messageText = '';

    if (messageType === 'text') {
      messageText = msgObj.text?.body ?? '';
    } else if (messageType === 'audio') {
      const audioId = msgObj.audio?.id;
      if (!audioId) {
        logger.warn('[WhatsAppWebhook] Audio message has no media ID — skipping');
        return;
      }
      logger.info({ audioId }, '[WhatsAppWebhook] Transcribing voice message');
      messageText = await voiceService.transcribeAudio(audioId);
    } else {
      logger.info({ messageType }, '[WhatsAppWebhook] Unsupported message type — skipping');
      return;
    }

    if (!messageText.trim()) {
      logger.warn('[WhatsAppWebhook] Empty message text — skipping');
      return;
    }

    logger.info({ phoneNumber, messageType, messageText }, '[WhatsAppWebhook] Processing message');

    // Append USER message to Redis history
    await appendMessage(phoneNumber, {
      sender: 'USER',
      message: messageText,
      timestamp: new Date().toISOString(),
    });

    // Build initial AgentState — use phone number as userId for WhatsApp users
    const state: AgentState = {
      userId:     phoneNumber,
      businessId,
      message:    messageText,
      history:    [],
      profile:    null,
      intent:     null,
      sentiment:  null,
      urgency:    null,
      response:   null,
      channel:    'whatsapp',
    };

    // Push into RabbitMQ pipeline — response is sent back to WhatsApp by worker
    await rabbitmqService.publishAndReceive(state);

    logger.info({ phoneNumber }, '[WhatsAppWebhook] Pipeline completed');
  } catch (err) {
    const error = err as Error;
    logger.error({ err: error.message, stack: error.stack }, '[WhatsAppWebhook] Error processing message');
    // Do not call next(error) — we already sent 200 to Meta
  }
}
