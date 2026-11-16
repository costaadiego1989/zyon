import { Module } from "@nestjs/common";
import { GraphRagModule } from "../graph-rag/graph-rag.module.js";
import { GRAPH_RETRIEVAL, type GraphRetrievalPort } from "../graph-rag/domain/graph-rag.port.js";
import { GRAPH_KNOWLEDGE_SOURCES, type GraphKnowledgeSourcesPort } from "../graph-rag/domain/public-graph-sources.port.js";
import { PublicSupportKnowledgeModule } from "../support/public-support-knowledge.module.js";
import { PUBLIC_SUPPORT_FAQ, type PublicSupportFaqPort } from "../support/domain/ports/public-support-faq.port.js";
import { PUBLIC_KNOWLEDGE_SEARCH } from "./domain/ports/public-knowledge-search.port.js";
import { PublishedGraphKnowledgeSources } from "./infrastructure/published-graph-knowledge.sources.js";
import { GraphKnowledgeReader } from "./infrastructure/graph-knowledge.reader.js";
import type { PrismaClient } from "@prisma/client";
import { CatalogModule } from "../catalog/catalog.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";
import { IndexFaqUseCase } from "./application/use-cases/index-faq.use-case.js";
import { IndexProductUseCase } from "./application/use-cases/index-product.use-case.js";
import { IndexPolicyUseCase } from "./application/use-cases/index-policy.use-case.js";
import { IndexConfigUseCase } from "./application/use-cases/index-config.use-case.js";
import { GetPolicyUseCase } from "./application/use-cases/get-policy.use-case.js";
import { UpdatePolicyUseCase } from "./application/use-cases/update-policy.use-case.js";
import { QueryKnowledgeUseCase } from "./application/use-cases/query-knowledge.use-case.js";
import { BuyerOrderContextService } from "./application/services/buyer-order-context.service.js";
import { KNOWLEDGE_REPOSITORY } from "./domain/ports/knowledge-repository.port.js";
import { POLICY_REPOSITORY } from "./domain/ports/policy-repository.port.js";
import { EMBEDDING_PORT } from "./domain/ports/embedding.port.js";
import { LocalEmbeddingService } from "./infrastructure/services/local-embedding.service.js";
import { PrismaKnowledgeRepository } from "./infrastructure/repositories/prisma-knowledge.repository.js";
import { PrismaPolicyRepository } from "./infrastructure/repositories/prisma-policy.repository.js";
import { OnProductUpsertedHandler } from "./infrastructure/event-handlers/on-product-upserted.handler.js";
import { OnFaqUpdatedHandler } from "./infrastructure/event-handlers/on-faq-updated.handler.js";
import { OnConfigUpdatedHandler } from "./infrastructure/event-handlers/on-config-updated.handler.js";
import { MerchantPolicyController } from "./presentation/http/merchant-policy.controller.js";
import { KnowledgeAdminController } from "./presentation/http/knowledge-admin.controller.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { RevalidatePublicSourceService } from "./application/use-cases/revalidate-public-source.service.js";
import { PrismaPublicEvidenceSources } from "./infrastructure/prisma-public-evidence.sources.js";
import { AuditModule } from "../audit/audit.module.js";
import { RecordAuditEventUseCase } from "../audit/application/audit.use-cases.js";
import { KnowledgeResponseAuditService } from "./application/services/knowledge-response-audit.service.js";

@Module({
  imports: [CatalogModule, IntegrationsModule, GraphRagModule, PublicSupportKnowledgeModule, AuditModule],
  controllers: [MerchantPolicyController, KnowledgeAdminController],
  providers: [
    { provide: KnowledgeResponseAuditService, useFactory: (audit: RecordAuditEventUseCase, tenant: TenantContextService) =>
      new KnowledgeResponseAuditService(audit, tenant), inject: [RecordAuditEventUseCase, TenantContextService] },
    { provide: RevalidatePublicSourceService, useFactory: (prisma: PrismaClient, tenant: TenantContextService) =>
      new RevalidatePublicSourceService(new PrismaPublicEvidenceSources(prisma, tenant)), inject: [PRISMA_CLIENT, TenantContextService] },
    { provide: GRAPH_KNOWLEDGE_SOURCES, useFactory: (prisma: PrismaClient, faq: PublicSupportFaqPort) => new PublishedGraphKnowledgeSources(new PrismaPolicyRepository(prisma), faq), inject: [PRISMA_CLIENT, PUBLIC_SUPPORT_FAQ] },
    { provide: PUBLIC_KNOWLEDGE_SEARCH, useFactory: (graph: GraphRetrievalPort, sources: GraphKnowledgeSourcesPort) => new GraphKnowledgeReader(graph, sources), inject: [GRAPH_RETRIEVAL, GRAPH_KNOWLEDGE_SOURCES] },
    BillingPlanMeteringService,
    PlanLimitGuard,
    IndexFaqUseCase,
    IndexProductUseCase,
    IndexPolicyUseCase,
    IndexConfigUseCase,
    GetPolicyUseCase,
    UpdatePolicyUseCase,
    QueryKnowledgeUseCase,
    BuyerOrderContextService,
    OnProductUpsertedHandler,
    OnFaqUpdatedHandler,
    OnConfigUpdatedHandler,
    {
      provide: KNOWLEDGE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaKnowledgeRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: POLICY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPolicyRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    // Knowledge base uses a local offline embedding model (384 dims) so RAG
    // works without an OpenAI key. Catalog product search keeps its own
    // EmbeddingService (OpenAI/ILIKE) — the two indexes are independent.
    LocalEmbeddingService,
    { provide: EMBEDDING_PORT, useExisting: LocalEmbeddingService },
  ],
  exports: [GRAPH_KNOWLEDGE_SOURCES, QueryKnowledgeUseCase, IndexFaqUseCase, IndexProductUseCase, IndexPolicyUseCase, IndexConfigUseCase, BuyerOrderContextService, KnowledgeResponseAuditService],
})
export class KnowledgeBaseModule {}
