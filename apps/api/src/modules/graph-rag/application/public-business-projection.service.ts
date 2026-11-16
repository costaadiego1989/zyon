import { createHash } from "node:crypto";
import { GRAPH_VECTOR_DIMENSIONS, graphReadSchema, normalizeGraphText } from "../domain/graph-query.js";
import type { GraphEmbeddingPort, GraphProjectionTransactions } from "../domain/graph-rag.port.js";
import type { PublicBusinessSourceProjection } from "../domain/public-business-source.js";
import { publicWorkSequence } from "./public-source-work-state.js";

export const PUBLIC_BUSINESS_GRAPH_SCHEMA = [
  "CREATE CONSTRAINT zyon_public_source_v1_identity IF NOT EXISTS FOR (n:ZyonPublicSourceV1) REQUIRE (n.merchantId,n.sourceType,n.sourceId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_public_chunk_v1_identity IF NOT EXISTS FOR (n:ZyonPublicChunkV1) REQUIRE (n.merchantId,n.sourceType,n.sourceId,n.chunkId) IS UNIQUE",
];
const rootQuery = `MERGE (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId})
ON CREATE SET s.publicRevision=-1
SET s._projectionLock=true REMOVE s._projectionLock
WITH s WHERE s.publicRevision < $publicRevision OR (s.publicRevision=$publicRevision AND s.sourceHash=$sourceHash)
SET s.active=$active,s.publicRevision=$publicRevision,s.sourceHash=$sourceHash,
    s.modelId=$modelId,s.dimensions=$dimensions,s.projectedAt=$projectedAt,s.schemaVersion=1
RETURN true AS admitted`;
const retireQuery = `MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId})
-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(c:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId})
SET c.active=false,c.publicRevision=$publicRevision,c.projectedAt=$projectedAt
REMOVE c.embedding,c.normalizedText`;
const upsertQuery = `MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId})
UNWIND $chunks AS item
MERGE (c:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:$sourceType,sourceId:$sourceId,chunkId:item.id})
SET c.active=true,c.publicRevision=$publicRevision,c.sourceHash=$sourceHash,c.contentHash=item.contentHash,
    c.modelId=$modelId,c.dimensions=$dimensions,c.projectedAt=$projectedAt,c.schemaVersion=1,
    c.embedding=item.embedding,c.normalizedText=item.normalizedText
MERGE (s)-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(c)`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
const types = ["company", "business_hours", "professional", "service", "faq", "policy"];

/** Shared deterministic boundaries for vector preparation and SQL publication.
 * Original public text is retained in SQL; the graph uses normalized text. */
export function publicBusinessTextChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + 1600);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]!)) end--;
    chunks.push(value.slice(offset, end));offset = end;
  }
  return chunks;
}

export interface PreparedPublicBusinessProjection {
  merchantId: string; sourceType: string; sourceId: string; sourceHash: string; publicRevision: number;
  active: boolean; modelId: string; dimensions: number;
  chunks: Array<{ id: string; contentHash: string; normalizedText: string; embedding: number[] }>;
}
export type PublicBusinessPreparation = { status: "prepared"; projection: PreparedPublicBusinessProjection }
  | { status: "unavailable"; reason: "invalid_source" | "embedding_unavailable" };

/** Embedding preparation is separate from admitted graph submission so the
 * worker can revalidate canonical authority after slow model work completes.
 * publicRevision is a public-v1 counter, never an epoch or legacy UUID.
 */
export class PublicBusinessProjectionService {
  constructor(private readonly graph: GraphProjectionTransactions, private readonly embeddings: GraphEmbeddingPort,
    private readonly clock: () => number = Date.now) {}

  async prepare(source: PublicBusinessSourceProjection, workVersion: string): Promise<PublicBusinessPreparation> {
    let publicRevision: number;
    try { publicRevision = publicWorkSequence(workVersion); }
    catch { return { status: "unavailable", reason: "invalid_source" }; }
    if (![source.merchantId, source.sourceId, this.embeddings.modelId].every(validId) || !types.includes(source.sourceType)
      || !/^[a-f0-9]{64}$/.test(source.sourceHash) || typeof source.text !== "string" || source.text.length > 160_000
      || !["published", "draft", "withdrawn"].includes(source.publicationState)) return { status: "unavailable", reason: "invalid_source" };
    const active = source.publicationState === "published" && Boolean(source.text.trim());
    const chunks: PreparedPublicBusinessProjection["chunks"] = [];
    if (active) {
      if (this.embeddings.dimensions !== GRAPH_VECTOR_DIMENSIONS)
        return { status: "unavailable", reason: "embedding_unavailable" };
      const texts = publicBusinessTextChunks(source.text);
      for (let index = 0; index < texts.length; index++) {
        const text = texts[index]!;
        let embedding: unknown;
        try { embedding = await this.embeddings.generate(text); }
        catch { return { status: "unavailable", reason: "embedding_unavailable" }; }
        const vector = graphReadSchema.shape.embedding.safeParse(embedding);
        if (!vector.success) return { status: "unavailable", reason: "embedding_unavailable" };
        chunks.push({ id: hash(JSON.stringify([source.sourceType, source.sourceId, index])),
          contentHash: hash(text), normalizedText: normalizeGraphText(text), embedding: vector.data });
      }
    }
    return { status: "prepared", projection: { merchantId: source.merchantId, sourceType: source.sourceType,
      sourceId: source.sourceId, sourceHash: source.sourceHash, publicRevision, active,
      modelId: this.embeddings.modelId, dimensions: GRAPH_VECTOR_DIMENSIONS, chunks } };
  }

  /** Internal worker only, after a current canonical source/lease/revision fence.
   * The distinct namespace preserves old catalog/document projection contracts.
   */
  async submit(projection: PreparedPublicBusinessProjection) {
    const parameters = { ...projection, projectedAt: this.clock() };
    try {
      return await this.graph.withProjection(projection.merchantId, async tx => {
        const root = await tx.run(rootQuery, parameters);
        if (!root.records.length) return { status: "ignored" as const };
        await tx.run(retireQuery, parameters);
        if (projection.active && projection.chunks.length) await tx.run(upsertQuery, parameters);
        return { status: "applied" as const };
      });
    } catch { return { status: "unavailable" as const, reason: "graph_unavailable" as const }; }
  }
}
