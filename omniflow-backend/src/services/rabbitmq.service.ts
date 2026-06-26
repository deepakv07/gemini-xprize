import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import crypto from 'crypto';
import logger from '../lib/logger';
import type { AgentState } from '../types';

const QUEUE_NAME = 'agent_pipeline_queue';
const REPLY_QUEUE_NAME = 'agent_pipeline_reply';
const TIMEOUT_MS = 60_000; // 60 seconds timeout for agent pipeline

interface PendingRequest {
  resolve: (value: AgentState) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

class RabbitMQService {
  private connection: any = null;
  private clientChannel: any = null;
  private workerChannel: any = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isInitialized = false;

  /**
   * Initializes the RabbitMQ connection and sets up the RPC client channel and listener.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
    logger.info({ url }, '[RabbitMQ] Connecting…');

    try {
      this.connection = await amqp.connect(url);
      logger.info('[RabbitMQ] Connection established');

      // ─── Setup RPC Client Channel ──────────────────────────────────────────
      this.clientChannel = await this.connection.createChannel();
      
      // Assert request queue
      await this.clientChannel.assertQueue(QUEUE_NAME, { durable: true });

      // Assert shared reply-to queue
      await this.clientChannel.assertQueue(REPLY_QUEUE_NAME, {
        durable: false,
        exclusive: false,
        autoDelete: true,
      });

      // Start listening for RPC responses
      await this.clientChannel.consume(
        REPLY_QUEUE_NAME,
        (msg: ConsumeMessage | null) => this.handleRPCResponse(msg),
        { noAck: true }
      );

      logger.info('[RabbitMQ] RPC Client initialized and listening for replies');
      this.isInitialized = true;
    } catch (err) {
      const error = err as Error;
      logger.error({ err: error.message, stack: error.stack }, '[RabbitMQ] Initialization failed');
      throw error;
    }
  }

  /**
   * Disconnects RabbitMQ channels and connections gracefully.
   */
  async disconnect(): Promise<void> {
    logger.info('[RabbitMQ] Closing connections…');
    
    // Clear any pending timeouts
    for (const [corrId, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timeout);
      req.reject(new Error('RabbitMQ service is disconnecting'));
    }
    this.pendingRequests.clear();

    try {
      if (this.clientChannel) {
        await this.clientChannel.close();
        this.clientChannel = null;
      }
      if (this.workerChannel) {
        await this.workerChannel.close();
        this.workerChannel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.isInitialized = false;
      logger.info('[RabbitMQ] Disconnected successfully');
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[RabbitMQ] Error during disconnect');
    }
  }

  /**
   * Publishes an AgentState to the work queue and waits asynchronously for the processed result.
   */
  async publishAndReceive(state: AgentState): Promise<AgentState> {
    if (!this.isInitialized || !this.clientChannel) {
      await this.initialize();
    }

    const channel = this.clientChannel!;
    const correlationId = crypto.randomUUID();

    return new Promise<AgentState>((resolve, reject) => {
      // Set a safety timeout so the HTTP request doesn't hang forever
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`[RabbitMQ] RPC timeout of ${TIMEOUT_MS}ms exceeded for job ${correlationId}`));
      }, TIMEOUT_MS);

      // Save the callbacks in the pending map
      this.pendingRequests.set(correlationId, { resolve, reject, timeout });

      const payload = Buffer.from(JSON.stringify(state));
      
      logger.info({ correlationId }, '[RabbitMQ] Publishing job to queue');
      
      channel.sendToQueue(QUEUE_NAME, payload, {
        correlationId,
        replyTo: REPLY_QUEUE_NAME,
        persistent: true,
      });
    });
  }

  /**
   * Starts a background worker that consumes from the work queue,
   * runs the processor (agent graph), and returns the results.
   */
  async startWorker(processor: (state: AgentState) => Promise<AgentState>): Promise<void> {
    if (!this.connection) {
      const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
      this.connection = await amqp.connect(url);
    }

    try {
      this.workerChannel = await this.connection.createChannel();
      const channel = this.workerChannel;

      await channel.assertQueue(QUEUE_NAME, { durable: true });
      await channel.prefetch(10); // Process up to 10 jobs in parallel per worker

      logger.info('[RabbitMQ] Starting worker consumer…');

      await channel.consume(
        QUEUE_NAME,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          const { replyTo, correlationId } = msg.properties;
          const payloadStr = msg.content.toString();
          
          logger.info({ correlationId }, '[RabbitMQ Worker] Received job');

          try {
            const initialState = JSON.parse(payloadStr) as AgentState;
            
            // Execute the agent pipeline graph
            const finalState = await processor(initialState);

            // ── Phase 3: WhatsApp reply ──────────────────────────────────────
            if (finalState.channel === 'whatsapp' && finalState.response && finalState.userId) {
              try {
                const { default: whatsappService } = await import('../services/whatsapp.service');
                await whatsappService.sendMessage(finalState.userId, finalState.response);
                logger.info({ userId: finalState.userId }, '[RabbitMQ Worker] WhatsApp reply sent');
              } catch (waErr) {
                logger.warn({ err: (waErr as Error).message }, '[RabbitMQ Worker] WhatsApp send failed (non-fatal)');
              }
            }

            // Send reply if replyTo is specified
            if (replyTo && correlationId) {
              const replyPayload = Buffer.from(JSON.stringify(finalState));
              channel.sendToQueue(replyTo, replyPayload, { correlationId });
              logger.info({ correlationId, replyTo }, '[RabbitMQ Worker] Sent success reply');
            }
          } catch (err) {
            const error = err as Error;
            logger.error(
              { err: error.message, stack: error.stack, correlationId },
              '[RabbitMQ Worker] Job processing failed'
            );

            // If processing fails, reply with an error field so the client knows
            if (replyTo && correlationId) {
              const errorState: AgentState = {
                ...JSON.parse(payloadStr),
                response: `Error: Pipeline processing failed. ${error.message}`,
              };
              const replyPayload = Buffer.from(JSON.stringify(errorState));
              channel.sendToQueue(replyTo, replyPayload, { correlationId });
            }
          } finally {
            // Always acknowledge the message to remove it from the queue
            channel.ack(msg);
          }
        },
        { noAck: false }
      );

      logger.info('[RabbitMQ] Worker consumer started successfully ✓');
    } catch (err) {
      const error = err as Error;
      logger.error({ err: error.message, stack: error.stack }, '[RabbitMQ] Worker startup failed');
      throw error;
    }
  }

  /**
   * Handles incoming RPC replies on the reply queue.
   */
  private handleRPCResponse(msg: ConsumeMessage | null): void {
    if (!msg) return;

    const correlationId = msg.properties.correlationId as string;
    if (!correlationId) return;

    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      logger.warn({ correlationId }, '[RabbitMQ] Received reply for unknown or timed-out correlation ID');
      return;
    }

    // Clear the safety timeout and remove from map
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(correlationId);

    try {
      const resultState = JSON.parse(msg.content.toString()) as AgentState;
      logger.info({ correlationId }, '[RabbitMQ] Received RPC reply successfully');
      pending.resolve(resultState);
    } catch (err) {
      logger.error({ err: (err as Error).message, correlationId }, '[RabbitMQ] Failed to parse RPC reply');
      pending.reject(new Error('Failed to parse the RPC reply from the worker'));
    }
  }
}

export const rabbitmqService = new RabbitMQService();
export default rabbitmqService;
