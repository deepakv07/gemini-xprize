import { Router } from 'express';
import { handleMessage } from '../controllers/message.controller';
import { listConversations } from '../controllers/conversation.controller';
import { getDashboardStats } from '../controllers/dashboard.controller';

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1 router
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /api/v1/message
 * Body: { userId: string, businessId: string, message: string }
 * Returns: { response: string }
 */
router.post('/message', handleMessage);

/**
 * GET /api/v1/conversations?userId=<uuid>&limit=<n>
 * Returns: { conversations: Conversation[] }
 */
router.get('/conversations', listConversations);

/**
 * GET /api/v1/dashboard/stats
 * Returns: aggregated business metrics and user segment distributions
 */
router.get('/dashboard/stats', getDashboardStats);

export default router;


