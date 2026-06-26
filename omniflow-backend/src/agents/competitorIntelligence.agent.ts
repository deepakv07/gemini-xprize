import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// CompetitorIntelligenceAgent
//
// Queries competitor pricing + seasonal data for the current business and
// injects it into AgentState as `competitor_factors`.
//
// OfferOptimizationAgent reads competitor_factors to:
//   • If competitor price lower by >5%  → add 5% extra discount
//   • If seasonalFactor > 1.2           → add seasonal bundle line
//
// Pipeline position: between SegmentationAgent and StrategyDecisionAgent
// ─────────────────────────────────────────────────────────────────────────────

export class CompetitorIntelligenceAgent extends Agent {
  private readonly prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    super('CompetitorIntelligenceAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Querying competitor data for business ${state.businessId}`);

    try {
      // Fetch all competitor rows for this business
      const rows = await this.prisma.competitorData.findMany({
        where: { businessId: state.businessId },
      });

      if (rows.length === 0) {
        this.log('No competitor data found — skipping competitor intelligence');
        return {
          ...state,
          competitor_factors: { avgCompetitorPrice: 0, maxSeasonalFactor: 1.0 },
        };
      }

      const avgCompetitorPrice =
        rows.reduce((sum, r) => sum + r.competitorPrice, 0) / rows.length;

      const maxSeasonalFactor = Math.max(...rows.map((r) => r.seasonalFactor));

      this.log(
        `avgCompetitorPrice=${avgCompetitorPrice.toFixed(2)}  ` +
        `maxSeasonalFactor=${maxSeasonalFactor.toFixed(2)}`
      );

      return {
        ...state,
        competitor_factors: { avgCompetitorPrice, maxSeasonalFactor },
      };
    } catch (err) {
      // Non-fatal — fall back to neutral factors
      this.warn(`CompetitorData query failed — ${(err as Error).message}`);
      return {
        ...state,
        competitor_factors: { avgCompetitorPrice: 0, maxSeasonalFactor: 1.0 },
      };
    }
  }
}
