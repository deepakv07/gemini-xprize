import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// StrategyDecisionAgent
//
// Switches on the customer segment (from SegmentationAgent) and outputs a
// deterministic strategy: recommended discount, bundle SKUs, reason string,
// and a follow-up time window.
//
// The strategy is persisted to the Strategy table with applied=false and
// outcome=null (to be updated by downstream processes when the offer is acted on).
// ─────────────────────────────────────────────────────────────────────────────

/** Hours offset in milliseconds */
const HOURS_MS = (h: number): number => h * 60 * 60 * 1000;

interface StrategyTemplate {
  discount:     number;
  bundle:       string[];
  reason:       string;
  followUpHours: number;
}

/** Strategy templates keyed by segment name */
const STRATEGY_MAP: Record<NonNullable<AgentState['segment']>, StrategyTemplate> = {
  'high-value': {
    discount:      5,
    bundle:        ['loyalty-bonus'],
    reason:        'High-value customer — light incentive, fast follow-up',
    followUpHours: 24,
  },
  'at-risk': {
    discount:      20,
    bundle:        ['win-back-offer'],
    reason:        'At-risk customer — aggressive discount, urgent follow-up',
    followUpHours: 2,
  },
  'frequent-buyer': {
    discount:      10,
    bundle:        ['repeat-purchase-bundle'],
    reason:        'Frequent buyer — moderate incentive to reinforce habit',
    followUpHours: 48,
  },
  'price-sensitive': {
    discount:      15,
    bundle:        ['value-bundle'],
    reason:        'Price-sensitive customer — discount-led offer',
    followUpHours: 24,
  },
  'new': {
    discount:      10,
    bundle:        ['welcome-offer'],
    reason:        'New customer — standard welcome incentive',
    followUpHours: 12,
  },
};

export class StrategyDecisionAgent extends Agent {
  private readonly prisma: PrismaClient;

  /**
   * @param prismaClient - Injected Prisma client instance.
   */
  constructor(prismaClient: PrismaClient) {
    super('StrategyDecisionAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Running strategy decision for user ${state.userId}`);

    // ── Guards ────────────────────────────────────────────────────────────────
    if (!state.segment) {
      throw new Error(
        '[StrategyDecisionAgent] state.segment is missing — SegmentationAgent must run before StrategyDecisionAgent.',
      );
    }
    if (!state.predictions) {
      throw new Error(
        '[StrategyDecisionAgent] state.predictions is missing — RevenuePredictionAgent must run before StrategyDecisionAgent.',
      );
    }

    // ── Select strategy template for this segment ─────────────────────────────
    const template = STRATEGY_MAP[state.segment];
    const { discount, bundle, reason, followUpHours } = template;

    // ── Compute follow-up time via simple millisecond arithmetic ──────────────
    const followUpDate   = new Date(Date.now() + HOURS_MS(followUpHours));
    const followUpIso    = followUpDate.toISOString();

    this.log(
      `segment="${state.segment}"  discount=${discount}%  ` +
      `bundle=[${bundle.join(', ')}]  followUp=${followUpIso}`,
    );

    // ── Persist Strategy row ──────────────────────────────────────────────────
    await this.prisma.strategy.create({
      data: {
        userId:            state.userId,
        recommendedAction: { discount, bundle, reason },
        followUpTime:      followUpDate,   // Date object for Prisma
        applied:           false,
        outcome:           null,
      },
    });

    this.log('Strategy row written to Postgres');

    return {
      ...state,
      strategy: {
        discount,
        bundle,
        reason,
        followUpTime: followUpIso,  // ISO string in state
      },
    };
  }
}
