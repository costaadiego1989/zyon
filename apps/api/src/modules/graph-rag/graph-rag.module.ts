import { Module, Logger } from "@nestjs/common";
import type { OnModuleInit, OnApplicationShutdown } from "@nestjs/common";
import { GRAPH_RETRIEVAL, type GraphCatalogRequest, type GraphConnectionSettings, type GraphRetrievalPort, type GraphRuntimeAdapter, type GraphMerchantGuideRequest } from "./domain/graph-rag.port.js";
import { graphRagSettings } from "./graph-rag.settings.js";
import { Neo4jGraphAdapter } from "./infrastructure/neo4j-graph.adapter.js";
import { GraphLocalEmbeddingService } from "./infrastructure/graph-local-embedding.service.js";
import { GraphRetrievalService } from "./application/graph-retrieval.service.js";
import { GraphProjectionService } from "./application/graph-projection.service.js";
import { CommunityGatewayAdapter } from "./infrastructure/community-gateway.adapter.js";
import { PublicBusinessProjectionService } from "./application/public-business-projection.service.js";
import { PublicBusinessRetrievalService, type PublicBusinessRequest } from "./application/public-business-retrieval.service.js";

export class GraphRagRuntime implements GraphRetrievalPort, OnModuleInit, OnApplicationShutdown {
  private ready = false;
  private publicReady = false;
  private stopping = false;
  private retry?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(GraphRagRuntime.name);
  readonly projection: GraphProjectionService;
  readonly publicBusinessProjection: PublicBusinessProjectionService;
  private readonly retrieval: GraphRetrievalService;
  private readonly publicRetrieval: PublicBusinessRetrievalService;
  constructor(readonly settings: GraphConnectionSettings, private readonly adapter: GraphRuntimeAdapter = settings.queryMode === "community_gateway"
    ? new CommunityGatewayAdapter(settings) : new Neo4jGraphAdapter(settings),
    embeddings = new GraphLocalEmbeddingService()) {
    this.projection = new GraphProjectionService(adapter, embeddings);
    this.publicBusinessProjection = new PublicBusinessProjectionService(adapter, embeddings);
    this.retrieval = new GraphRetrievalService({ ...settings, timeoutMs: 2500, maxAgeMs: 300_000, threshold: 0.65 }, embeddings, adapter);
    this.publicRetrieval = new PublicBusinessRetrievalService({ ...settings, timeoutMs: 2500, maxAgeMs: 300_000, threshold: 0.65 }, embeddings,
      { readPublic: input => adapter.readPublic ? adapter.readPublic(input) : Promise.resolve({ status: "unavailable", reason: "disabled" }) });
  }
  enabledFor(merchantId: string) { return this.settings.enabled && this.settings.merchantIds.includes(merchantId); }
  readyFor(merchantId: string) { return !this.stopping && this.ready && this.enabledFor(merchantId); }
  publicReadyFor(merchantId: string) { return !this.stopping && this.publicReady && this.enabledFor(merchantId); }
  async onModuleInit() {
    if (this.stopping || !this.settings.enabled) return;
    this.ready = await this.adapter.admitReader();
    this.publicReady = await this.adapter.admitPublicReader?.() ?? false;
    if (!this.ready) this.logger.warn("GraphRAG admission unavailable; graph reads and synchronization remain disabled");
    this.retry = setInterval(() => {
      if (!this.ready && !this.stopping) void this.adapter.admitReader().then(ready => { if (!this.stopping) this.ready = ready; });
      if (!this.publicReady && !this.stopping) void this.adapter.admitPublicReader?.().then(ready => { if (!this.stopping) this.publicReady = ready; });
    }, 30_000);
    this.retry.unref();
  }
  async searchCatalog(input: GraphCatalogRequest) {
    return this.readyFor(input.merchantId) ? this.retrieval.searchCatalog(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async searchKnowledge(input: Pick<GraphCatalogRequest, "merchantId" | "query" | "limit">) {
    return this.readyFor(input.merchantId) ? this.retrieval.searchKnowledge(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async searchMerchantGuides(input: GraphMerchantGuideRequest) {
    return this.readyFor(input.merchantId) ? this.retrieval.searchMerchantGuides(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async searchPublicBusiness(input: PublicBusinessRequest) {
    return this.publicReadyFor(input.merchantId) ? this.publicRetrieval.search(input)
      : { status: "unavailable" as const, reason: "disabled" as const };
  }
  async onApplicationShutdown() { this.stopping = true;this.ready = false;this.publicReady = false;if (this.retry) clearInterval(this.retry);await this.adapter.close(); }
}
@Module({ providers: [{ provide: GraphRagRuntime, useFactory: () => new GraphRagRuntime(graphRagSettings(process.env)) },
  { provide: GRAPH_RETRIEVAL, useExisting: GraphRagRuntime }], exports: [GRAPH_RETRIEVAL, GraphRagRuntime] })
export class GraphRagModule {}
