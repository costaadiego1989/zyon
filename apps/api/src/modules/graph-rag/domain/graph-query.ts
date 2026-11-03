import { z } from "zod";

export const GRAPH_VECTOR_DIMENSIONS = 384;
export const normalizeGraphText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
const id = z.string().trim().min(1).max(191);
const vector = z.array(z.number().finite()).length(GRAPH_VECTOR_DIMENSIONS)
  .refine(values => values.some(value => value !== 0) && Number.isFinite(Math.hypot(...values)), "invalid_vector_norm");

export const graphReadSchema = z.strictObject({
  kind: z.enum(["catalog", "knowledge"]), merchantId: id, modelId: z.string().min(1).max(250),
  query: z.string().trim().min(1).max(2000), embedding: vector,
  nowEpochMs: z.number().int().safe().positive(),
  maxAgeMs: z.number().int().min(1000).max(3_600_000).default(300_000),
  limit: z.number().int().min(1).max(20).default(10),
  scanLimit: z.number().int().min(1).max(5000).default(2000),
  threshold: z.number().min(0).max(1).default(0.65),
  categoryId: id.optional(),
  attributes: z.array(z.strictObject({ name: z.string().trim().min(1).max(200),
    value: z.string().trim().min(1).max(1000), operator: z.enum(["equals", "not_equals"]) })).max(20).default([]),
});
export type GraphReadInput = z.input<typeof graphReadSchema>;
export interface GraphReadCommand { kind: "catalog" | "knowledge"; text: string; parameters: Record<string, unknown> }

const CATALOG_QUERY = `
MATCH (p:ZyonGraphProduct {merchantId: $merchantId})
      -[:ZyonGraphHasVariant {merchantId: $merchantId}]->
      (v:ZyonGraphVariant {merchantId: $merchantId})
WHERE p.active = true AND v.active = true AND v.productId = p.canonicalId
  AND p.schemaVersion = 1 AND v.schemaVersion = 1
  AND v.sourceVersion = p.sourceVersion
  AND p.modelId = $modelId AND v.modelId = $modelId
  AND p.projectedAt >= $minProjectedAt AND v.projectedAt >= $minProjectedAt
  AND v.embedding IS NOT NULL AND size(v.embedding) = $dimension
  AND ($categoryId IS NULL OR EXISTS {
    MATCH (p)-[:ZyonGraphInCategory {merchantId: $merchantId}]->(category:ZyonGraphCategory {merchantId: $merchantId})
    WHERE category.canonicalId = $categoryId
  })
  AND all(criterion IN $attributes WHERE EXISTS {
    MATCH (v)-[:ZyonGraphHasAttribute {merchantId: $merchantId}]->(a:ZyonGraphAttribute {merchantId: $merchantId})
    WHERE a.sourceVersion = v.sourceVersion AND a.name = criterion.name
      AND ((criterion.operator = 'equals' AND a.value = criterion.value)
        OR (criterion.operator = 'not_equals' AND a.value <> criterion.value))
  })
WITH p, v ORDER BY v.canonicalId LIMIT $scanLimit
WITH p, v, vector.similarity.cosine(v.embedding, $embedding) AS vectorScore,
  toFloat(size([term IN $terms WHERE v.normalizedText CONTAINS term])) / size($terms) AS lexicalScore
WHERE vectorScore >= $threshold
RETURN p.merchantId AS merchantId, p.canonicalId AS productId, v.canonicalId AS variantId,
       p.sourceVersion AS sourceVersion, p.sourceHash AS sourceHash, v.modelId AS modelId,
       p.projectedAt AS projectedAt, vectorScore,
       (0.8 * vectorScore + 0.2 * lexicalScore) AS score
ORDER BY score DESC, productId, variantId LIMIT $limit`;

const KNOWLEDGE_QUERY = `
MATCH (d:ZyonGraphDocument {merchantId: $merchantId})
      -[:ZyonGraphHasChunk {merchantId: $merchantId}]->
      (c:ZyonGraphChunk {merchantId: $merchantId})
WHERE d.active = true AND c.active = true AND c.sourceId = d.canonicalId
  AND d.schemaVersion = 1 AND c.schemaVersion = 1
  AND c.sourceType = d.sourceType AND d.sourceType IN $sourceTypes
  AND c.sourceVersion = d.sourceVersion
  AND d.modelId = $modelId AND c.modelId = $modelId
  AND d.projectedAt >= $minProjectedAt AND c.projectedAt >= $minProjectedAt
  AND c.embedding IS NOT NULL AND size(c.embedding) = $dimension
WITH d, c ORDER BY c.canonicalId LIMIT $scanLimit
WITH d, c, vector.similarity.cosine(c.embedding, $embedding) AS vectorScore,
  toFloat(size([term IN $terms WHERE c.normalizedText CONTAINS term])) / size($terms) AS lexicalScore
WHERE vectorScore >= $threshold
RETURN d.merchantId AS merchantId, d.sourceType AS sourceType, d.canonicalId AS sourceId,
       c.canonicalId AS chunkId, c.contentHash AS contentHash, d.sourceHash AS sourceHash,
       d.sourceVersion AS sourceVersion, c.modelId AS modelId, d.projectedAt AS projectedAt,
       vectorScore, (0.8 * vectorScore + 0.2 * lexicalScore) AS score
ORDER BY score DESC, sourceType, sourceId, chunkId LIMIT $limit`;

/** This is the only read compiler. Neither the LLM nor a caller supplies query
 * syntax, labels, relationship names or the database identity. */
export function compileGraphRead(value: unknown): GraphReadCommand {
  const input = graphReadSchema.parse(value);
  const terms = [...new Set(normalizeGraphText(input.query).split(" ").filter(Boolean))].slice(0, 12);
  if (!terms.length) throw new Error("graph_query_terms_missing");
  return { kind: input.kind, text: input.kind === "catalog" ? CATALOG_QUERY : KNOWLEDGE_QUERY,
    parameters: { merchantId: input.merchantId, modelId: input.modelId, dimension: GRAPH_VECTOR_DIMENSIONS,
      query: input.query, terms, embedding: [...input.embedding], limit: input.limit, scanLimit: input.scanLimit,
      threshold: input.threshold, minProjectedAt: input.nowEpochMs - input.maxAgeMs,
      categoryId: input.categoryId ?? null, sourceTypes: ["faq", "policy"],
      attributes: input.attributes.map(a => ({ name: normalizeGraphText(a.name), value: normalizeGraphText(a.value), operator: a.operator })) } };
}
