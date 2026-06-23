import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import 'dotenv/config';
import type { RedisMessage } from './redis.service';
import type { CustomerProfile } from '../models';

// ─────────────────────────────────────────────────────────────────────────────
// Client Singleton
// ─────────────────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('[OpenAI] OPENAI_API_KEY is not set in environment variables.');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BehaviorExtraction {
  intent: string;
  sentiment: number; // -1.0 (very negative) → 1.0 (very positive)
  urgency: number;   //  0.0 (not urgent)    → 1.0 (extremely urgent)
}

/** Fallback returned when GPT output cannot be parsed */
const BEHAVIOR_FALLBACK: BehaviorExtraction = {
  intent: 'unknown',
  sentiment: 0,
  urgency: 0.5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert RedisMessage history to OpenAI chat messages */
function historyToChatMessages(history: RedisMessage[]): ChatCompletionMessageParam[] {
  return history.map((h) => ({
    role: h.sender === 'USER' ? 'user' : ('assistant' as const),
    content: h.message,
  }));
}

/** Clamp a number to [min, max] */
function clamp(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(n)) return (min + max) / 2;
  return Math.min(Math.max(n, min), max);
}

/** Extract the first JSON object from an arbitrary string */
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractBehavior
// ─────────────────────────────────────────────────────────────────────────────

const BEHAVIOR_SYSTEM_PROMPT = `You are a customer behaviour analysis engine.
Given a customer message and optional conversation history, respond ONLY with a
valid JSON object — no markdown, no explanation — in exactly this shape:

{
  "intent":    "<short label, e.g. 'price_inquiry' | 'complaint' | 'purchase_intent' | 'support_request' | 'greeting' | 'farewell' | 'unknown'>",
  "sentiment": <float from -1.0 (very negative) to 1.0 (very positive)>,
  "urgency":   <float from 0.0 (not urgent) to 1.0 (extremely urgent)>
}

Rules:
- intent must be a concise snake_case label (max 30 chars).
- sentiment must be in [-1.0, 1.0].
- urgency must be in [0.0, 1.0].
- Never add extra keys or prose.`;

/**
 * Calls GPT-4 to extract intent, sentiment, and urgency from a customer message.
 *
 * @param message - The latest customer message.
 * @param history - Recent conversation history for context (optional).
 * @returns Parsed {@link BehaviorExtraction} or a safe fallback on failure.
 */
export async function extractBehavior(
  message: string,
  history: RedisMessage[] = [],
): Promise<BehaviorExtraction> {
  try {
    const client = getClient();

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: BEHAVIOR_SYSTEM_PROMPT },
      ...historyToChatMessages(history.slice(-10)), // last 10 turns for context
      { role: 'user', content: message },
    ];

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      messages,
      temperature: 0.2,    // low variance — we want consistent structured output
      max_tokens: 150,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = extractJson(raw);

    if (!parsed) {
      console.warn('[OpenAI] extractBehavior: could not parse JSON from response:', raw);
      return BEHAVIOR_FALLBACK;
    }

    return {
      intent: typeof parsed.intent === 'string' ? parsed.intent.slice(0, 30) : 'unknown',
      sentiment: clamp(parsed.sentiment, -1, 1),
      urgency: clamp(parsed.urgency, 0, 1),
    };
  } catch (err) {
    console.error('[OpenAI] extractBehavior error:', (err as Error).message);
    return BEHAVIOR_FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. generateResponse
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a dynamic system prompt conditioned on the customer's profile.
 */
function buildResponseSystemPrompt(
  profile: Partial<CustomerProfile> | null,
  intent: string,
): string {
  const style = profile?.communicationStyle ?? 'neutral';
  const budgetSensitive = (profile?.budgetSensitivity ?? 0.5) > 0.7;
  const highValue = (profile?.lifetimeValue ?? 0) > 5000;

  return `You are a smart, helpful sales and support assistant for an e-commerce business.

Customer profile:
- Communication style: ${style}
- Budget sensitivity: ${budgetSensitive ? 'high (emphasise value and deals)' : 'normal'}
- Customer tier: ${highValue ? 'high-value (treat with extra care and personalisation)' : 'standard'}
- Detected intent: ${intent}

Guidelines:
- Match the customer's communication style (${style}): ${
    style === 'formal'
      ? 'use polite, professional language.'
      : style === 'casual'
        ? 'be friendly, relaxed, and conversational.'
        : 'be warm but professional.'
  }
- Keep replies concise and actionable (2–4 sentences unless more detail is needed).
- Never make up product information. If unsure, say you will check.
- Do NOT output JSON, markdown headers, or bullet points unless the customer asks.`;
}

/**
 * Generates a natural language reply conditioned on customer profile and context.
 *
 * @param message  - The customer's latest message.
 * @param profile  - CustomerProfile from Prisma (or null if not yet built).
 * @param history  - Recent conversation history for context.
 * @param intent   - Intent label from {@link extractBehavior}.
 * @returns Generated reply string, or a generic fallback on failure.
 */
export async function generateResponse(
  message: string,
  profile: Partial<CustomerProfile> | null,
  history: RedisMessage[] = [],
  intent = 'unknown',
): Promise<string> {
  const FALLBACK_REPLY =
    "Thank you for your message! I'm looking into this for you and will get back to you shortly.";

  try {
    const client = getClient();

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildResponseSystemPrompt(profile, intent) },
      ...historyToChatMessages(history.slice(-20)), // last 20 turns
      { role: 'user', content: message },
    ];

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      messages,
      temperature: 0.7,
      max_tokens: 512,
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      console.warn('[OpenAI] generateResponse: empty content in response');
      return FALLBACK_REPLY;
    }

    return reply;
  } catch (err) {
    console.error('[OpenAI] generateResponse error:', (err as Error).message);
    return FALLBACK_REPLY;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────────────────────────────────────

const openaiService = {
  extractBehavior,
  generateResponse,
};

export default openaiService;
