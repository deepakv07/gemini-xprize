import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { extractBehavior } from '../services/openai.service';

// ─────────────────────────────────────────────────────────────────────────────
// BehaviorAgent
//
// Calls openai.service.extractBehavior with the current message + history and
// merges the resulting { intent, sentiment, urgency } back into state.
// ─────────────────────────────────────────────────────────────────────────────

type ExtractBehaviorFn = typeof extractBehavior;

export class BehaviorAgent extends Agent {
  private readonly extractBehavior: ExtractBehaviorFn;

  /**
   * @param extractBehaviorFn  - Injected from openai.service (not imported directly).
   */
  constructor(extractBehaviorFn: ExtractBehaviorFn) {
    super('BehaviorAgent');
    this.extractBehavior = extractBehaviorFn;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Extracting behaviour for user ${state.userId}`);

    try {
      const behavior = await this.extractBehavior(state.message, state.history);

      this.log(
        `intent=${behavior.intent}  sentiment=${behavior.sentiment.toFixed(2)}  urgency=${behavior.urgency.toFixed(2)}`,
      );

      return {
        ...state,
        intent: behavior.intent,
        sentiment: behavior.sentiment,
        urgency: behavior.urgency,
      };
    } catch (err) {
      this.error('extractBehavior failed — keeping null values', err);
      return state; // pass through unchanged; pipeline continues with nulls
    }
  }
}
