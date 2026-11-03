import { GraphRagSynchronization } from "./application/graph-sync.service.js";
import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module.js";
import { GRAPH_CATALOG_SOURCES, GRAPH_KNOWLEDGE_SOURCES, type GraphCatalogSourcesPort, type GraphKnowledgeSourcesPort } from "./domain/public-graph-sources.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../shared/events/domain-event-bus.port.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { GraphRagModule, GraphRagRuntime } from "./graph-rag.module.js";

@Module({ imports: [CatalogModule, KnowledgeBaseModule, GraphRagModule], providers: [{ provide: GraphRagSynchronization,
  useFactory: (runtime: GraphRagRuntime, catalog: GraphCatalogSourcesPort, knowledge: GraphKnowledgeSourcesPort,
    events: DomainEventBus, tenant: TenantContextService) => new GraphRagSynchronization(runtime, catalog, knowledge, events, tenant),
  inject: [GraphRagRuntime, GRAPH_CATALOG_SOURCES, GRAPH_KNOWLEDGE_SOURCES, DOMAIN_EVENT_BUS, TenantContextService] }] })
export class GraphRagSyncModule {}
