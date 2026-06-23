import Redis, { RedisOptions } from 'ioredis';
import 'dotenv/config';

// ─────────────────────────────────────────────────────────────────────────────
// Redis Key Helpers
// ─────────────────────────────────────────────────────────────────────────────
const KEYS = {
  conversation: (userId: string) => `conv:${userId}`,
  state: (userId: string) => `state:${userId}`,
} as const;

/** Maximum number of messages kept per conversation list */
const CONV_MAX_LENGTH = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RedisMessage {
  sender: 'USER' | 'BOT';
  message: string;
  timestamp: string;
  intent?: string | null;
  sentiment?: number | null;
  urgency?: number | null;
}

export type UserState = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Client Singleton
// ─────────────────────────────────────────────────────────────────────────────

let client: Redis | null = null;

function buildOptions(): RedisOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    // Reconnect with exponential back-off (max 10 s)
    retryStrategy: (times: number) => Math.min(times * 200, 10_000),
    // Lazy connect so we control when the socket opens
    lazyConnect: true,
    enableReadyCheck: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// connect()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the Redis connection.
 * Safe to call multiple times — returns the existing client on subsequent calls.
 */
export async function connect(): Promise<Redis> {
  if (client && client.status === 'ready') {
    return client;
  }

  const redis = new Redis(buildOptions());

  redis.on('connect', () => console.log('[Redis] Connected'));
  redis.on('ready', () => console.log('[Redis] Ready'));
  redis.on('error', (err: Error) => console.error('[Redis] Error:', err.message));
  redis.on('close', () => console.warn('[Redis] Connection closed'));
  redis.on('reconnecting', () => console.log('[Redis] Reconnecting…'));

  await redis.connect();

  client = redis;
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper — get the connected client or throw
// ─────────────────────────────────────────────────────────────────────────────

function getClient(): Redis {
  if (!client || client.status !== 'ready') {
    throw new Error('[Redis] Client is not connected. Call connect() first.');
  }
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation History  —  key: conv:{userId}  (Redis List)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the last {@link CONV_MAX_LENGTH} messages for a user.
 * Messages are stored as JSON strings in a Redis List (newest at the right end).
 */
export async function getConversationHistory(userId: string): Promise<RedisMessage[]> {
  try {
    const redis = getClient();
    const key = KEYS.conversation(userId);

    // LRANGE -50 -1  → last 50 entries
    const raw = await redis.lrange(key, -CONV_MAX_LENGTH, -1);
    return raw.map((item) => JSON.parse(item) as RedisMessage);
  } catch (err) {
    console.error(`[Redis] getConversationHistory(${userId}):`, (err as Error).message);
    throw err;
  }
}

/**
 * Appends a message to the conversation list and trims it to the last
 * {@link CONV_MAX_LENGTH} entries atomically.
 */
export async function appendMessage(userId: string, message: RedisMessage): Promise<void> {
  try {
    const redis = getClient();
    const key = KEYS.conversation(userId);

    const pipeline = redis.pipeline();
    pipeline.rpush(key, JSON.stringify(message));
    // Keep only the most recent CONV_MAX_LENGTH messages
    pipeline.ltrim(key, -CONV_MAX_LENGTH, -1);
    await pipeline.exec();
  } catch (err) {
    console.error(`[Redis] appendMessage(${userId}):`, (err as Error).message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User State  —  key: state:{userId}  (Redis Hash / JSON string)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieves the full state object for a user.
 * Returns `null` if no state has been set yet.
 */
export async function getState(userId: string): Promise<UserState | null> {
  try {
    const redis = getClient();
    const raw = await redis.get(KEYS.state(userId));
    if (!raw) return null;
    return JSON.parse(raw) as UserState;
  } catch (err) {
    console.error(`[Redis] getState(${userId}):`, (err as Error).message);
    throw err;
  }
}

/**
 * Persists a state object for a user.
 * @param userId   - The user's ID.
 * @param state    - Any serialisable object.
 * @param ttlSecs  - Optional TTL in seconds (default: 24 hours).
 */
export async function setState(
  userId: string,
  state: UserState,
  ttlSecs = 86_400,
): Promise<void> {
  try {
    const redis = getClient();
    await redis.set(KEYS.state(userId), JSON.stringify(state), 'EX', ttlSecs);
  } catch (err) {
    console.error(`[Redis] setState(${userId}):`, (err as Error).message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────────────────────────────────────

export interface RedisHealthResult {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * Sends a PING to Redis and measures round-trip latency.
 * Safe to call from a health-check route without throwing.
 */
export async function healthCheck(): Promise<RedisHealthResult> {
  try {
    const redis = getClient();
    const start = Date.now();
    const pong = await redis.ping();
    const latencyMs = Date.now() - start;

    if (pong !== 'PONG') {
      return { status: 'error', error: `Unexpected PING response: ${pong}` };
    }

    return { status: 'ok', latencyMs };
  } catch (err) {
    return { status: 'error', error: (err as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect (for graceful shutdown)
// ─────────────────────────────────────────────────────────────────────────────

export async function disconnect(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    console.log('[Redis] Disconnected');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default export — named function group for convenient import
// ─────────────────────────────────────────────────────────────────────────────

const redisService = {
  connect,
  disconnect,
  getConversationHistory,
  appendMessage,
  getState,
  setState,
  healthCheck,
};

export default redisService;
