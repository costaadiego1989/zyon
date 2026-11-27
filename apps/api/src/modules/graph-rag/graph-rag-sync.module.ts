import { PublicBusinessReconciler } from "./application/public-business-reconciler.js";
import { PrismaPublicBusinessSourcePages } from "./infrastructure/prisma-public-business-source-pages.js";
import { GraphRagSynchronization } from "./application/graph-sync.service.js";
import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog/catalog.module.js";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module.js";
import { GRAPH_CATALOG_SOURCES, GRAPH_KNOWLEDGE_SOURCES, type GraphCatalogSourcesPort, type GraphKnowledgeSourcesPort } from "./domain/public-graph-sources.port.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../shared/events/domain-event-bus.port.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { GraphRagModule, GraphRagRuntime } from "./graph-rag.module.js";
import { MerchantAssistantModule } from "../merchant-assistant/merchant-assistant.module.js";
import { MERCHANT_GUIDE_SOURCES, type MerchantGuideSourcesPort } from "./domain/merchant-guide-sources.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PrismaPublicBusinessSources } from "./infrastructure/prisma-public-business.sources.js";
import { PublicSourceWorkService } from "./application/public-source-work.service.js";
import { PrismaPublicBusinessIndexAdapter } from "./infrastructure/prisma-public-business-index.js";
import { PublicBusinessIndexWorker } from "./application/public-business-index.worker.js";
import type { PreparedPublicBusinessProjection } from "./application/public-business-projection.service.js";

@Module({ imports: [CatalogModule, KnowledgeBaseModule, GraphRagModule, MerchantAssistantModule], providers: [
  { provide: PrismaPublicBusinessSources,
    useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaPublicBusinessSources(prisma, tenant),
    inject: [PRISMA_CLIENT, TenantContextService] },
  { provide: PublicSourceWorkService,
    useFactory: (prisma: PrismaClient, tenant: TenantContextService, sources: PrismaPublicBusinessSources) => new PublicSourceWorkService(prisma, tenant, sources),
    inject: [PRISMA_CLIENT, TenantContextService, PrismaPublicBusinessSources] },
  { provide: PrismaPublicBusinessSourcePages,
    useFactory: (prisma: PrismaClient, tenant: TenantContextService) => new PrismaPublicBusinessSourcePages(prisma, tenant),
    inject: [PRISMA_CLIENT, TenantContextService] },
  { provide: PublicBusinessReconciler,
    useFactory: (pages: PrismaPublicBusinessSourcePages, work: PublicSourceWorkService) => new PublicBusinessReconciler(pages, work),
    inject: [PrismaPublicBusinessSourcePages, PublicSourceWorkService] },
  { provide: PrismaPublicBusinessIndexAdapter,
    useFactory: (prisma: PrismaClient, tenant: TenantContextService, sources: PrismaPublicBusinessSources, work: PublicSourceWorkService) =>
      new PrismaPublicBusinessIndexAdapter(prisma, tenant, sources, work),
    inject: [PRISMA_CLIENT, TenantContextService, PrismaPublicBusinessSources, PublicSourceWorkService] },
  { provide: PublicBusinessIndexWorker,
    useFactory: (runtime: GraphRagRuntime, admission: PrismaPublicBusinessIndexAdapter) =>
      new PublicBusinessIndexWorker(admission, runtime.publicBusinessProjection, admission, merchantId => runtime.readyFor(merchantId)),
    inject: [GraphRagRuntime, PrismaPublicBusinessIndexAdapter] },
  { provide: GraphRagSynchronization,
  useFactory: (runtime: GraphRagRuntime, catalog: GraphCatalogSourcesPort, knowledge: GraphKnowledgeSourcesPort,
    events: DomainEventBus, tenant: TenantContextService, publicBusiness: PublicBusinessReconciler,
    publicIndexer: PublicBusinessIndexWorker<PreparedPublicBusinessProjection>, guides: MerchantGuideSourcesPort) => new GraphRagSynchronization(runtime, catalog, knowledge, events, tenant, publicBusiness, publicIndexer, guides),
  inject: [GraphRagRuntime, GRAPH_CATALOG_SOURCES, GRAPH_KNOWLEDGE_SOURCES, DOMAIN_EVENT_BUS, TenantContextService, PublicBusinessReconciler, PublicBusinessIndexWorker, MERCHANT_GUIDE_SOURCES] }] })
export class GraphRagSyncModule {}
