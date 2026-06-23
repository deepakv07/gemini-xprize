import { Router } from 'express';
import { handleMessage } from '../controllers/message.controller';
import { listConversations } from '../controllers/conversation.controller';

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

export default router;

