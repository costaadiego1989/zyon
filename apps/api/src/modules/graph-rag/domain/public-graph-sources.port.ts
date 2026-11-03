/** Public, canonical snapshots. No price, stock, buyer or private metadata. */
export interface GraphPublicCatalogSource {
  kind: "catalog"; merchantId: string; id: string; version: number; active: boolean;
  name?: string; description?: string; category?: { id: string; name: string };
  variants?: Array<{ id: string; sku: string; active: boolean; attributes: Record<string, string> }>;
}
export interface GraphPublicDocumentSource {
  kind: "knowledge"; merchantId: string; id: string; version: number; active: boolean;
  sourceType: "faq" | "policy"; chunks?: Array<{ id: string; content: string }>;
}
export const GRAPH_CATALOG_SOURCES = Symbol("GRAPH_CATALOG_SOURCES");
export interface GraphCatalogSourcesPort {
  read(merchantId: string, productId: string): Promise<GraphPublicCatalogSource | null>;
  page(merchantId: string, cursor?: string): Promise<{ sources: GraphPublicCatalogSource[]; nextCursor?: string }>;
}
export const GRAPH_KNOWLEDGE_SOURCES = Symbol("GRAPH_KNOWLEDGE_SOURCES");
export interface GraphKnowledgeSourcesPort {
  read(merchantId: string, sourceType: "faq" | "policy", sourceId: string): Promise<GraphPublicDocumentSource | null>;
  list(merchantId: string): Promise<GraphPublicDocumentSource[]>;
}
