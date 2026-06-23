import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { generateResponse } from '../services/openai.service';

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionAgent
//
// Terminal agent in the pipeline: calls openai.service.generateResponse with
// the enriched state (profile + history + intent) and stores the reply in
// state.response.
// ─────────────────────────────────────────────────────────────────────────────

type GenerateResponseFn = typeof generateResponse;

export class ExecutionAgent extends Agent {
  private readonly generateResponse: GenerateResponseFn;

  /**
   * @param generateResponseFn  - Injected from openai.service (not imported directly).
   */
  constructor(generateResponseFn: GenerateResponseFn) {
    super('ExecutionAgent');
    this.generateResponse = generateResponseFn;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Generating response for user ${state.userId}`);

    try {
      const response = await this.generateResponse(
        state.message,
        state.profile ?? null,
        state.history,
        state.intent ?? 'unknown',
      );

      this.log(`Response generated (${response.length} chars)`);

      return { ...state, response };
    } catch (err) {
      this.error('generateResponse failed', err);

      // Provide a safe fallback so callers always get a non-null response.
      return {
        ...state,
        response:
          "I'm sorry, I'm having trouble responding right now. Please try again in a moment.",
      };
    }
  }
}
