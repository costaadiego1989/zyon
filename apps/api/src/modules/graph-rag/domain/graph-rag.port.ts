import type { GraphReadInput } from "./graph-query.js";

export const GRAPH_RETRIEVAL = Symbol("GRAPH_RETRIEVAL");
export const GRAPH_PROJECTION = Symbol("GRAPH_PROJECTION");
export interface GraphHitBase {
  merchantId: string; sourceVersion: number; sourceHash: string; modelId: string;
  projectedAt: number; vectorScore: number; score: number;
}
export interface GraphCatalogHit extends GraphHitBase { productId: string; variantId: string }
export interface GraphKnowledgeHit extends GraphHitBase {
  sourceType: "faq" | "policy"; sourceId: string; chunkId: string; contentHash: string;
}
export type GraphReadResult = { status: "ready"; kind: "catalog" | "knowledge";
  hits: Array<GraphCatalogHit | GraphKnowledgeHit>; partial: true }
  | { status: "unavailable"; reason: "disabled" | "invalid_input" | "reader_not_readonly" | "invalid_result" | "neo4j_unavailable" };
export interface GraphReadPort { read(input: GraphReadInput): Promise<GraphReadResult> }
export interface GraphConnectionSettings {
  enabled: boolean; merchantIds: readonly string[]; uri?: string; database: string;
  readUser?: string; readPassword?: string; writeUser?: string; writePassword?: string;
  production: boolean; timeoutMs: number;
}
export interface GraphTransaction {
  run(text: string, parameters?: Record<string, unknown>): Promise<{ records: Array<{ toObject(): Record<string, unknown> }> }>;
}
export interface GraphProjectionTransactions {
  withProjection<T>(merchantId: string, work: (transaction: GraphTransaction) => Promise<T>): Promise<T>;
}
