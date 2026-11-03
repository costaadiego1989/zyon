import { createHash } from "node:crypto";
import { z } from "zod";
import { graphReadSchema, normalizeGraphText } from "../domain/graph-query.js";
import type { GraphEmbeddingPort, GraphProjectionTransactions } from "../domain/graph-rag.port.js";

const id = z.string().min(1).max(191), version = z.number().int().safe().nonnegative();
const common = { merchantId: id, id, version, active: z.boolean() };
export const catalogProjectionSchema = z.strictObject({ ...common, kind: z.literal("catalog"),
  name: z.string().max(500).default(""), description: z.string().max(16000).default(""),
  category: z.strictObject({ id, name: z.string().min(1).max(500) }).optional(),
  variants: z.array(z.strictObject({ id, sku: z.string().max(191), active: z.boolean(),
    attributes: z.record(z.string().min(1).max(200), z.string().max(1000)) })).max(100).default([]),
}).refine(value => !value.active || value.name.trim().length > 0 && value.variants.length > 0, "active_source_incomplete");
export const documentProjectionSchema = z.strictObject({ ...common, kind: z.literal("knowledge"), sourceType: z.enum(["faq", "policy"]),
  chunks: z.array(z.strictObject({ id, content: z.string().min(1).max(8000) })).max(100).default([]),
}).refine(value => !value.active || value.chunks.length > 0, "active_source_incomplete");
export type CatalogProjectionSource = z.input<typeof catalogProjectionSchema>;
export type DocumentProjectionSource = z.input<typeof documentProjectionSchema>;
export type GraphProjectionOutcome = { status: "applied" | "ignored"; sourceHash: string }
  | { status: "unavailable"; reason: "invalid_source" | "embedding_unavailable" | "graph_unavailable" };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)])) : value;
const contentHash = (value: Record<string, unknown>) => { const { version: _version, ...content } = value;return hash(JSON.stringify(stable(content))); };
export function catalogProjectionHash(value: unknown) { const parsed = catalogProjectionSchema.parse(value);
  return contentHash({ ...parsed, variants: [...parsed.variants].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }); }
export function documentProjectionHash(value: unknown) { const parsed = documentProjectionSchema.parse(value);
  return contentHash({ ...parsed, chunks: [...parsed.chunks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }); }

// Schema operations run only through the explicit operator bootstrap, never on a query.
export const GRAPH_SCHEMA_STATEMENTS = [
  "CREATE CONSTRAINT zyon_graph_product_identity IF NOT EXISTS FOR (n:ZyonGraphProduct) REQUIRE (n.merchantId, n.canonicalId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_graph_variant_identity IF NOT EXISTS FOR (n:ZyonGraphVariant) REQUIRE (n.merchantId, n.canonicalId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_graph_category_identity IF NOT EXISTS FOR (n:ZyonGraphCategory) REQUIRE (n.merchantId, n.canonicalId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_graph_attribute_identity IF NOT EXISTS FOR (n:ZyonGraphAttribute) REQUIRE (n.merchantId, n.canonicalId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_graph_document_identity IF NOT EXISTS FOR (n:ZyonGraphDocument) REQUIRE (n.merchantId, n.sourceType, n.canonicalId) IS UNIQUE",
  "CREATE CONSTRAINT zyon_graph_chunk_identity IF NOT EXISTS FOR (n:ZyonGraphChunk) REQUIRE (n.merchantId, n.sourceType, n.sourceId, n.canonicalId) IS UNIQUE",
];
const ROOT_CATALOG = `MERGE (p:ZyonGraphProduct {merchantId: $merchantId, canonicalId: $sourceId})
ON CREATE SET p.sourceVersion = -1
SET p._projectionLock = true REMOVE p._projectionLock
WITH p WHERE p.sourceVersion < $sourceVersion OR (p.sourceVersion = $sourceVersion AND p.sourceHash = $sourceHash)
SET p.active = $active, p.name = $name, p.sourceVersion = $sourceVersion, p.sourceHash = $sourceHash,
    p.modelId = $modelId, p.projectedAt = $projectedAt, p.schemaVersion = 1
RETURN true AS admitted`;
const ROOT_DOCUMENT = `MERGE (d:ZyonGraphDocument {merchantId: $merchantId, sourceType: $sourceType, canonicalId: $sourceId})
ON CREATE SET d.sourceVersion = -1
SET d._projectionLock = true REMOVE d._projectionLock
WITH d WHERE d.sourceVersion < $sourceVersion OR (d.sourceVersion = $sourceVersion AND d.sourceHash = $sourceHash)
SET d.active = $active, d.sourceVersion = $sourceVersion, d.sourceHash = $sourceHash,
    d.modelId = $modelId, d.projectedAt = $projectedAt, d.schemaVersion = 1
RETURN true AS admitted`;
const RETIRE_VARIANTS = `MATCH (p:ZyonGraphProduct {merchantId: $merchantId, canonicalId: $sourceId})
 -[:ZyonGraphHasVariant {merchantId: $merchantId}]->(v:ZyonGraphVariant {merchantId: $merchantId})
WHERE v.productId = $sourceId
SET v.active = false, v.sourceVersion = $sourceVersion, v.projectedAt = $projectedAt
REMOVE v.embedding, v.normalizedText
WITH v OPTIONAL MATCH (v)-[r:ZyonGraphHasAttribute {merchantId: $merchantId}]->(:ZyonGraphAttribute {merchantId: $merchantId}) DELETE r`;
const RETIRE_CATEGORY = `MATCH (p:ZyonGraphProduct {merchantId: $merchantId, canonicalId: $sourceId})
 -[r:ZyonGraphInCategory {merchantId: $merchantId}]->(:ZyonGraphCategory {merchantId: $merchantId}) DELETE r`;
const UPSERT_VARIANTS = `MATCH (p:ZyonGraphProduct {merchantId: $merchantId, canonicalId: $sourceId})
UNWIND $variants AS item
MERGE (v:ZyonGraphVariant {merchantId: $merchantId, canonicalId: item.id})
SET v.productId = $sourceId, v.active = true, v.sourceVersion = $sourceVersion, v.sourceHash = $sourceHash,
    v.modelId = $modelId, v.projectedAt = $projectedAt, v.schemaVersion = 1,
    v.embedding = item.embedding, v.normalizedText = item.normalizedText
MERGE (p)-[:ZyonGraphHasVariant {merchantId: $merchantId}]->(v)
WITH v, item UNWIND item.attributes AS attribute
MERGE (a:ZyonGraphAttribute {merchantId: $merchantId, canonicalId: attribute.id})
SET a.name = attribute.name, a.value = attribute.value, a.sourceVersion = $sourceVersion, a.sourceHash = $sourceHash
MERGE (v)-[:ZyonGraphHasAttribute {merchantId: $merchantId}]->(a)`;
const UPSERT_CATEGORY = `MATCH (p:ZyonGraphProduct {merchantId: $merchantId, canonicalId: $sourceId})
MERGE (category:ZyonGraphCategory {merchantId: $merchantId, canonicalId: $categoryId})
SET category.name = CASE WHEN category.sourceVersion IS NULL OR category.sourceVersion <= $sourceVersion THEN $categoryName ELSE category.name END,
    category.sourceVersion = CASE WHEN category.sourceVersion IS NULL OR category.sourceVersion <= $sourceVersion THEN $sourceVersion ELSE category.sourceVersion END
MERGE (p)-[:ZyonGraphInCategory {merchantId: $merchantId}]->(category)`;
const RETIRE_CHUNKS = `MATCH (d:ZyonGraphDocument {merchantId: $merchantId, sourceType: $sourceType, canonicalId: $sourceId})
 -[:ZyonGraphHasChunk {merchantId: $merchantId}]->(c:ZyonGraphChunk {merchantId: $merchantId})
WHERE c.sourceType = $sourceType AND c.sourceId = $sourceId
SET c.active = false, c.sourceVersion = $sourceVersion, c.projectedAt = $projectedAt
REMOVE c.embedding, c.normalizedText`;
const UPSERT_CHUNKS = `MATCH (d:ZyonGraphDocument {merchantId: $merchantId, sourceType: $sourceType, canonicalId: $sourceId})
UNWIND $chunks AS item
MERGE (c:ZyonGraphChunk {merchantId: $merchantId, sourceType: $sourceType, sourceId: $sourceId, canonicalId: item.id})
SET c.active = true, c.sourceVersion = $sourceVersion, c.contentHash = item.contentHash,
    c.modelId = $modelId, c.projectedAt = $projectedAt, c.schemaVersion = 1,
    c.embedding = item.embedding, c.normalizedText = item.normalizedText
MERGE (d)-[:ZyonGraphHasChunk {merchantId: $merchantId}]->(c)`;

export class GraphProjectionService {
  constructor(private readonly graph: GraphProjectionTransactions, private readonly embeddings: GraphEmbeddingPort,
    private readonly clock: () => number = Date.now) {}

  async projectCatalog(value: unknown): Promise<GraphProjectionOutcome> {
    const checked = catalogProjectionSchema.safeParse(value);
    if (!checked.success || checked.data.version > this.clock() + 30_000) return { status: "unavailable", reason: "invalid_source" };
    const source = checked.data, sourceHash = catalogProjectionHash(source);
    try {
      const variants = [];
      for (const variant of source.active ? source.variants.filter(v => v.active) : []) {
        const attributes = Object.entries(variant.attributes).map(([name, value]) => ({
          id: hash(`${variant.id}\0${normalizeGraphText(name)}`), name: normalizeGraphText(name), value: normalizeGraphText(value),
        }));
        const text = [source.name, source.description, source.category?.name ?? "", variant.sku,
          ...Object.entries(variant.attributes).map(([name, value]) => `${name}: ${value}`)].join(". ");
        const embedding = await this.embeddings.generate(text);
        const vector = graphReadSchema.shape.embedding.safeParse(embedding);
        if (!vector.success) return { status: "unavailable", reason: "embedding_unavailable" };
        variants.push({ id: variant.id, attributes, embedding: vector.data, normalizedText: normalizeGraphText(text) });
      }
      const params = { merchantId: source.merchantId, sourceId: source.id, sourceVersion: source.version,
        sourceHash, active: source.active, name: source.active ? source.name : "", modelId: this.embeddings.modelId,
        projectedAt: this.clock(), variants };
      return await this.graph.withProjection(source.merchantId, async tx => {
        const root = await tx.run(ROOT_CATALOG, params);
        if (!root.records.length) return { status: "ignored", sourceHash };
        await tx.run(RETIRE_VARIANTS, params);await tx.run(RETIRE_CATEGORY, params);
        if (variants.length) await tx.run(UPSERT_VARIANTS, params);
        if (source.active && source.category) await tx.run(UPSERT_CATEGORY,
          { ...params, categoryId: source.category.id, categoryName: source.category.name });
        return { status: "applied", sourceHash };
      });
    } catch { return { status: "unavailable", reason: "graph_unavailable" }; }
  }

  async projectDocument(value: unknown): Promise<GraphProjectionOutcome> {
    const checked = documentProjectionSchema.safeParse(value);
    if (!checked.success || checked.data.version > this.clock() + 30_000) return { status: "unavailable", reason: "invalid_source" };
    const source = checked.data, sourceHash = documentProjectionHash(source);
    try {
      const chunks = [];
      for (const chunk of source.active ? source.chunks : []) {
        const embedding = await this.embeddings.generate(chunk.content), vector = graphReadSchema.shape.embedding.safeParse(embedding);
        if (!vector.success) return { status: "unavailable", reason: "embedding_unavailable" };
        chunks.push({ id: chunk.id, contentHash: hash(chunk.content), normalizedText: normalizeGraphText(chunk.content), embedding: vector.data });
      }
      const params = { merchantId: source.merchantId, sourceId: source.id, sourceType: source.sourceType,
        sourceVersion: source.version, sourceHash, active: source.active, modelId: this.embeddings.modelId, projectedAt: this.clock(), chunks };
      return await this.graph.withProjection(source.merchantId, async tx => {
        const root = await tx.run(ROOT_DOCUMENT, params);
        if (!root.records.length) return { status: "ignored", sourceHash };
        await tx.run(RETIRE_CHUNKS, params);if (chunks.length) await tx.run(UPSERT_CHUNKS, params);
        return { status: "applied", sourceHash };
      });
    } catch { return { status: "unavailable", reason: "graph_unavailable" }; }
  }
}
