import { SegmentationAgent } from '../segmentation.agent';
import type { AgentState } from '../../types';
import type { PrismaClient } from '@prisma/client';

describe('SegmentationAgent', () => {
  let mockPrisma: any;
  let agent: SegmentationAgent;

  beforeEach(() => {
    mockPrisma = {
      prediction: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    agent = new SegmentationAgent(mockPrisma as unknown as PrismaClient);
  });

  const baseState: AgentState = {
    userId: '12345678-1234-1234-1234-123456789012',
    businessId: '87654321-4321-4321-4321-210987654321',
    message: 'Hello',
    history: [],
    profile: null,
    intent: null,
    sentiment: null,
    urgency: null,
    response: null,
  };

  it('should throw an error if state.predictions is missing', async () => {
    const state = { ...baseState, profile: {} };
    await expect(agent.process(state)).rejects.toThrow('state.predictions is missing');
  });

  it('should throw an error if state.profile is missing', async () => {
    const state = { ...baseState, predictions: { purchaseProbability: 0.5, expectedOrderValue: 100, ltv: 50 } };
    await expect(agent.process(state)).rejects.toThrow('state.profile is null');
  });

  it('Rule 1: at-risk (purchaseProbability < 0.2 AND buyingFrequency < 0.3)', async () => {
    const state: AgentState = {
      ...baseState,
      predictions: { purchaseProbability: 0.15, expectedOrderValue: 50, ltv: 100 },
      profile: { buyingFrequency: 0.25, budgetSensitivity: 0.5 },
    };

    mockPrisma.prediction.findFirst.mockResolvedValue({ id: 'pred-123' });
    mockPrisma.prediction.update.mockResolvedValue({});

    const result = await agent.process(state);
    expect(result.segment).toBe('at-risk');
    expect(mockPrisma.prediction.update).toHaveBeenCalledWith({
      where: { id: 'pred-123' },
      data: { segment: 'at-risk' },
    });
  });

  it('Rule 2: high-value (ltv > 5000 OR purchaseProbability > 0.7)', async () => {
    // case 1: ltv > 5000
    let state: AgentState = {
      ...baseState,
      predictions: { purchaseProbability: 0.5, expectedOrderValue: 100, ltv: 6000 },
      profile: { buyingFrequency: 0.5, budgetSensitivity: 0.5 },
    };

    mockPrisma.prediction.findFirst.mockResolvedValue({ id: 'pred-123' });

    let result = await agent.process(state);
    expect(result.segment).toBe('high-value');

    // case 2: purchaseProbability > 0.7
    state = {
      ...baseState,
      predictions: { purchaseProbability: 0.85, expectedOrderValue: 100, ltv: 200 },
      profile: { buyingFrequency: 0.5, budgetSensitivity: 0.5 },
    };
    result = await agent.process(state);
    expect(result.segment).toBe('high-value');
  });

  it('Rule 3: frequent-buyer (buyingFrequency > 0.6)', async () => {
    const state: AgentState = {
      ...baseState,
      predictions: { purchaseProbability: 0.5, expectedOrderValue: 100, ltv: 200 },
      profile: { buyingFrequency: 0.7, budgetSensitivity: 0.5 },
    };

    mockPrisma.prediction.findFirst.mockResolvedValue(null);

    const result = await agent.process(state);
    expect(result.segment).toBe('frequent-buyer');
  });

  it('Rule 4: price-sensitive (budgetSensitivity > 0.7)', async () => {
    const state: AgentState = {
      ...baseState,
      predictions: { purchaseProbability: 0.5, expectedOrderValue: 100, ltv: 200 },
      profile: { buyingFrequency: 0.5, budgetSensitivity: 0.8 },
    };

    mockPrisma.prediction.findFirst.mockResolvedValue(null);

    const result = await agent.process(state);
    expect(result.segment).toBe('price-sensitive');
  });

  it('Rule 5: new (default case)', async () => {
    const state: AgentState = {
      ...baseState,
      predictions: { purchaseProbability: 0.5, expectedOrderValue: 100, ltv: 200 },
      profile: { buyingFrequency: 0.5, budgetSensitivity: 0.5 },
    };

    mockPrisma.prediction.findFirst.mockResolvedValue(null);

    const result = await agent.process(state);
    expect(result.segment).toBe('new');
  });
});
