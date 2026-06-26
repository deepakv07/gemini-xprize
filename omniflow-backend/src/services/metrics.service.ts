import { Registry, Histogram, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Service  (Phase 4 — Prometheus)
//
// Exposes metrics at GET /metrics for Prometheus scraping.
//
// Metrics:
//   pipeline_duration_seconds  (histogram) — full pipeline time per message
//   agent_duration_seconds     (histogram) — per-agent execution time
//   messages_total             (counter)   — total messages by business + outcome
//   openai_tokens_total        (counter)   — tokens by type (prompt/completion)
//   active_conversations       (gauge)     — current active conversations in Redis
// ─────────────────────────────────────────────────────────────────────────────

export const registry = new Registry();

// Collect Node.js default metrics (heap, GC, event loop lag, etc.)
collectDefaultMetrics({ register: registry });

export const pipelineDuration = new Histogram({
  name:       'pipeline_duration_seconds',
  help:       'Full agent pipeline execution time in seconds',
  labelNames: ['business_id'] as const,
  buckets:    [0.1, 0.5, 1, 2, 5, 10, 30],
  registers:  [registry],
});

export const agentDuration = new Histogram({
  name:       'agent_duration_seconds',
  help:       'Per-agent execution time in seconds',
  labelNames: ['agent_name'] as const,
  buckets:    [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers:  [registry],
});

export const messagesTotal = new Counter({
  name:       'messages_total',
  help:       'Total messages processed',
  labelNames: ['business_id', 'outcome'] as const,
  registers:  [registry],
});

export const openaiTokensTotal = new Counter({
  name:       'openai_tokens_total',
  help:       'Total OpenAI tokens consumed',
  labelNames: ['type'] as const,  // 'prompt' | 'completion'
  registers:  [registry],
});

export const activeConversations = new Gauge({
  name:      'active_conversations',
  help:      'Current number of active conversations tracked in Redis',
  registers: [registry],
});

export const rabbitmqQueueDepth = new Gauge({
  name:      'rabbitmq_queue_depth',
  help:      'Messages currently waiting in the agent pipeline queue',
  registers: [registry],
});
