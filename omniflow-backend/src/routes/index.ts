import { Router } from 'express';
import { handleMessage }         from '../controllers/message.controller';
import { listConversations }     from '../controllers/conversation.controller';
import { getDashboardStats }     from '../controllers/dashboard.controller';
import { handleFeedback }        from '../controllers/feedback.controller';
import { updateCompetitorData }  from '../controllers/competitor.controller';
import {
  verifyWhatsAppWebhook,
  handleWhatsAppMessage,
} from '../controllers/webhook.controller';

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1 router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// ── Phase 1 + 2: Core pipeline ────────────────────────────────────────────────

/**
 * POST /api/v1/message
 * Body: { userId: string, businessId: string, message: string }
 */
router.post('/message', handleMessage);

/**
 * GET /api/v1/conversations?userId=<uuid>&limit=<n>
 */
router.get('/conversations', listConversations);

/**
 * GET /api/v1/dashboard/stats
 */
router.get('/dashboard/stats', getDashboardStats);

// ── Phase 3: Feedback + Competitor + WhatsApp Webhook ────────────────────────

/**
 * POST /api/v1/feedback
 * Body: { userId: string, strategyId: string, outcome: "PURCHASE"|"REJECT"|"IGNORE" }
 */
router.post('/feedback', handleFeedback);

/**
 * POST /api/v1/competitor/update
 * Body: { businessId: string, product: string, competitorPrice: number, seasonalFactor?: number }
 */
router.post('/competitor/update', updateCompetitorData);

/**
 * GET  /api/v1/webhooks/whatsapp  — Meta webhook verification challenge
 * POST /api/v1/webhooks/whatsapp  — Incoming WhatsApp message handler
 */
router.get('/webhooks/whatsapp',  verifyWhatsAppWebhook);
router.post('/webhooks/whatsapp', handleWhatsAppMessage);

export default router;
