import { createHash } from "node:crypto";
import { z } from "zod";
import { graphReadSchema, GRAPH_VECTOR_DIMENSIONS, normalizeGraphText } from "./graph-query.js";
import { GRAPH_EMBEDDING_ID } from "./graph-embedding-model.js";

export const publicBusinessSourceTypeSchema = z.enum(["company", "business_hours", "professional", "service", "faq", "policy"]);
const sourceTypes = publicBusinessSourceTypeSchema.options;
const base = z.strictObject({
  kind: z.literal("public_business"), merchantId: graphReadSchema.shape.merchantId,
  modelId: z.literal(GRAPH_EMBEDDING_ID), query: graphReadSchema.shape.query,
  embedding: graphReadSchema.shape.embedding, nowEpochMs: graphReadSchema.shape.nowEpochMs,
  limit: graphReadSchema.shape.limit, scanLimit: graphReadSchema.shape.scanLimit,
  threshold: graphReadSchema.shape.threshold,
});
const pair = z.strictObject({ serviceId: graphReadSchema.shape.merchantId, professionalId: graphReadSchema.shape.merchantId });
export const publicBusinessReadSchema = z.discriminatedUnion("mode", [
  base.extend({ mode: z.literal("sources"), sourceTypes: z.array(publicBusinessSourceTypeSchema).min(1).max(6)
    .refine(values => new Set(values).size === values.length).default([...sourceTypes]) }),
  base.extend({ mode: z.literal("service_professional"), limit: graphReadSchema.shape.limit.refine(value => value <= 10),
    pairs: z.array(pair).min(1).max(10).refine(values => new Set(values.map(value => JSON.stringify(value))).size === values.length) }),
]);
export type PublicBusinessReadInput = z.input<typeof publicBusinessReadSchema>;

const SOURCES = `MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId})
-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(c:ZyonPublicChunkV1 {merchantId:$merchantId})
WHERE s.sourceType IN $sourceTypes AND c.sourceType=s.sourceType AND c.sourceId=s.sourceId
  AND s.active=true AND c.active=true AND s.schemaVersion=1 AND c.schemaVersion=1
  AND s.publicRevision=c.publicRevision AND s.sourceHash=c.sourceHash
  AND s.modelId=$modelId AND c.modelId=$modelId AND s.dimensions=$dimension AND c.dimensions=$dimension
  AND c.embedding IS NOT NULL AND size(c.embedding)=$dimension
WITH s,c ORDER BY s.sourceType,s.sourceId,c.chunkId LIMIT $scanLimit
WITH s,c,vector.similarity.cosine(c.embedding,$embedding) AS vectorScore,
  toFloat(size([term IN $terms WHERE c.normalizedText CONTAINS term]))/size($terms) AS lexicalScore
WHERE vectorScore >= $threshold
RETURN s.merchantId AS merchantId,s.sourceType AS sourceType,s.sourceId AS sourceId,
  s.publicRevision AS publicRevision,s.sourceHash AS sourceHash,s.modelId AS modelId,s.dimensions AS dimensions,
  s.projectedAt AS projectedAt,s.schemaVersion AS schemaVersion,s.active AS active,
  c.chunkId AS chunkId,c.contentHash AS contentHash,vectorScore,(0.8*vectorScore+0.2*lexicalScore) AS score
ORDER BY score DESC,sourceType,sourceId,chunkId LIMIT $limit`;

// pairs are bounded server-derived candidate coordinates, NOT proof of a link.
// Current tenant/mode/publication/link must be re-read after graph awaits.
const PAIRS = `UNWIND $pairs AS pair
MATCH (s:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:'service',sourceId:pair.serviceId})
-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(sc:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:'service',sourceId:pair.serviceId})
MATCH (p:ZyonPublicSourceV1 {merchantId:$merchantId,sourceType:'professional',sourceId:pair.professionalId})
-[:ZyonPublicHasChunkV1 {merchantId:$merchantId}]->(pc:ZyonPublicChunkV1 {merchantId:$merchantId,sourceType:'professional',sourceId:pair.professionalId})
WHERE s.active=true AND sc.active=true AND p.active=true AND pc.active=true
  AND s.schemaVersion=1 AND sc.schemaVersion=1 AND p.schemaVersion=1 AND pc.schemaVersion=1
  AND s.publicRevision=sc.publicRevision AND s.sourceHash=sc.sourceHash
  AND p.publicRevision=pc.publicRevision AND p.sourceHash=pc.sourceHash
  AND s.modelId=$modelId AND sc.modelId=$modelId AND p.modelId=$modelId AND pc.modelId=$modelId
  AND s.dimensions=$dimension AND sc.dimensions=$dimension AND p.dimensions=$dimension AND pc.dimensions=$dimension
  AND sc.embedding IS NOT NULL AND pc.embedding IS NOT NULL
  AND size(sc.embedding)=$dimension AND size(pc.embedding)=$dimension
WITH s,sc,p,pc ORDER BY s.sourceId,p.sourceId,sc.chunkId,pc.chunkId LIMIT $scanLimit
WITH s,sc,p,pc,vector.similarity.cosine(sc.embedding,$embedding) AS serviceVectorScore,
  vector.similarity.cosine(pc.embedding,$embedding) AS professionalVectorScore
WHERE serviceVectorScore >= $threshold AND professionalVectorScore >= $threshold
RETURN {merchantId:s.merchantId,sourceType:s.sourceType,sourceId:s.sourceId,publicRevision:s.publicRevision,
  sourceHash:s.sourceHash,modelId:s.modelId,dimensions:s.dimensions,projectedAt:s.projectedAt,schemaVersion:s.schemaVersion,
  active:s.active,chunkId:sc.chunkId,contentHash:sc.contentHash,vectorScore:serviceVectorScore,score:serviceVectorScore} AS service,
 {merchantId:p.merchantId,sourceType:p.sourceType,sourceId:p.sourceId,publicRevision:p.publicRevision,
  sourceHash:p.sourceHash,modelId:p.modelId,dimensions:p.dimensions,projectedAt:p.projectedAt,schemaVersion:p.schemaVersion,
  active:p.active,chunkId:pc.chunkId,contentHash:pc.contentHash,vectorScore:professionalVectorScore,score:professionalVectorScore} AS professional,
 (serviceVectorScore+professionalVectorScore)/2 AS score
ORDER BY score DESC,service.sourceId,professional.sourceId,service.chunkId,professional.chunkId LIMIT $limit`;

export const PUBLIC_BUSINESS_READ_TEMPLATES = Object.freeze({ sources: SOURCES, service_professional: PAIRS });
// Separate family hash preserves GRAPH_TEMPLATE_HASH and its pinned predecessor.
export const PUBLIC_BUSINESS_TEMPLATE_HASH = createHash("sha256").update(JSON.stringify(PUBLIC_BUSINESS_READ_TEMPLATES)).digest("hex");
export function compilePublicBusinessRead(value: unknown) {
  const input = publicBusinessReadSchema.parse(value);
  const terms = [...new Set(normalizeGraphText(input.query).split(" ").filter(Boolean))].slice(0, 12);
  if (!terms.length) throw new Error("graph_query_terms_missing");
  return { kind: input.kind, mode: input.mode, text: PUBLIC_BUSINESS_READ_TEMPLATES[input.mode], parameters: {
    merchantId: input.merchantId, modelId: input.modelId, query: input.query, embedding: input.embedding,
    dimension: GRAPH_VECTOR_DIMENSIONS, terms, limit: input.limit, scanLimit: input.scanLimit, threshold: input.threshold,
    ...(input.mode === "sources" ? { sourceTypes: input.sourceTypes } : { pairs: input.pairs }),
  } };
}
