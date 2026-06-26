import { StateGraph, Annotation } from '@langchain/langgraph';
import logger from '../lib/logger';
import type { AgentState } from '../types';

// ── Services ──────────────────────────────────────────────────────────────────
import { extractBehavior, generateResponse } from './openai.service';
import { getConversationHistory } from './redis.service';
import prisma from '../models';

// ── Agents ────────────────────────────────────────────────────────────────────
import { MemoryAgent }                  from '../agents/memory.agent';
import { BehaviorAgent }                from '../agents/behavior.agent';
import { DigitalTwinAgent }             from '../agents/digitalTwin.agent';
import { RevenuePredictionAgent }       from '../agents/revenuePrediction.agent';
import { SegmentationAgent }            from '../agents/segmentation.agent';
import { CompetitorIntelligenceAgent }  from '../agents/competitorIntelligence.agent';
import { StrategyDecisionAgent }        from '../agents/strategyDecision.agent';
import { OfferOptimizationAgent }       from '../agents/offerOptimization.agent';
import { ExecutionAgent }               from '../agents/execution.agent';

// ── Agent Singletons ──────────────────────────────────────────────────────────
const memoryAgent               = new MemoryAgent(getConversationHistory, prisma);
const behaviorAgent             = new BehaviorAgent(extractBehavior);
const digitalTwinAgent          = new DigitalTwinAgent(prisma);
const revenuePredictionAgent    = new RevenuePredictionAgent(prisma);
const segmentationAgent         = new SegmentationAgent(prisma);
const competitorIntelAgent      = new CompetitorIntelligenceAgent(prisma);
const strategyDecisionAgent     = new StrategyDecisionAgent(prisma);
const offerOptimizationAgent    = new OfferOptimizationAgent();
const executionAgent            = new ExecutionAgent(generateResponse);

// ─── LangGraph State Annotation ──────────────────────────────────────────────
const AgentStateAnnotation = Annotation.Root({
  userId:              Annotation<string>(),
  businessId:          Annotation<string>(),
  message:             Annotation<string>(),
  history:             Annotation<any[]>(),
  profile:             Annotation<any>(),
  intent:              Annotation<string | null>(),
  sentiment:           Annotation<number | null>(),
  urgency:             Annotation<number | null>(),
  predictions:         Annotation<any>(),
  segment:             Annotation<string>(),
  competitor_factors:  Annotation<any>(),
  strategy:            Annotation<any>(),
  offer:               Annotation<any>(),
  response:            Annotation<string | null>(),
  channel:             Annotation<string | undefined>(),
});

// ─── LangGraph Definition ─────────────────────────────────────────────────────
// PIPELINE ORDER (Phase 3):
//   Memory → Behavior → DigitalTwin → Prediction → Segmentation
//   → CompetitorIntelligence → Strategy → Offer → Execution
const graph = new StateGraph(AgentStateAnnotation)
  .addNode('memory_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running MemoryAgent');
    const nextState = await memoryAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] MemoryAgent complete');
    return nextState;
  })
  .addNode('behavior_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running BehaviorAgent');
    const nextState = await behaviorAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] BehaviorAgent complete');
    return nextState;
  })
  .addNode('digitalTwin_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running DigitalTwinAgent');
    const nextState = await digitalTwinAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] DigitalTwinAgent complete');
    return nextState;
  })
  .addNode('prediction_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running RevenuePredictionAgent');
    const nextState = await revenuePredictionAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] RevenuePredictionAgent complete');
    return nextState;
  })
  .addNode('segmentation_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running SegmentationAgent');
    const nextState = await segmentationAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] SegmentationAgent complete');
    return nextState;
  })
  // ── Phase 3 new node ──────────────────────────────────────────────────────
  .addNode('competitor_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running CompetitorIntelligenceAgent');
    const nextState = await competitorIntelAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] CompetitorIntelligenceAgent complete');
    return nextState;
  })
  .addNode('strategy_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running StrategyDecisionAgent');
    const nextState = await strategyDecisionAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] StrategyDecisionAgent complete');
    return nextState;
  })
  .addNode('offer_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running OfferOptimizationAgent');
    const nextState = await offerOptimizationAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] OfferOptimizationAgent complete');
    return nextState;
  })
  .addNode('execution_node', async (state) => {
    logger.info({ userId: state.userId }, '[AgentGraph] Running ExecutionAgent');
    const nextState = await executionAgent.process(state as AgentState);
    logger.info({ userId: state.userId }, '[AgentGraph] ExecutionAgent complete');
    return nextState;
  });

// ── Edges ──────────────────────────────────────────────────────────────────────
graph.addEdge('__start__',        'memory_node');
graph.addEdge('memory_node',      'behavior_node');
graph.addEdge('behavior_node',    'digitalTwin_node');
graph.addEdge('digitalTwin_node', 'prediction_node');
graph.addEdge('prediction_node',  'segmentation_node');

// Conditional routing after segmentation:
//   purchaseProbability >= 0.25 → competitor → strategy → offer → execution
//   purchaseProbability <  0.25 → execution  (skip strategy/offer)
graph.addConditionalEdges(
  'segmentation_node',
  (state) => {
    const probability = state.predictions?.purchaseProbability ?? 0;
    logger.info({ userId: state.userId, probability }, '[AgentGraph] Conditional routing check');

    if (probability >= 0.25) {
      logger.info({ userId: state.userId }, '[AgentGraph] Routing → competitor_node');
      return 'competitor_node';
    } else {
      logger.info({ userId: state.userId }, '[AgentGraph] Low probability — routing → execution_node');
      return 'execution_node';
    }
  },
  {
    competitor_node: 'competitor_node',
    execution_node:  'execution_node',
  }
);

graph.addEdge('competitor_node', 'strategy_node');
graph.addEdge('strategy_node',   'offer_node');
graph.addEdge('offer_node',      'execution_node');
graph.addEdge('execution_node',  '__end__');

// ── Compile ────────────────────────────────────────────────────────────────────
const compiledGraph = graph.compile();

/**
 * Executes the full 9-node agent pipeline (Phase 3: adds CompetitorIntelligenceAgent).
 * WhatsApp reply is handled by the RabbitMQ worker after this returns.
 */
export async function runAgentGraph(initialState: AgentState): Promise<AgentState> {
  logger.info({ userId: initialState.userId }, '[AgentGraph] Starting pipeline');
  const finalState = await compiledGraph.invoke(initialState);
  logger.info({ userId: initialState.userId }, '[AgentGraph] Pipeline complete');
  return finalState as AgentState;
}

export default runAgentGraph;
