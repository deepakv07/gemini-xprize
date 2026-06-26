import { Agent } from './base.agent';
import type { AgentState } from '../types';
import type { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import logger from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeGraphAgent
//
// Stores customer-product-season relationships as vector embeddings in Pinecone.
// Falls back gracefully if PINECONE_API_KEY is not set (logs a warning, skips).
//
// storeTriple(subject, relation, object)
//   → embed text, upsert to Pinecone index "omni-kg", save to Postgres
//
// queryRelated(query, topK=5)
//   → embed query, similarity search Pinecone, return matching facts
// ─────────────────────────────────────────────────────────────────────────────

interface PineconeMatch {
  id: string;
  score?: number;
  metadata?: Record<string, string>;
}

export class KnowledgeGraphAgent extends Agent {
  private readonly prisma: PrismaClient;
  private readonly openai: OpenAI;
  private pineconeIndex: any = null;
  private pineconeReady = false;

  constructor(prismaClient: PrismaClient) {
    super('KnowledgeGraphAgent');
    this.prisma = prismaClient;
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    void this.initPinecone();
  }

  private async initPinecone(): Promise<void> {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) {
      this.warn('PINECONE_API_KEY not set — KnowledgeGraphAgent will skip vector ops');
      return;
    }

    try {
      // Lazy import so the service still boots without Pinecone credentials
      const { Pinecone } = await import('@pinecone-database/pinecone');
      const pc = new Pinecone({ apiKey });
      this.pineconeIndex = pc.index('omni-kg');
      this.pineconeReady = true;
      this.log('Pinecone index "omni-kg" connected ✓');
    } catch (err) {
      this.warn(`Pinecone init failed — ${(err as Error).message}`);
    }
  }

  /** Embed text using OpenAI text-embedding-3-small (1536 dims) */
  private async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return res.data[0].embedding;
  }

  /**
   * Store a knowledge triple as a Pinecone vector + Postgres row.
   * Example: storeTriple("customer:abc", "PURCHASED", "product:blue-saree")
   */
  async storeTriple(subject: string, relation: string, object: string): Promise<void> {
    try {
      this.log(`Storing triple: ${subject} ${relation} ${object}`);
      const text    = `${subject} ${relation} ${object}`;
      const vector  = await this.embed(text);
      const vectorId = `${subject}-${relation}-${object}-${Date.now()}`.replace(/[^a-zA-Z0-9-_]/g, '_');

      // Upsert to Pinecone if available
      if (this.pineconeReady && this.pineconeIndex) {
        await this.pineconeIndex.upsert([{
          id:       vectorId,
          values:   vector,
          metadata: { subject, relation, object },
        }]);
        this.log(`Upserted vector ${vectorId} to Pinecone`);
      }

      // Always persist to Postgres
      await this.prisma.knowledgeGraph.create({
        data: { subject, relation, object, embeddingId: vectorId },
      });

      this.log(`KnowledgeGraph row saved for ${subject}`);
    } catch (err) {
      // Non-fatal — KG failure should not crash the pipeline
      this.warn(`storeTriple failed — ${(err as Error).message}`);
    }
  }

  /**
   * Query Pinecone for triples related to a query text.
   * Returns up to topK metadata objects or falls back to empty array.
   */
  async queryRelated(query: string, topK = 5): Promise<Array<Record<string, string>>> {
    if (!this.pineconeReady || !this.pineconeIndex) {
      this.log('Pinecone not ready — skipping vector query');
      return [];
    }

    try {
      const vector = await this.embed(query);
      const result = await this.pineconeIndex.query({
        vector,
        topK,
        includeMetadata: true,
      }) as { matches: PineconeMatch[] };

      const facts = (result.matches ?? [])
        .filter((m) => m.metadata)
        .map((m) => m.metadata as Record<string, string>);

      this.log(`queryRelated: found ${facts.length} related facts`);
      return facts;
    } catch (err) {
      this.warn(`queryRelated failed — ${(err as Error).message}`);
      return [];
    }
  }

  // Required by Agent base class but not used in pipeline
  async process(state: AgentState): Promise<AgentState> {
    return state;
  }
}
