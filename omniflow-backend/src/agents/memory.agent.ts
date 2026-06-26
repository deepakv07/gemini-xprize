import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { RedisMessage } from '../services/redis.service';
import type { PrismaClient } from '@prisma/client';
import { MessageSender } from '../models';
import { v5 as uuidv5, validate as uuidValidate } from 'uuid';

// Fixed namespace for deterministic userId → UUID conversion
const OMNIFLOW_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // UUID v5 URL namespace

/** Converts any string to a valid UUID. If already a UUID, returns as-is. */
function toUuid(id: string): string {
  return uuidValidate(id) ? id : uuidv5(id, OMNIFLOW_NS);
}

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
    // Normalise userId — Postgres requires a valid UUID
    const normalizedUserId = toUuid(state.userId);
    const normalizedState  = { ...state, userId: normalizedUserId };
    this.log(`Loading memory for user ${state.userId} (uuid: ${normalizedUserId})`);

    // ── 1. Fetch history from Redis ─────────────────────────────────────────
    let history: RedisMessage[] = [];
    try {
      history = await this.getHistory(normalizedUserId);
      this.log(`Loaded ${history.length} messages from Redis`);
    } catch (err) {
      this.error('Failed to load Redis history — proceeding with empty history', err);
    }

    // ── 2. Ensure User exists, then write inbound message to Postgres ────────
    try {
      // Upsert the user to satisfy foreign key constraints for the demo
      await this.prisma.user.upsert({
        where: { id: normalizedUserId },
        create: {
          id: normalizedUserId,
          businessId: normalizedState.businessId,
          phoneNumber: `demo-${state.userId}`,
          name: 'Demo User',
        },
        update: {},
      });

      await this.prisma.conversation.create({
        data: {
          userId: normalizedUserId,
          businessId: normalizedState.businessId,
          message: normalizedState.message,
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

    return { ...normalizedState, history };
  }
}
