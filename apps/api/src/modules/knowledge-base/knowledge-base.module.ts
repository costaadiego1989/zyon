import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CatalogModule } from "../catalog/catalog.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
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
import { PrismaKnowledgeRepository } from "./infrastructure/repositories/prisma-knowledge.repository.js";
import { PrismaPolicyRepository } from "./infrastructure/repositories/prisma-policy.repository.js";
import { OnProductUpsertedHandler } from "./infrastructure/event-handlers/on-product-upserted.handler.js";
import { OnFaqUpdatedHandler } from "./infrastructure/event-handlers/on-faq-updated.handler.js";
import { OnConfigUpdatedHandler } from "./infrastructure/event-handlers/on-config-updated.handler.js";
import { MerchantPolicyController } from "./presentation/http/merchant-policy.controller.js";
import { KnowledgeAdminController } from "./presentation/http/knowledge-admin.controller.js";

@Module({
  imports: [CatalogModule, IntegrationsModule],
  controllers: [MerchantPolicyController, KnowledgeAdminController],
  providers: [
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
  ],
  exports: [QueryKnowledgeUseCase, IndexFaqUseCase, IndexProductUseCase, IndexPolicyUseCase, IndexConfigUseCase, BuyerOrderContextService],
})
export class KnowledgeBaseModule {}
