import type { KnowledgeChunk } from "./knowledge-repository.port.js";
import type { LegacyKnowledgeRetrievalEvidence } from "../public-source-evidence.js";
export interface KnowledgeSearchWithEvidence {
  chunks: KnowledgeChunk[];
  retrieval: ReadonlyArray<Readonly<LegacyKnowledgeRetrievalEvidence>>;
}
export const PUBLIC_KNOWLEDGE_SEARCH = Symbol("PUBLIC_KNOWLEDGE_SEARCH");
export interface PublicKnowledgeSearchPort {
  enabledFor(merchantId: string): boolean;
  search(input: { merchantId: string; queryText: string; limit?: number }): Promise<KnowledgeChunk[] | null>;
  searchWithEvidence?(input: { merchantId: string; queryText: string; limit?: number }): Promise<KnowledgeSearchWithEvidence | null>;
  revalidateLegacy(merchantId: string, chunks: KnowledgeChunk[]): Promise<KnowledgeChunk[]>;
}
