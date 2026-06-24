import { Agent } from './base.agent';
import type { AgentState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// OfferOptimizationAgent
//
// Deterministic transform only — no OpenAI calls, no ML, no DB writes.
// Takes the strategy from StrategyDecisionAgent and constructs a customer-facing
// offer with: headline, discountPercent, bundleItems, and a copyHint that tells
// ExecutionAgent how to weave the offer into its response naturally.
//
// The offer is ephemeral — it lives only in AgentState for this request.
// ─────────────────────────────────────────────────────────────────────────────

/** Maps bundle[0] code → customer-facing headline */
const HEADLINE_MAP: Record<string, string> = {
  'welcome-offer':          'Welcome! Here\'s something special for you',
  'win-back-offer':         'We miss you — here\'s an exclusive offer to come back',
  'loyalty-bonus':          'A thank-you just for our loyal customers',
  'repeat-purchase-bundle': 'Your favorites, bundled and discounted',
  'value-bundle':           'Smart savings on what you already love',
};

const DEFAULT_HEADLINE = 'A special offer just for you';

export class OfferOptimizationAgent extends Agent {
  constructor() {
    super('OfferOptimizationAgent');
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Building offer for user ${state.userId}`);

    // ── Guard ─────────────────────────────────────────────────────────────────
    if (!state.strategy) {
      throw new Error(
        '[OfferOptimizationAgent] state.strategy is missing — StrategyDecisionAgent must run before OfferOptimizationAgent.',
      );
    }

    const { discount, bundle, reason } = state.strategy;
    const bundleKey = bundle[0] ?? '';

    // ── Headline lookup ───────────────────────────────────────────────────────
    const headline = HEADLINE_MAP[bundleKey] ?? DEFAULT_HEADLINE;

    // ── Copy hint for ExecutionAgent ──────────────────────────────────────────
    // This is an instruction string that ExecutionAgent uses to naturally weave
    // the offer into its response — not a raw phrase to insert verbatim.
    const copyHint =
      `Mention the ${discount}% discount naturally, keep tone aligned with customer's ` +
      `communication style, reference: "${headline}". Context: ${reason}`;

    this.log(
      `headline="${headline}"  discount=${discount}%  bundle=[${bundle.join(', ')}]`,
    );

    return {
      ...state,
      offer: {
        headline,
        discountPercent: discount,
        bundleItems:     bundle,
        copyHint,
      },
    };
  }
}
