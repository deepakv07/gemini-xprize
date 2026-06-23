import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { RedisMessage } from '../services/redis.service';
import type { PrismaClient } from '@prisma/client';
import { MessageSender } from '../models';

// ─────────────────────────────────────────────────────────────────────────────
// MemoryAgent
//
// Two responsibilities:
//   1. Loads the user's recent conversation history from Redis into state.history.
//   2. Persists the inbound message to the Postgres `conversations` table so
//      every message is durably stored regardless of Redis eviction.
// ─────────────────────────────────────────────────────────────────────────────

type GetHistoryFn = (userId: string) => Promise<RedisMessage[]>;

export class MemoryAgent extends Agent {
  private readonly getHistory: GetHistoryFn;
  private readonly prisma: PrismaClient;

  /**
   * @param getHistoryFn  - Injected from redis.service.getConversationHistory.
   * @param prismaClient  - Injected Prisma client instance.
   */
  constructor(getHistoryFn: GetHistoryFn, prismaClient: PrismaClient) {
    super('MemoryAgent');
    this.getHistory = getHistoryFn;
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Loading memory for user ${state.userId}`);

    // ── 1. Fetch history from Redis ─────────────────────────────────────────
    let history: RedisMessage[] = [];
    try {
      history = await this.getHistory(state.userId);
      this.log(`Loaded ${history.length} messages from Redis`);
    } catch (err) {
      this.error('Failed to load Redis history — proceeding with empty history', err);
    }

    // ── 2. Ensure User exists, then write inbound message to Postgres ────────
    try {
      // Upsert the user to satisfy foreign key constraints for the demo
      await this.prisma.user.upsert({
        where: { id: state.userId },
        create: {
          id: state.userId,
          businessId: state.businessId,
          phoneNumber: `demo-${state.userId}`,
          name: 'Demo User',
        },
        update: {},
      });

      await this.prisma.conversation.create({
        data: {
          userId: state.userId,
          businessId: state.businessId,
          message: state.message,
          sender: MessageSender.USER,
          // intent/sentiment/urgency are populated by BehaviorAgent which runs later;
          // they can be updated in a follow-up call if needed.
        },
      });
      this.log('Persisted inbound message to Postgres');
    } catch (err) {
      // Non-fatal: we still want the pipeline to continue even if Postgres write fails.
      this.error('Failed to write conversation to Postgres', err);
    }

    return { ...state, history };
  }
}
