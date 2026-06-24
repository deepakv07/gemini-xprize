import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';
import {
  buildFeatureVector,
  predictPurchaseProbability,
  predictExpectedOrderValue,
} from '../services/mlInference.service';

// ─────────────────────────────────────────────────────────────────────────────
// RevenuePredictionAgent
//
// Uses two ONNX models (purchase classifier + order value regressor) to predict:
//   • purchaseProbability  — likelihood this user will purchase [0, 1]
//   • expectedOrderValue   — predicted order size (float)
//   • ltv                  — lifetime value estimate
//
// Prerequisite: DigitalTwinAgent must have run first (state.profile must be set).
// Output: writes a Prediction row to Postgres; sets state.predictions.
// ─────────────────────────────────────────────────────────────────────────────

export class RevenuePredictionAgent extends Agent {
  private readonly prisma: PrismaClient;

  /**
   * @param prismaClient - Injected Prisma client instance (same pattern as DigitalTwinAgent).
   */
  constructor(prismaClient: PrismaClient) {
    super('RevenuePredictionAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Running revenue prediction for user ${state.userId}`);

    // ── Guard: DigitalTwinAgent must have run first ────────────────────────────
    if (!state.profile) {
      throw new Error(
        '[RevenuePredictionAgent] state.profile is null — DigitalTwinAgent must run before RevenuePredictionAgent.',
      );
    }

    // ── Build feature vector (order from feature_order.json, never guessed) ───
    const sentiment = state.sentiment ?? 0;
    const urgency   = state.urgency   ?? 0.5;

    const features = buildFeatureVector(state.profile, sentiment, urgency);
    this.log(`Feature vector: [${features.map((v) => v.toFixed(4)).join(', ')}]`);

    // ── Run both ONNX models ──────────────────────────────────────────────────
    const [purchaseProbability, expectedOrderValue] = await Promise.all([
      predictPurchaseProbability(features),
      predictExpectedOrderValue(features),
    ]);

    this.log(
      `purchaseProbability=${purchaseProbability.toFixed(4)}  ` +
      `expectedOrderValue=${expectedOrderValue.toFixed(2)}`,
    );

    // ── Compute LTV ───────────────────────────────────────────────────────────
    // Use stored lifetimeValue if the customer has purchase history.
    // Otherwise apply a heuristic: expectedOrderValue * buyingFrequency * 10
    // TODO (Phase 2 placeholder): replace with a dedicated LTV regression model
    //   that factors in churn probability and discount-adjusted margin.
    const storedLtv = state.profile.lifetimeValue ?? 0;
    const buyingFreq = state.profile.buyingFrequency ?? 0.5;
    const ltv =
      storedLtv > 0
        ? storedLtv
        : expectedOrderValue * buyingFreq * 10;

    this.log(`ltv=${ltv.toFixed(2)} (source: ${storedLtv > 0 ? 'stored' : 'heuristic'})`);

    // ── Persist to Prediction table (segment left null — filled by SegmentationAgent) ─
    await this.prisma.prediction.create({
      data: {
        userId: state.userId,
        purchaseProbability,
        expectedOrderValue,
        ltv,
        segment: null,
      },
    });

    this.log('Prediction row written to Postgres');

    return {
      ...state,
      predictions: { purchaseProbability, expectedOrderValue, ltv },
    };
  }
}
