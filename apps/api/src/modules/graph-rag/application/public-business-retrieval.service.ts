import { z } from "zod";
import { GRAPH_EMBEDDING_ID } from "../domain/graph-embedding-model.js";
import { graphReadSchema } from "../domain/graph-query.js";
import { publicBusinessReadSchema } from "../domain/public-business-query.js";
import type { PublicBusinessReadPort, PublicBusinessReadResult } from "../domain/public-business-result.js";
import type { GraphEmbeddingPort } from "../domain/graph-rag.port.js";
import type { GraphRetrievalSettings } from "./graph-retrieval.service.js";

const base = z.strictObject({ merchantId: graphReadSchema.shape.merchantId, query: graphReadSchema.shape.query,
  limit: graphReadSchema.shape.limit });
const sourceRequest = base.extend({ mode: z.literal("sources"), sourceTypes: publicBusinessReadSchema.options[0].shape.sourceTypes });
const pairRequest = base.extend({ mode: z.literal("service_professional"), limit: publicBusinessReadSchema.options[1].shape.limit,
  pairs: publicBusinessReadSchema.options[1].shape.pairs });
const request = z.discriminatedUnion("mode", [sourceRequest, pairRequest]);
export type PublicBusinessRequest = z.input<typeof request>;

export class PublicBusinessRetrievalService {
  constructor(private readonly settings: GraphRetrievalSettings, private readonly embeddings: GraphEmbeddingPort,
    private readonly graph: PublicBusinessReadPort, private readonly clock: () => number = Date.now) {}

  async search(value: PublicBusinessRequest): Promise<PublicBusinessReadResult> {
    const checked = request.safeParse(value);
    if (!checked.success) return { status: "unavailable", reason: "invalid_input" };
    if (!this.settings.enabled || !this.settings.merchantIds.includes(checked.data.merchantId)) return { status: "unavailable", reason: "disabled" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async (): Promise<PublicBusinessReadResult> => {
      try {
        if (this.embeddings.dimensions !== 384 || this.embeddings.modelId !== GRAPH_EMBEDDING_ID) return { status: "unavailable", reason: "embedding_unavailable" };
        const embedding = await this.embeddings.generate(checked.data.query);
        if (!embedding || !graphReadSchema.shape.embedding.safeParse(embedding).success) return { status: "unavailable", reason: "embedding_unavailable" };
        return await this.graph.readPublic({ ...checked.data, kind: "public_business", embedding, modelId: GRAPH_EMBEDDING_ID,
          nowEpochMs: this.clock(), threshold: this.settings.threshold });
      } catch { return { status: "unavailable", reason: "neo4j_unavailable" }; }
    };
    try {
      return await Promise.race([operation(), new Promise<PublicBusinessReadResult>(resolve => {
        timer = setTimeout(() => resolve({ status: "unavailable", reason: "timeout" }), this.settings.timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
