import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { generateResponse } from '../services/openai.service';
import prisma from '../models';

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionAgent  (Phase 2 + Phase 3 KnowledgeGraph enrichment)
//
// Phase 2: Injects offer copyHint + headline into the GPT prompt.
// Phase 3: Before the GPT call, queries KnowledgeGraphAgent for related facts
//          and appends them to the system prompt for deeper personalization.
// ─────────────────────────────────────────────────────────────────────────────

type GenerateResponseFn = typeof generateResponse;

export class ExecutionAgent extends Agent {
  private readonly generateResponse: GenerateResponseFn;

  constructor(generateResponseFn: GenerateResponseFn) {
    super('ExecutionAgent');
    this.generateResponse = generateResponseFn;
  }

  async process(state: AgentState): Promise<AgentState> {
    this.log(`Generating response for user ${state.userId}`);

    try {
      // ── Phase 3: KnowledgeGraph enrichment (optional) ───────────────────────
      let kgContext = '';
      try {
        const { KnowledgeGraphAgent } = await import('./knowledgeGraph.agent');
        const kgAgent = new KnowledgeGraphAgent(prisma);
        const relatedFacts = await kgAgent.queryRelated(state.message, 5);

        if (relatedFacts.length > 0) {
          kgContext =
            '\n\nRelated knowledge about this customer:\n' +
            relatedFacts
              .map((f) => `- ${f.subject ?? ''} ${f.relation ?? ''} ${f.object ?? ''}`)
              .join('\n');

          this.log(`KG enrichment: ${relatedFacts.length} facts appended to prompt`);
        }
      } catch (kgErr) {
        // Non-fatal — KG failure must never block the response
        this.warn(`KG query failed (non-fatal): ${(kgErr as Error).message}`);
      }

      // ── Phase 2: Offer conditioning (optional) ──────────────────────────────
      let effectiveMessage = state.message;
      if (state.offer?.copyHint) {
        effectiveMessage =
          `[ASSISTANT INSTRUCTION — do not repeat this text verbatim to the user]: ` +
          `${state.offer.copyHint}. ` +
          `Offer headline context: "${state.offer.headline}".` +
          kgContext +
          `\n\n[CUSTOMER MESSAGE]: ${state.message}`;

        this.log(
          `Offer hint injected: discount=${state.offer.discountPercent}%  ` +
          `headline="${state.offer.headline}"`
        );
      } else if (kgContext) {
        // No offer but KG facts available — still enrich the prompt
        effectiveMessage =
          `[CONTEXT — do not repeat verbatim]:${kgContext}\n\n[CUSTOMER MESSAGE]: ${state.message}`;
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
      return {
        ...state,
        response:
          "I'm sorry, I'm having trouble responding right now. Please try again in a moment.",
      };
    }
  }
}
