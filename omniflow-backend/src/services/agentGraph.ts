import { StateGraph, Annotation } from '@langchain/langgraph';
import logger from '../lib/logger';
import type { AgentState } from '../types';

// ── Services ──────────────────────────────────────────────────────────────────
import { extractBehavior, generateResponse } from './openai.service';
import { getConversationHistory } from './redis.service';
import prisma from '../models';

// ── Agents ────────────────────────────────────────────────────────────────────
import { MemoryAgent }            from '../agents/memory.agent';
import { BehaviorAgent }          from '../agents/behavior.agent';
import { DigitalTwinAgent }       from '../agents/digitalTwin.agent';
import { RevenuePredictionAgent } from '../agents/revenuePrediction.agent';
import { SegmentationAgent }      from '../agents/segmentation.agent';
import { StrategyDecisionAgent }  from '../agents/strategyDecision.agent';
import { OfferOptimizationAgent } from '../agents/offerOptimization.agent';
import { ExecutionAgent }          from '../agents/execution.agent';

// ── Agent Singletons ──────────────────────────────────────────────────────────
const memoryAgent            = new MemoryAgent(getConversationHistory, prisma);
const behaviorAgent          = new BehaviorAgent(extractBehavior);
const digitalTwinAgent       = new DigitalTwinAgent(prisma);
const revenuePredictionAgent = new RevenuePredictionAgent(prisma);
const segmentationAgent      = new SegmentationAgent(prisma);
const strategyDecisionAgent  = new StrategyDecisionAgent(prisma);
const offerOptimizationAgent = new OfferOptimizationAgent();
const executionAgent         = new ExecutionAgent(generateResponse);

// ─── LangGraph State Annotation ──────────────────────────────────────────────
// This schema mirrors AgentState. In LangGraph, each channel represents a state property.
// By default, since we don't provide a custom reducer, updating a property will overwrite it.
const AgentStateAnnotation = Annotation.Root({
  userId: Annotation<string>(),
  businessId: Annotation<string>(),
  message: Annotation<string>(),
  history: Annotation<any[]>(),
  profile: Annotation<any>(),
  intent: Annotation<string | null>(),
  sentiment: Annotation<number | null>(),
  urgency: Annotation<number | null>(),
  predictions: Annotation<any>(),
  segment: Annotation<string>(),
  strategy: Annotation<any>(),
  offer: Annotation<any>(),
  response: Annotation<string | null>(),
});

// ─── LangGraph Definition ────────────────────────────────────────────────────
const graph = new StateGraph(AgentStateAnnotation)
  // 1. Define Nodes (using distinct names to avoid conflicts with state attribute keys)
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

// 2. Define Edges (Routing Logic)
graph.addEdge('__start__', 'memory_node');
graph.addEdge('memory_node', 'behavior_node');
graph.addEdge('behavior_node', 'digitalTwin_node');
graph.addEdge('digitalTwin_node', 'prediction_node');
graph.addEdge('prediction_node', 'segmentation_node');

// 3. Define Conditional Routing after Segmentation
// If purchase probability is >= 0.25, route to strategy and offer optimization.
// If purchase probability is < 0.25, skip strategy and offer, route straight to execution.
graph.addConditionalEdges(
  'segmentation_node',
  (state) => {
    const probability = state.predictions?.purchaseProbability ?? 0;
    logger.info({ userId: state.userId, probability }, '[AgentGraph] Conditional Routing Check');
    
    if (probability >= 0.25) {
      logger.info({ userId: state.userId }, '[AgentGraph] Routing to: strategy_node');
      return 'strategy_node';
    } else {
      logger.info({ userId: state.userId }, '[AgentGraph] Low purchase probability. Skipping strategy/offer. Routing to: execution_node');
      return 'execution_node';
    }
  },
  {
    strategy_node: 'strategy_node',
    execution_node: 'execution_node',
  }
);

// 4. Connect the remaining nodes
graph.addEdge('strategy_node', 'offer_node');
graph.addEdge('offer_node', 'execution_node');
graph.addEdge('execution_node', '__end__');

// 5. Compile the Graph State Machine
const compiledGraph = graph.compile();

/**
 * Executes the entire agent state-graph pipeline using LangGraph orchestration.
 * Handles sequential flow, conditional routing, and returns the final state.
 */
export async function runAgentGraph(initialState: AgentState): Promise<AgentState> {
  logger.info({ userId: initialState.userId }, '[AgentGraph] Starting state graph execution');
  const finalState = await compiledGraph.invoke(initialState);
  logger.info({ userId: initialState.userId }, '[AgentGraph] State graph execution complete');
  return finalState as AgentState;
}

export default runAgentGraph;
