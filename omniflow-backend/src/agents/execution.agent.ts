import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { generateResponse } from '../services/openai.service';

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionAgent
//
// Terminal agent in the pipeline: calls openai.service.generateResponse with
// the enriched state (profile + history + intent) and stores the reply in
// state.response.
//
// Phase 2 addition: if state.offer is present, the offer's copyHint and
// headline are prepended to the user message as an invisible instruction to the
// model. This keeps openai.service.ts unchanged (per spec — Step 6 only
// modifies this file and message.controller.ts).
//
// When state.offer is undefined, the agent behaves identically to Phase 1.
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
      // ── Phase 2: Offer conditioning (optional) ──────────────────────────────
      // If an offer is present, we inject the copyHint + headline as a silent
      // instruction prefix so the model naturally weaves the discount into its
      // reply rather than outputting it as a raw phrase.
      // Uses optional chaining throughout — absent offer causes zero errors.
      let effectiveMessage = state.message;
      if (state.offer?.copyHint) {
        effectiveMessage =
          `[ASSISTANT INSTRUCTION — do not repeat this text verbatim to the user]: ` +
          `${state.offer.copyHint}. ` +
          `Offer headline context: "${state.offer.headline}". ` +
          `\n\n[CUSTOMER MESSAGE]: ${state.message}`;
        this.log(
          `Offer hint injected: discount=${state.offer.discountPercent}%  ` +
          `headline="${state.offer.headline}"`,
        );
      }

      const response = await this.generateResponse(
        effectiveMessage,
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
