import { ReinforcementLearningAgent } from '../reinforcementLearning.agent';
import { getClient } from '../../services/redis.service';

jest.mock('../../services/redis.service', () => ({
  getClient: jest.fn(),
}));

describe('ReinforcementLearningAgent', () => {
  let agent: ReinforcementLearningAgent;
  let mockRedis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
    };
    (getClient as jest.Mock).mockReturnValue(mockRedis);
    agent = new ReinforcementLearningAgent();
  });

  describe('getBestAction', () => {
    it('should return null if no policy exists in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);
      const action = await agent.getBestAction('high-value');
      expect(action).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith('rl:policy:high-value');
    });

    it('should return the action with the highest Q-value', async () => {
      const qTable = {
        actionA: 0.5,
        actionB: 0.9,
        actionC: 0.2,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(qTable));

      const action = await agent.getBestAction('high-value');
      expect(action).toBe('actionB');
    });

    it('should return null if policy is empty', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({}));

      const action = await agent.getBestAction('high-value');
      expect(action).toBeNull();
    });

    it('should return null and not throw if Redis get fails', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

      const action = await agent.getBestAction('high-value');
      expect(action).toBeNull();
    });
  });

  describe('updatePolicy', () => {
    it('should initialize and update Q-value if no policy exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      // Reward = 1, currentQ = 0, maxQ = 0
      // newQ = 0 + 0.1 * (1 + 0.9 * 0 - 0) = 0.1
      await agent.updatePolicy('new-users', 'discount_10', 1);

      expect(mockRedis.get).toHaveBeenCalledWith('rl:policy:new-users');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'rl:policy:new-users',
        JSON.stringify({ discount_10: 0.1 }),
        'EX',
        2592000 // 30 days
      );
    });

    it('should update Q-value using Bellman equation when policy exists', async () => {
      const existingQTable = {
        discount_10: 0.5,
        discount_20: 0.8,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(existingQTable));

      // We update discount_10 with reward = 1.
      // currentQ = 0.5
      // maxQ = 0.8 (max of existing actions: 0.5 and 0.8)
      // newQ = 0.5 + 0.1 * (1 + 0.9 * 0.8 - 0.5) = 0.5 + 0.1 * (1 + 0.72 - 0.5) = 0.5 + 0.1 * 1.22 = 0.622
      await agent.updatePolicy('new-users', 'discount_10', 1);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'rl:policy:new-users',
        JSON.stringify({ discount_10: 0.622, discount_20: 0.8 }),
        'EX',
        2592000
      );
    });

    it('should catch and log error if update fails', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis write failed'));

      // Should not throw
      await expect(agent.updatePolicy('new-users', 'discount_10', 1)).resolves.not.toThrow();
    });
  });
});
