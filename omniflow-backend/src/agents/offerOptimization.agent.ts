import { Agent } from './base.agent';
import type { AgentState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// OfferOptimizationAgent  (Phase 2 + Phase 3 competitor intelligence)
//
// Phase 2: Deterministic headline + copyHint from bundle key.
// Phase 3: If competitor_factors present:
//   • competitor price lower by >5%  → add 5% extra discount
//   • seasonalFactor > 1.2           → append seasonal bundle line
// ─────────────────────────────────────────────────────────────────────────────

const HEADLINE_MAP: Record<string, string> = {
  'welcome-offer':          "Welcome! Here's something special for you",
  'win-back-offer':         "We miss you — here's an exclusive offer to come back",
  'loyalty-bonus':          'A thank-you just for our loyal customers',
  'repeat-purchase-bundle': 'Your favorites, bundled and discounted',
  'value-bundle':           'Smart savings on what you already love',
  'seasonal-bundle':        '🎉 Limited-time seasonal offer just for you!',
};

const DEFAULT_HEADLINE = 'A special offer just for you';

export class OfferOptimizationAgent extends Agent {
  constructor() {
    super('OfferOptimizationAgent');
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Building offer for user ${state.userId}`);

    if (!state.strategy) {
      throw new Error(
        '[OfferOptimizationAgent] state.strategy is missing — StrategyDecisionAgent must run first.'
      );
    }

    let { discount, bundle, reason } = state.strategy;
    const bundleKey = bundle[0] ?? '';

    // ── Phase 3: Competitor pricing adjustments ───────────────────────────────
    const cf = state.competitor_factors;
    if (cf && cf.avgCompetitorPrice > 0) {
      // If competitor price is lower by >5%, increase our discount by 5%
      // (We use expectedOrderValue as proxy for our price when no catalogue price exists)
      const ourPrice       = state.predictions?.expectedOrderValue ?? cf.avgCompetitorPrice;
      const priceDiffRatio = (cf.avgCompetitorPrice - ourPrice) / ourPrice;

      if (priceDiffRatio < -0.05) {
        const extraDiscount = 5;
        discount += extraDiscount;
        reason   += ` | Competitor undercuts by ${(Math.abs(priceDiffRatio) * 100).toFixed(1)}% — extra ${extraDiscount}% discount applied`;
        this.log(`Competitor undercut detected → discount bumped to ${discount}%`);
      }
    }

    // If seasonal factor > 1.2 — append a seasonal bundle
    if (cf && cf.maxSeasonalFactor > 1.2) {
      if (!bundle.includes('seasonal-bundle')) {
        bundle = [...bundle, 'seasonal-bundle'];
        this.log(`High seasonal factor (${cf.maxSeasonalFactor.toFixed(2)}) → seasonal bundle added`);
      }
    }

    // ── Headline lookup ───────────────────────────────────────────────────────
    const headline = HEADLINE_MAP[bundleKey] ?? DEFAULT_HEADLINE;

    // ── Copy hint for ExecutionAgent ──────────────────────────────────────────
    const copyHint =
      `Mention the ${discount}% discount naturally, keep tone aligned with customer's ` +
      `communication style, reference: "${headline}". Context: ${reason}`;

    this.log(`headline="${headline}"  discount=${discount}%  bundle=[${bundle.join(', ')}]`);

    return {
      ...state,
      strategy: { ...state.strategy, discount, bundle, reason },
      offer: {
        headline,
        discountPercent: discount,
        bundleItems:     bundle,
        copyHint,
      },
    };
  }
}
