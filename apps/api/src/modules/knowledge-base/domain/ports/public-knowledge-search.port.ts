import type { KnowledgeChunk } from "./knowledge-repository.port.js";
export const PUBLIC_KNOWLEDGE_SEARCH = Symbol("PUBLIC_KNOWLEDGE_SEARCH");
export interface PublicKnowledgeSearchPort {
  enabledFor(merchantId: string): boolean;
  search(input: { merchantId: string; queryText: string; limit?: number }): Promise<KnowledgeChunk[] | null>;
}
