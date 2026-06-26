import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';
import { rlAgent } from './reinforcementLearning.agent';

// ─────────────────────────────────────────────────────────────────────────────
// StrategyDecisionAgent  (Phase 2 + Phase 3 RL override)
//
// Phase 2: Deterministic rule map from segment → strategy template.
// Phase 3: Before rule lookup, asks RL agent for the best learned action.
//          If RL returns a non-null action, it overrides the rule-based result.
//
// The strategy is persisted to the Strategy table and its ID is stored in
// state.strategy.strategyId for downstream FeedbackAgent use.
// ─────────────────────────────────────────────────────────────────────────────

const HOURS_MS = (h: number): number => h * 60 * 60 * 1000;

interface StrategyTemplate {
  discount:      number;
  bundle:        string[];
  reason:        string;
  followUpHours: number;
}

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

/** Map a learned RL action string back to a bundle item list */
function rlActionToBundle(action: string): string[] {
  return [action];
}

export class StrategyDecisionAgent extends Agent {
  private readonly prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    super('StrategyDecisionAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Running strategy decision for user ${state.userId}`);

    if (!state.segment) {
      throw new Error('[StrategyDecisionAgent] state.segment is missing — SegmentationAgent must run first.');
    }
    if (!state.predictions) {
      throw new Error('[StrategyDecisionAgent] state.predictions is missing — RevenuePredictionAgent must run first.');
    }

    // ── Phase 3: RL override — check learned policy first ────────────────────
    const rlAction = await rlAgent.getBestAction(state.segment);

    let discount:      number;
    let bundle:        string[];
    let reason:        string;
    let followUpHours: number;

    if (rlAction) {
      // RL agent has learned a policy — use it
      this.log(`RL override: segment="${state.segment}" → action="${rlAction}"`);
      const template = STRATEGY_MAP[state.segment]; // still use template for discount/timing
      discount      = template.discount;
      bundle        = rlActionToBundle(rlAction);
      reason        = `RL-learned strategy for segment: ${state.segment} (action: ${rlAction})`;
      followUpHours = template.followUpHours;
    } else {
      // No RL policy yet — fall back to deterministic rule
      this.log(`No RL policy for "${state.segment}" — using rule-based strategy`);
      const template = STRATEGY_MAP[state.segment];
      ({ discount, bundle, reason, followUpHours } = template);
    }

    const followUpDate = new Date(Date.now() + HOURS_MS(followUpHours));
    const followUpIso  = followUpDate.toISOString();

    this.log(
      `segment="${state.segment}"  discount=${discount}%  ` +
      `bundle=[${bundle.join(', ')}]  followUp=${followUpIso}`
    );

    // ── Persist Strategy row ──────────────────────────────────────────────────
    const strategyRow = await this.prisma.strategy.create({
      data: {
        userId:            state.userId,
        recommendedAction: { discount, bundle, reason },
        followUpTime:      followUpDate,
        applied:           false,
        outcome:           null,
      },
    });

    this.log(`Strategy row written (id=${strategyRow.id})`);

    return {
      ...state,
      strategy: {
        discount,
        bundle,
        reason,
        followUpTime: followUpIso,
        strategyId:   strategyRow.id,   // Phase 3: expose for FeedbackAgent
      },
    };
  }
}
