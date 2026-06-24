import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// SegmentationAgent
//
// Applies a rule-based classifier (first-match, no scoring) to assign a
// customer segment. The rules operate on the ML predictions from
// RevenuePredictionAgent and the behavioural profile from DigitalTwinAgent.
//
// Rule priority order (first match wins):
//   1. at-risk         — purchaseProbability < 0.2 AND buyingFrequency < 0.3
//   2. high-value      — ltv > 5000 OR purchaseProbability > 0.7
//   3. frequent-buyer  — buyingFrequency > 0.6
//   4. price-sensitive — budgetSensitivity > 0.7
//   5. new             — (default / catch-all)
//
// After classification, the most-recent Prediction row for this user is
// updated with the segment value.
// ─────────────────────────────────────────────────────────────────────────────

type Segment = NonNullable<AgentState['segment']>;

export class SegmentationAgent extends Agent {
  private readonly prisma: PrismaClient;

  /**
   * @param prismaClient - Injected Prisma client instance.
   */
  constructor(prismaClient: PrismaClient) {
    super('SegmentationAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Running segmentation for user ${state.userId}`);

    // ── Guards ────────────────────────────────────────────────────────────────
    if (!state.predictions) {
      throw new Error(
        '[SegmentationAgent] state.predictions is missing — RevenuePredictionAgent must run before SegmentationAgent.',
      );
    }
    if (!state.profile) {
      throw new Error(
        '[SegmentationAgent] state.profile is null — DigitalTwinAgent must run before SegmentationAgent.',
      );
    }

    const { purchaseProbability, ltv } = state.predictions;
    const buyingFrequency   = state.profile.buyingFrequency   ?? 0.5;
    const budgetSensitivity = state.profile.budgetSensitivity ?? 0.5;

    // ── Rule chain (first match wins — DO NOT reorder) ────────────────────────
    let segment: Segment;

    if (purchaseProbability < 0.2 && buyingFrequency < 0.3) {
      // Rule 1: At-risk — low probability AND low historical frequency
      segment = 'at-risk';
    } else if (ltv > 5000 || purchaseProbability > 0.7) {
      // Rule 2: High-value — either rich history OR very likely to buy
      segment = 'high-value';
    } else if (buyingFrequency > 0.6) {
      // Rule 3: Frequent buyer — buys often even if not currently high-value
      segment = 'frequent-buyer';
    } else if (budgetSensitivity > 0.7) {
      // Rule 4: Price-sensitive — will buy but needs a deal
      segment = 'price-sensitive';
    } else {
      // Rule 5: Default — new or unclassified customer
      segment = 'new';
    }

    this.log(
      `Segment="${segment}"  ` +
      `(purchaseProb=${purchaseProbability.toFixed(3)}, ` +
      `ltv=${ltv.toFixed(2)}, ` +
      `buyingFreq=${buyingFrequency.toFixed(3)}, ` +
      `budgetSens=${budgetSensitivity.toFixed(3)})`,
    );

    // ── Update the most-recent Prediction row with the segment ────────────────
    const latestPrediction = await this.prisma.prediction.findFirst({
      where:   { userId: state.userId },
      orderBy: { timestamp: 'desc' },
    });

    if (latestPrediction) {
      await this.prisma.prediction.update({
        where: { id: latestPrediction.id },
        data:  { segment },
      });
      this.log(`Updated Prediction ${latestPrediction.id} with segment="${segment}"`);
    } else {
      this.warn(`No Prediction row found for user ${state.userId} — segment not persisted`);
    }

    return { ...state, segment };
  }
}
