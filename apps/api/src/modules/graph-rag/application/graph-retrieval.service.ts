import { z } from "zod";
import { graphReadSchema } from "../domain/graph-query.js";
import { admitGraphRows } from "../domain/graph-result.js";
import type { GraphCatalogHit, GraphKnowledgeHit, GraphCatalogRequest, GraphCatalogSelection, GraphEmbeddingPort, GraphKnowledgeSelection,
  GraphReadPort, GraphReadResult, GraphRetrievalPort, GraphMerchantGuideRequest, GraphMerchantGuideSelection, GraphMerchantGuideHit } from "../domain/graph-rag.port.js";

export interface GraphRetrievalSettings {
  enabled: boolean; merchantIds: readonly string[]; timeoutMs: number; maxAgeMs: number; threshold: number;
}
const request = z.strictObject({ merchantId: graphReadSchema.shape.merchantId, query: graphReadSchema.shape.query,
  categoryId: graphReadSchema.shape.categoryId, attributes: graphReadSchema.shape.attributes,
  attributeAnyOf: graphReadSchema.shape.attributeAnyOf.removeDefault().optional(), limit: graphReadSchema.shape.limit });
const guideRequest = z.strictObject({ merchantId: graphReadSchema.shape.merchantId, query: graphReadSchema.shape.query,
  context: z.literal("cashback"), limit: graphReadSchema.shape.limit });

export class GraphRetrievalService implements GraphRetrievalPort {
  private readonly merchants: Set<string>;
  constructor(private readonly settings: GraphRetrievalSettings, private readonly embeddings: GraphEmbeddingPort,
    private readonly graph: GraphReadPort, private readonly clock: () => number = Date.now) { this.merchants = new Set(settings.merchantIds); }

  enabledFor(merchantId: string) { return this.settings.enabled && this.merchants.has(merchantId); }

  private async search(kind: "catalog" | "knowledge" | "merchant_help", input: GraphCatalogRequest | GraphMerchantGuideRequest): Promise<GraphReadResult> {
    if (!this.enabledFor(input.merchantId)) return { status: "unavailable", reason: "disabled" };
    const checked = (kind === "merchant_help" ? guideRequest : request).safeParse(input);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async (): Promise<GraphReadResult> => {
      try {
        if (this.embeddings.dimensions !== 384) return { status: "unavailable", reason: "embedding_unavailable" };
        const embedding = await this.embeddings.generate(checked.data.query);
        if (!embedding) return { status: "unavailable", reason: "embedding_unavailable" };
        const readInput = { ...checked.data, kind, embedding, modelId: this.embeddings.modelId,
          nowEpochMs: this.clock(), maxAgeMs: this.settings.maxAgeMs, threshold: this.settings.threshold };
        const result = await this.graph.read(readInput);
        if (kind !== "merchant_help" || result.status !== "ready") return result;
        try {
          if (result.kind !== kind) return { status: "unavailable", reason: "invalid_result" };
          return admitGraphRows(readInput, result.hits, this.clock);
        } catch { return { status: "unavailable", reason: "invalid_result" }; }
      } catch { return { status: "unavailable", reason: "neo4j_unavailable" }; }
    };
    try {
      return await Promise.race([operation(), new Promise<GraphReadResult>(resolve => {
        timer = setTimeout(() => resolve({ status: "unavailable", reason: "timeout" }), this.settings.timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async searchCatalog(input: GraphCatalogRequest): Promise<GraphCatalogSelection> {
    const result = await this.search("catalog", input);
    if (result.status !== "ready") return result;
    const hits = result.hits.filter((hit): hit is GraphCatalogHit => "variantId" in hit && hit.merchantId === input.merchantId && hit.modelId === this.embeddings.modelId);
    return hits.length === result.hits.length ? { status: "ready", hits, partial: true } : { status: "unavailable", reason: "invalid_result" };
  }

  async searchKnowledge(input: Pick<GraphCatalogRequest, "merchantId" | "query" | "limit">): Promise<GraphKnowledgeSelection> {
    const result = await this.search("knowledge", input);
    if (result.status !== "ready") return result;
    const hits = result.hits.filter((hit): hit is GraphKnowledgeHit => "chunkId" in hit && ["faq", "policy"].includes(hit.sourceType) && hit.merchantId === input.merchantId && hit.modelId === this.embeddings.modelId);
    return hits.length === result.hits.length ? { status: "ready", hits, partial: true } : { status: "unavailable", reason: "invalid_result" };
  }

  async searchMerchantGuides(input: GraphMerchantGuideRequest): Promise<GraphMerchantGuideSelection> {
    const result = await this.search("merchant_help", input);
    if (result.status !== "ready") return result;
    return { status: "ready", hits: result.hits as GraphMerchantGuideHit[], partial: true };
  }
}
