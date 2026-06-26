import logger from '../lib/logger';
import { getClient } from '../services/redis.service';


// ─────────────────────────────────────────────────────────────────────────────
// ReinforcementLearningAgent
//
// Stores a Q-table in Redis keyed by customer segment:
//   key:  rl:policy:{segment}
//   val:  JSON object — { [action: string]: number (Q-value) }
//
// Q-Learning formula:
//   Q(s,a) = Q(s,a) + alpha * (reward + gamma * maxQ(s') - Q(s,a))
//   alpha = 0.1  (learning rate)
//   gamma = 0.9  (discount factor)
//
// getBestAction(segment) → the action with the highest Q-value, or null
// updatePolicy(segment, action, reward) → updates Q-table in Redis
// ─────────────────────────────────────────────────────────────────────────────

const ALPHA = 0.1; // learning rate
const GAMMA = 0.9; // discount factor

export class ReinforcementLearningAgent {
  /**
   * Returns the action with the highest Q-value for a given segment,
   * or null if no policy has been learned yet.
   */
  async getBestAction(segment: string): Promise<string | null> {
    try {
      const key   = `rl:policy:${segment}`;
      const redis = getClient();
      const raw   = await redis.get(key);

      if (!raw) {
        logger.info({ segment }, '[RLAgent] No policy found for segment');
        return null;
      }

      const qTable = JSON.parse(raw) as Record<string, number>;
      const entries = Object.entries(qTable);

      if (entries.length === 0) return null;

      // Find action with highest Q-value
      const [bestAction] = entries.reduce((best, curr) =>
        curr[1] > best[1] ? curr : best
      );

      logger.info({ segment, bestAction, qTable }, '[RLAgent] Best action selected');
      return bestAction;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[RLAgent] getBestAction error — falling back to rule-based');
      return null;
    }
  }

  /**
   * Update the Q-value for a (segment, action) pair using the Bellman equation.
   */
  async updatePolicy(segment: string, action: string, reward: number): Promise<void> {
    try {
      const key   = `rl:policy:${segment}`;
      const redis = getClient();
      const raw   = await redis.get(key);

      const qTable: Record<string, number> = raw ? JSON.parse(raw) as Record<string, number> : {};

      // Current Q-value (default 0)
      const currentQ = qTable[action] ?? 0;

      // Max Q-value across all actions in this state (for future state estimate)
      const values = Object.values(qTable);
      const maxQ   = values.length > 0 ? Math.max(...values) : 0;

      // Bellman equation
      const newQ = currentQ + ALPHA * (reward + GAMMA * maxQ - currentQ);

      qTable[action] = newQ;

      // Persist updated table — TTL 30 days
      await redis.set(key, JSON.stringify(qTable), 'EX', 60 * 60 * 24 * 30);

      logger.info(
        { segment, action, reward, currentQ: currentQ.toFixed(4), newQ: newQ.toFixed(4) },
        '[RLAgent] Q-value updated'
      );
    } catch (err) {
      // Non-fatal — RL failure should never crash the pipeline
      logger.error({ err: (err as Error).message, segment, action }, '[RLAgent] updatePolicy error');
    }
  }
}

export const rlAgent = new ReinforcementLearningAgent();
export default rlAgent;
