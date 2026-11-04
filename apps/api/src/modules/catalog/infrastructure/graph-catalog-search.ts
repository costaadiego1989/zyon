import type { GraphRetrievalPort } from "../../graph-rag/domain/graph-rag.port.js";
import type { GraphCatalogSourcesPort } from "../../graph-rag/domain/public-graph-sources.port.js";
import { catalogProjectionHash, catalogProjectionSchema } from "../../graph-rag/application/graph-projection.service.js";
import type { SearchProductsInput, SearchProductsResult } from "../domain/ports/product-repository.port.js";

export class GraphCatalogSearch {
  constructor(private readonly graph: GraphRetrievalPort, private readonly sources: GraphCatalogSourcesPort) {}
  async search(input: SearchProductsInput, canonical: (input: SearchProductsInput) => Promise<SearchProductsResult>) {
    const original = await canonical(input);
    if (original.total || original.products.length || original.nextCursor || !input.allowSemantic || !input.query?.trim()
      || !input.inStockOnly || input.queryMode !== "contextual" || input.cursor || input.offset || input.candidateVariantIds
      || !this.graph.enabledFor(input.merchantId)) return original;
    try {
      const found = await this.graph.searchCatalog({ merchantId: input.merchantId, query: input.query,
        categoryId: input.categoryId, attributes: input.attributes, attributeAnyOf: input.attributeAnyOf, limit: 20 });
      if (found.status !== "ready") return original;
      const snapshots = new Map<string, Awaited<ReturnType<GraphCatalogSourcesPort["read"]>>>();
      const ids = new Set<string>();
      for (const hit of found.hits) {
        if (hit.merchantId !== input.merchantId) continue;
        if (!snapshots.has(hit.productId)) snapshots.set(hit.productId, await this.sources.read(input.merchantId, hit.productId));
        const parsed = catalogProjectionSchema.safeParse(snapshots.get(hit.productId));
        if (!parsed.success) continue;
        const source = parsed.data;
        if (!source.active || source.merchantId !== input.merchantId || source.id !== hit.productId
          || source.version !== hit.sourceVersion || catalogProjectionHash(source) !== hit.sourceHash
          || !source.variants.some(v => v.id === hit.variantId && v.active)) continue;
        ids.add(hit.variantId);
      }
      if (!ids.size) return original;
      // Only lexical text is replaced by the bounded candidate identity set.
      // Every current commercial constraint remains on the same variant in SQL.
      const result = await canonical({ ...input, query: undefined, queryMode: undefined, allowSemantic: false,
        candidateVariantIds: [...ids], cursor: undefined, offset: undefined });
      return { ...result, nextCursor: undefined, retrieval: { engine: "neo4j" as const, match: "semantic" as const, partial: true as const } };
    } catch { return original; }
  }
}
