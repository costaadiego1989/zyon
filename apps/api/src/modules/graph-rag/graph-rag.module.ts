import { Module, Logger } from "@nestjs/common";
import type { OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { GRAPH_RETRIEVAL, type GraphCatalogRequest, type GraphConnectionSettings, type GraphRetrievalPort } from "./domain/graph-rag.port.js";
import { graphRagSettings } from "./graph-rag.settings.js";
import { Neo4jGraphAdapter } from "./infrastructure/neo4j-graph.adapter.js";
import { GraphLocalEmbeddingService } from "./infrastructure/graph-local-embedding.service.js";
import { GraphRetrievalService } from "./application/graph-retrieval.service.js";
import { GraphProjectionService } from "./application/graph-projection.service.js";

export class GraphRagRuntime implements GraphRetrievalPort, OnModuleInit, OnApplicationShutdown {
  private ready = false;
  private readonly logger = new Logger(GraphRagRuntime.name);
  readonly projection: GraphProjectionService;
  private readonly retrieval: GraphRetrievalService;
  constructor(readonly settings: GraphConnectionSettings, private readonly adapter = new Neo4jGraphAdapter(settings),
    embeddings = new GraphLocalEmbeddingService()) {
    this.projection = new GraphProjectionService(adapter, embeddings);
    this.retrieval = new GraphRetrievalService({ ...settings, timeoutMs: 2500, maxAgeMs: 300_000, threshold: 0.65 }, embeddings, adapter);
  }
  enabledFor(merchantId: string) { return this.settings.enabled && this.settings.merchantIds.includes(merchantId); }
  readyFor(merchantId: string) { return this.ready && this.enabledFor(merchantId); }
  async onModuleInit() {
    if (!this.settings.enabled) return;
    this.ready = await this.adapter.admitReader();
    if (!this.ready) this.logger.warn("GraphRAG admission unavailable; graph reads and synchronization remain disabled");
  }
  async searchCatalog(input: GraphCatalogRequest) {
    return this.readyFor(input.merchantId) ? this.retrieval.searchCatalog(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async searchKnowledge(input: Pick<GraphCatalogRequest, "merchantId" | "query" | "limit">) {
    return this.readyFor(input.merchantId) ? this.retrieval.searchKnowledge(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async onApplicationShutdown() { await this.adapter.close(); }
}
@Module({ providers: [{ provide: GraphRagRuntime, useFactory: () => new GraphRagRuntime(graphRagSettings(process.env)) },
  { provide: GRAPH_RETRIEVAL, useExisting: GraphRagRuntime }], exports: [GRAPH_RETRIEVAL, GraphRagRuntime] })
export class GraphRagModule {}
