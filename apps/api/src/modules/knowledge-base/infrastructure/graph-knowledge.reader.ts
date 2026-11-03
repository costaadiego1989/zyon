import { createHash } from "node:crypto";
import type { GraphRetrievalPort } from "../../graph-rag/domain/graph-rag.port.js";
import type { GraphKnowledgeSourcesPort } from "../../graph-rag/domain/public-graph-sources.port.js";
import { documentProjectionHash, documentProjectionSchema } from "../../graph-rag/application/graph-projection.service.js";
import type { KnowledgeChunk } from "../domain/ports/knowledge-repository.port.js";

/** Rehydrates current public content; graph text is never an answer authority. */
export class GraphKnowledgeReader {
  constructor(private readonly graph: GraphRetrievalPort, private readonly sources: GraphKnowledgeSourcesPort) {}
  enabledFor(merchantId: string) { return this.graph.enabledFor(merchantId); }
  async revalidateLegacy(merchantId: string, candidates: KnowledgeChunk[]): Promise<KnowledgeChunk[]> {
    const admitted: KnowledgeChunk[] = [], seen = new Set<string>();
    const snapshots = new Map<string, Awaited<ReturnType<GraphKnowledgeSourcesPort["read"]>>>();
    for (const candidate of candidates.slice(0, 20)) {
      if (candidate.merchantId !== merchantId || !candidate.sourceId || typeof candidate.content !== "string"
        || candidate.sourceType !== "faq" && candidate.sourceType !== "policy") continue;
      try {
        const key = candidate.sourceType + ":" + candidate.sourceId;
        if (!snapshots.has(key)) snapshots.set(key, await this.sources.read(merchantId, candidate.sourceType, candidate.sourceId));
        const parsed = documentProjectionSchema.safeParse(snapshots.get(key));
        if (!parsed.success) continue;
        const source = parsed.data;
        if (!source.active || source.merchantId !== merchantId || source.id !== candidate.sourceId || source.sourceType !== candidate.sourceType) continue;
        const matching = source.chunks.filter(chunk => chunk.content === candidate.content);
        // Older policy indexes may hold the complete public field as one chunk.
        if (!matching.length && candidate.sourceType === "policy" && source.chunks.map(chunk => chunk.content).join("") === candidate.content)
          matching.push(...source.chunks);
        for (const chunk of matching) {
          const identity = key + ":" + chunk.id;
          if (seen.has(identity)) continue;
          seen.add(identity);
          admitted.push({ id: chunk.id, merchantId, sourceType: source.sourceType, sourceId: source.id, content: chunk.content,
            ...(Number.isFinite(candidate.similarity) ? { similarity: candidate.similarity } : {}) });
        }
      } catch { /* One unavailable source cannot authorize stale content. */ }
    }
    return admitted.slice(0, 20);
  }
  async search(input: { merchantId: string; queryText: string; limit?: number }): Promise<KnowledgeChunk[] | null> {
    if (!this.enabledFor(input.merchantId)) return null;
    try {
      const result = await this.graph.searchKnowledge({ merchantId: input.merchantId, query: input.queryText, limit: input.limit ?? 5 });
      if (result.status !== "ready") return null;
      const chunks: KnowledgeChunk[] = [], seen = new Set<string>();
      const snapshots = new Map<string, Awaited<ReturnType<GraphKnowledgeSourcesPort["read"]>>>();
      for (const hit of result.hits) {
        if (hit.merchantId !== input.merchantId) continue;
        const key = hit.sourceType + ":" + hit.sourceId;
        if (!snapshots.has(key)) snapshots.set(key, await this.sources.read(input.merchantId, hit.sourceType, hit.sourceId));
        const parsed = documentProjectionSchema.safeParse(snapshots.get(key));
        if (!parsed.success) continue;
        const source = parsed.data;
        if (!source.active || source.merchantId !== input.merchantId || source.sourceType !== hit.sourceType
          || source.id !== hit.sourceId || source.version !== hit.sourceVersion || documentProjectionHash(source) !== hit.sourceHash) continue;
        const chunk = source.chunks.find(item => item.id === hit.chunkId);
        if (!chunk || createHash("sha256").update(chunk.content).digest("hex") !== hit.contentHash || seen.has(hit.chunkId)) continue;
        seen.add(hit.chunkId);
        chunks.push({ id: hit.chunkId, merchantId: input.merchantId, sourceType: hit.sourceType, sourceId: hit.sourceId,
          content: chunk.content, similarity: hit.score });
      }
      return chunks;
    } catch { return null; }
  }
}
