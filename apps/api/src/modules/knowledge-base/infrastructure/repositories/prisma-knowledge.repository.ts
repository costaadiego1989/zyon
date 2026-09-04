import { Injectable, Inject, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  type KnowledgeRepositoryPort,
  type KnowledgeChunk,
} from "../../domain/ports/knowledge-repository.port.js";

interface KnowledgeChunkRow {
  id: string;
  merchant_id: string;
  source_type: string;
  source_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity?: number;
  embedding?: string;
}

@Injectable()
export class PrismaKnowledgeRepository implements KnowledgeRepositoryPort {
  private readonly logger = new Logger(PrismaKnowledgeRepository.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async upsertChunks(
    merchantId: string,
    sourceType: string,
    sourceId: string,
    chunks: {
      content: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
    }[]
  ): Promise<void> {
    if (!chunks.length) return;

    try {
      // Delete existing chunks for this source
      await this.prisma.$executeRaw`
        DELETE FROM knowledge_chunks
        WHERE merchant_id = ${merchantId}
        AND source_type = ${sourceType}
        AND source_id = ${sourceId}
      `;

      // Insert new chunks with embeddings
      for (const chunk of chunks) {
        const embeddingStr = JSON.stringify(chunk.embedding);
        const id = randomUUID();

        // Try to use pgvector if available, fallback to base64.
        // Vector dimension is taken from the embedding itself so the cast always
        // matches the active provider (384 local / 1536 OpenAI). length is a
        // trusted integer, safe to inline in the raw cast.
        const dim = chunk.embedding.length;
        try {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO knowledge_chunks (
              id, merchant_id, source_type, source_id, content, embedding, embedding_vec, metadata, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector(${dim}), $8::jsonb, NOW(), NOW())`,
            id,
            merchantId,
            sourceType,
            sourceId,
            chunk.content,
            embeddingStr,
            embeddingStr,
            chunk.metadata ? JSON.stringify(chunk.metadata) : null,
          );
        } catch {
          // Fallback: pgvector not available, use base64 only
          await this.prisma.$executeRaw`
            INSERT INTO knowledge_chunks (
              id, merchant_id, source_type, source_id, content, embedding, metadata, created_at, updated_at
            ) VALUES (
              ${id},
              ${merchantId},
              ${sourceType},
              ${sourceId},
              ${chunk.content},
              ${embeddingStr},
              ${chunk.metadata ? JSON.stringify(chunk.metadata) : null}::jsonb,
              NOW(),
              NOW()
            )
          `;
        }
      }

      this.logger.debug(
        `Upserted ${chunks.length} chunks for source ${sourceType}/${sourceId} on merchant ${merchantId}`
      );
    } catch (err) {
      this.logger.error(`Failed to upsert knowledge chunks: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async deleteBySource(merchantId: string, sourceType: string, sourceId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM knowledge_chunks
        WHERE merchant_id = ${merchantId}
        AND source_type = ${sourceType}
        AND source_id = ${sourceId}
      `;

      this.logger.debug(`Deleted chunks for ${sourceType}/${sourceId} on merchant ${merchantId}`);
    } catch (err) {
      this.logger.error(`Failed to delete knowledge chunks: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  async findBySource(merchantId: string, sourceType: string, sourceId: string): Promise<KnowledgeChunk[]> {
    try {
      const rows = await this.prisma.$queryRaw<KnowledgeChunkRow[]>`
        SELECT id, merchant_id, source_type, source_id, content, metadata
        FROM knowledge_chunks
        WHERE merchant_id = ${merchantId}
        AND source_type = ${sourceType}
        AND source_id = ${sourceId}
      `;
      return rows.map((row): KnowledgeChunk => ({
        id: row.id,
        merchantId: row.merchant_id,
        sourceType: row.source_type as KnowledgeChunk["sourceType"],
        sourceId: row.source_id,
        content: row.content,
        metadata: row.metadata ?? undefined,
      }));
    } catch (err) {
      this.logger.error(`Failed to find knowledge chunks: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async countBySource(merchantId: string): Promise<Record<string, number>> {
    try {
      const rows = (await this.prisma.$queryRaw`
        SELECT source_type, COUNT(*)::int as count
        FROM knowledge_chunks
        WHERE merchant_id = ${merchantId}
        GROUP BY source_type
      `) as Array<{ source_type: string; count: number }>;

      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.source_type] = Number(row.count);
      }
      return counts;
    } catch (err) {
      this.logger.error(`Failed to count knowledge chunks: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }

  async similaritySearch(
    merchantId: string,
    queryEmbedding: number[],
    limit: number = 5,
    threshold: number = 0.65
  ): Promise<KnowledgeChunk[]> {
    try {
      const embeddingStr = JSON.stringify(queryEmbedding);

      // Try pgvector similarity search first. Dimension comes from the query
      // vector so it matches the active provider (384 local / 1536 OpenAI);
      // length is a trusted integer, safe to inline in the cast.
      const dim = queryEmbedding.length;
      let results: KnowledgeChunkRow[] = [];
      try {
        results = await this.prisma.$queryRawUnsafe<KnowledgeChunkRow[]>(
          `SELECT
            id, merchant_id, source_type, source_id, content, metadata,
            1 - (embedding_vec <=> $1::vector(${dim})) as similarity
          FROM knowledge_chunks
          WHERE merchant_id = $2
          AND embedding_vec IS NOT NULL
          ORDER BY embedding_vec <=> $1::vector(${dim})
          LIMIT $3`,
          embeddingStr,
          merchantId,
          limit,
        );
      } catch {
        // pgvector not available, fall back to base64 + JS cosine similarity
        this.logger.debug("pgvector unavailable, using base64 cosine fallback");
        const allChunks = await this.prisma.$queryRaw<KnowledgeChunkRow[]>`
          SELECT id, merchant_id, source_type, source_id, content, metadata, embedding
          FROM knowledge_chunks
          WHERE merchant_id = ${merchantId}
          AND embedding IS NOT NULL
        `;

        // Compute cosine similarity in JS
        results = allChunks
          .map((chunk): KnowledgeChunkRow | null => {
            try {
              const chunkEmbedding = JSON.parse(chunk.embedding ?? "") as number[];
              const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
              return { ...chunk, similarity };
            } catch {
              return null;
            }
          })
          .filter((x): x is KnowledgeChunkRow => x !== null && (x.similarity ?? 0) >= threshold)
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
          .slice(0, limit);
      }

      return results.map((row): KnowledgeChunk => ({
        id: row.id,
        merchantId: row.merchant_id,
        sourceType: row.source_type as KnowledgeChunk["sourceType"],
        sourceId: row.source_id,
        content: row.content,
        metadata: row.metadata ?? undefined,
        similarity: row.similarity,
      }));
    } catch (err) {
      this.logger.error(`Failed to search knowledge chunks: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));

    if (magA === 0 || magB === 0) return 0;
    return dotProduct / (magA * magB);
  }
}
