import { FeedbackAgent } from '../feedback.agent';
import type { PrismaClient } from '@prisma/client';

describe('FeedbackAgent', () => {
  let mockPrisma: any;
  let agent: FeedbackAgent;

  beforeEach(() => {
    mockPrisma = {
      strategy: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      feedback: {
        create: jest.fn(),
      },
      prediction: {
        findFirst: jest.fn(),
      },
    };
    agent = new FeedbackAgent(mockPrisma as unknown as PrismaClient);
  });

  const userId = '12345678-1234-1234-1234-123456789012';
  const strategyId = '87654321-4321-4321-4321-210987654321';

  it('should throw an error if strategy is not found', async () => {
    mockPrisma.strategy.findUnique.mockResolvedValue(null);
    await expect(agent.process(userId, strategyId, 'PURCHASE')).rejects.toThrow('Strategy ' + strategyId + ' not found');
  });

  it('should process PURCHASE outcome successfully and map reward value to 1', async () => {
    const mockStrategy = {
      id: strategyId,
      userId,
      recommendedAction: {
        discount: 0.1,
        bundle: ['SpecialBundle'],
        reason: 'test',
      },
    };

    mockPrisma.strategy.findUnique.mockResolvedValue(mockStrategy);
    mockPrisma.feedback.create.mockResolvedValue({ id: 'feedback-123', rewardValue: 1 });
    mockPrisma.strategy.update.mockResolvedValue({});
    mockPrisma.prediction.findFirst.mockResolvedValue({ segment: 'high-value' });

    const result = await agent.process(userId, strategyId, 'PURCHASE');

    expect(result.rewardValue).toBe(1);
    expect(result.segment).toBe('high-value');
    expect(result.action).toBe('SpecialBundle');
    expect(result.productName).toBe('SpecialBundle');
    expect(mockPrisma.feedback.create).toHaveBeenCalledWith({
      data: {
        strategyId,
        userId,
        outcome: 'PURCHASE',
        rewardValue: 1,
      },
    });
    expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
      where: { id: strategyId },
      data: {
        applied: true,
        outcome: 'purchase',
      },
    });
  });

  it('should process REJECT outcome successfully and map reward value to -1', async () => {
    const mockStrategy = {
      id: strategyId,
      userId,
      recommendedAction: {
        discount: 0.1,
        bundle: [],
        reason: 'test',
      },
    };

    mockPrisma.strategy.findUnique.mockResolvedValue(mockStrategy);
    mockPrisma.feedback.create.mockResolvedValue({ id: 'feedback-123', rewardValue: -1 });
    mockPrisma.strategy.update.mockResolvedValue({});
    mockPrisma.prediction.findFirst.mockResolvedValue(null); // defaults to 'new'

    const result = await agent.process(userId, strategyId, 'REJECT');

    expect(result.rewardValue).toBe(-1);
    expect(result.segment).toBe('new');
    expect(result.action).toBe('default');
    expect(result.productName).toBe('unknown-product');
  });

  it('should process IGNORE outcome successfully and map reward value to 0', async () => {
    const mockStrategy = {
      id: strategyId,
      userId,
      recommendedAction: {
        discount: 0,
        bundle: ['DiscountCoupon'],
        reason: 'test',
      },
    };

    mockPrisma.strategy.findUnique.mockResolvedValue(mockStrategy);
    mockPrisma.feedback.create.mockResolvedValue({ id: 'feedback-123', rewardValue: 0 });
    mockPrisma.strategy.update.mockResolvedValue({});
    mockPrisma.prediction.findFirst.mockResolvedValue({ segment: 'at-risk' });

    const result = await agent.process(userId, strategyId, 'IGNORE');

    expect(result.rewardValue).toBe(0);
    expect(result.segment).toBe('at-risk');
    expect(result.action).toBe('DiscountCoupon');
  });
});
