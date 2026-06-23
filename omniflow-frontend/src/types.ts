// ─── Types shared across components ──────────────────────────────────────────

export interface ConversationEntry {
  id: string;
  message: string;
  sender: 'USER' | 'BOT';
  timestamp: string;
  intent: string | null;
  sentiment: number | null;
  urgency: number | null;
}
