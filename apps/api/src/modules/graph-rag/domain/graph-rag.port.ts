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
  | { status: "unavailable"; reason: "disabled" | "invalid_input" | "reader_not_readonly" | "invalid_result" | "neo4j_unavailable" | "embedding_unavailable" | "timeout" };
export interface GraphReadPort { read(input: GraphReadInput): Promise<GraphReadResult> }
export interface GraphConnectionSettings {
  enabled: boolean; merchantIds: readonly string[]; uri?: string; database: string;
  readUser?: string; readPassword?: string; writeUser?: string; writePassword?: string;
  production: boolean; timeoutMs: number;
  queryMode?: "direct" | "community_gateway";
  queryGateway?: { uri: string; keyId: string; secret: string };
}
export interface GraphRuntimeAdapter extends GraphReadPort, GraphProjectionTransactions {
  admitReader(): Promise<boolean>;
  close(): Promise<void>;
}
export interface GraphTransaction {
  run(text: string, parameters?: Record<string, unknown>): Promise<{ records: Array<{ toObject(): Record<string, unknown> }> }>;
}
export interface GraphProjectionTransactions {
  withProjection<T>(merchantId: string, work: (transaction: GraphTransaction) => Promise<T>): Promise<T>;
}
export interface GraphEmbeddingPort {
  readonly modelId: string;
  readonly dimensions: number;
  generate(text: string): Promise<number[] | null>;
}
export interface GraphCatalogRequest {
  merchantId: string; query: string; limit?: number; categoryId?: string;
  attributes?: Array<{ name: string; value: string; operator: "equals" | "not_equals" }>;
  attributeAnyOf?: Array<Array<{ name: string; value: string; operator: "equals" | "not_equals" }>>;
}
export type GraphUnavailable = Extract<GraphReadResult, { status: "unavailable" }>;
export type GraphCatalogSelection = { status: "ready"; hits: GraphCatalogHit[]; partial: true } | GraphUnavailable;
export type GraphKnowledgeSelection = { status: "ready"; hits: GraphKnowledgeHit[]; partial: true } | GraphUnavailable;
export interface GraphRetrievalPort {
  enabledFor(merchantId: string): boolean;
  searchCatalog(input: GraphCatalogRequest): Promise<GraphCatalogSelection>;
  searchKnowledge(input: Pick<GraphCatalogRequest, "merchantId" | "query" | "limit">): Promise<GraphKnowledgeSelection>;
}
