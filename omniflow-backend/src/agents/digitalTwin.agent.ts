import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { CustomerProfile, PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// DigitalTwinAgent
//
// Maintains and evolves the CustomerProfile in Postgres:
//   1. Fetches the CustomerProfile for state.userId.
//   2. Creates a default profile if none exists yet.
//   3. Applies a simple behavioural rule: if the detected intent contains the
//      word "buy" or "purchase", nudge buyingFrequency up by 0.05 (capped at 1.0).
//   4. Saves the (possibly modified) profile back to Postgres.
//   5. Sets state.profile to the latest profile data.
// ─────────────────────────────────────────────────────────────────────────────

/** How much to increase buyingFrequency on a purchase-intent signal */
const BUYING_FREQ_NUDGE = 0.05;

/** Regex that matches buy / purchase anywhere in the intent string */
const PURCHASE_INTENT_RE = /\b(buy|purchase)\b/i;

export class DigitalTwinAgent extends Agent {
  private readonly prisma: PrismaClient;

  /**
   * @param prismaClient  - Injected Prisma client instance.
   */
  constructor(prismaClient: PrismaClient) {
    super('DigitalTwinAgent');
    this.prisma = prismaClient;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Processing digital twin for user ${state.userId}`);

    try {
      // ── 1. Fetch or create CustomerProfile ───────────────────────────────
      let profile = await this.prisma.customerProfile.findUnique({
        where: { userId: state.userId },
      });

      if (!profile) {
        this.log(`No profile found — creating defaults for user ${state.userId}`);
        profile = await this.prisma.customerProfile.create({
          data: {
            userId: state.userId,
            budgetSensitivity: 0.5,
            buyingFrequency: 0.5,
            preferredProducts: [],
            communicationStyle: 'neutral',
            responseSpeed: 0.5,
            lifetimeValue: 0,
          },
        });
      }

      // ── 2. Apply behavioural rules ────────────────────────────────────────
      const updatedProfile = this.applyRules(profile, state.intent);

      // ── 3. Persist if anything changed ───────────────────────────────────
      const changed = updatedProfile.buyingFrequency !== profile.buyingFrequency;

      if (changed) {
        await this.prisma.customerProfile.update({
          where: { userId: state.userId },
          data: { buyingFrequency: updatedProfile.buyingFrequency },
        });
        this.log(
          `buyingFrequency updated: ${profile.buyingFrequency.toFixed(3)} → ${updatedProfile.buyingFrequency.toFixed(3)}`,
        );
      } else {
        this.log('No profile changes to persist');
      }

      return { ...state, profile: updatedProfile };
    } catch (err) {
      this.error('Failed to process digital twin — profile will be null', err);
      return { ...state, profile: null };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Applies stateless, deterministic rules to a profile snapshot.
   * Returns a new object; never mutates the input.
   */
  private applyRules(
    profile: CustomerProfile,
    intent: string | null,
  ): CustomerProfile {
    if (!intent || !PURCHASE_INTENT_RE.test(intent)) {
      return profile;
    }

    const newFrequency = Math.min(profile.buyingFrequency + BUYING_FREQ_NUDGE, 1.0);
    return { ...profile, buyingFrequency: newFrequency };
  }
}
