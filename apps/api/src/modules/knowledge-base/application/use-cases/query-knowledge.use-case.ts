import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { EMBEDDING_PORT, type EmbeddingPort } from "../../domain/ports/embedding.port.js";
import {
  KNOWLEDGE_REPOSITORY,
  type KnowledgeRepositoryPort,
  type KnowledgeChunk,
} from "../../domain/ports/knowledge-repository.port.js";
import { BillingPlanMeteringService } from "../../../payment/domain/billing-plan-guard.js";
import { PUBLIC_KNOWLEDGE_SEARCH, type PublicKnowledgeSearchPort } from "../../domain/ports/public-knowledge-search.port.js";
import { RevalidatePublicSourceService } from "./revalidate-public-source.service.js";
import type { PublicEvidenceResult, ValidatedPublicEvidence } from "../../domain/public-source-evidence.js";

export interface QueryKnowledgeInput {
  merchantId: string;
  queryText: string;
  limit?: number;
  threshold?: number;
}

export interface QueryKnowledgeOutput {
  chunks: KnowledgeChunk[];
  status?: PublicEvidenceResult["status"];
  evidence?: ValidatedPublicEvidence[];
  reason?: "canonical_unavailable";
}

@Injectable()
export class QueryKnowledgeUseCase {
  private readonly logger = new Logger(QueryKnowledgeUseCase.name);

  constructor(
    @Inject(EMBEDDING_PORT) private readonly embeddingService: EmbeddingPort,
    @Inject(KNOWLEDGE_REPOSITORY) private readonly knowledgeRepo: KnowledgeRepositoryPort,
    @Optional() private readonly billing?: BillingPlanMeteringService,
    @Optional() @Inject(PUBLIC_KNOWLEDGE_SEARCH) private readonly graph?: PublicKnowledgeSearchPort,
    @Optional() private readonly publicSources?: RevalidatePublicSourceService,
  ) {}

  private async admit(merchantId: string, chunks: KnowledgeChunk[], origin: "legacy_graph" | "legacy_sql"): Promise<QueryKnowledgeOutput> {
    if (!this.publicSources) return { chunks };
    const result = await this.publicSources.revalidateLegacy(merchantId, chunks, origin);
    const seen = new Set<string>();
    return { ...result, chunks: result.evidence.flatMap(item => {
      if (item.provenance.sourceType !== "faq" && item.provenance.sourceType !== "policy") return [];
      const key = JSON.stringify([item.provenance.sourceType, item.content]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ id: item.id, merchantId: item.provenance.merchantId, sourceType: item.provenance.sourceType, sourceId: item.provenance.sourceId,
        content: item.content, ...(Number.isFinite(item.similarity) ? { similarity: item.similarity } : {}) }];
    }) };
  }

  async execute(input: QueryKnowledgeInput): Promise<QueryKnowledgeOutput> {
    try {
      await this.billing?.assertAllowed(input.merchantId, { kind: "feature", key: "knowledgeBase" });
    } catch {
      return { chunks: [] };
    }
    const publicOnly = this.graph?.enabledFor(input.merchantId) === true;
    if (publicOnly) {
      try {
        const chunks = await this.graph!.search(input);
        if (chunks?.length) return this.admit(input.merchantId, chunks, "legacy_graph");
      } catch { this.logger.debug("Public knowledge graph unavailable"); }
    }
    // Default: return empty if embedding unavailable
    if (!this.embeddingService.isAvailable()) {
      this.logger.debug("Embedding service unavailable, no knowledge base search");
      return { chunks: [] };
    }

    try {
      // Embed the query
      const queryEmbedding = await this.embeddingService.generate(input.queryText);
      if (!queryEmbedding) {
        this.logger.warn("Failed to embed query text");
        return { chunks: [] };
      }

      // Search knowledge base
      const chunks = await this.knowledgeRepo.similaritySearch(
        input.merchantId,
        queryEmbedding,
        input.limit ?? 5,
        input.threshold ?? 0.65
      );

      const current = publicOnly && !this.publicSources ? await this.graph!.revalidateLegacy(input.merchantId, chunks) : chunks;
      return this.admit(input.merchantId, current, "legacy_sql");
    } catch (err) {
      this.logger.warn(`Knowledge base query failed: ${err instanceof Error ? err.message : String(err)}`);
      return { chunks: [] };
    }
  }
}
