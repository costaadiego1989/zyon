import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CatalogModule } from "../catalog/catalog.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { IndexFaqUseCase } from "./application/use-cases/index-faq.use-case.js";
import { IndexProductUseCase } from "./application/use-cases/index-product.use-case.js";
import { QueryKnowledgeUseCase } from "./application/use-cases/query-knowledge.use-case.js";
import { KNOWLEDGE_REPOSITORY } from "./domain/ports/knowledge-repository.port.js";
import { PrismaKnowledgeRepository } from "./infrastructure/repositories/prisma-knowledge.repository.js";
import { OnProductUpsertedHandler } from "./infrastructure/event-handlers/on-product-upserted.handler.js";
import { OnFaqUpdatedHandler } from "./infrastructure/event-handlers/on-faq-updated.handler.js";

@Module({
  imports: [CatalogModule],
  providers: [
    IndexFaqUseCase,
    IndexProductUseCase,
    QueryKnowledgeUseCase,
    OnProductUpsertedHandler,
    OnFaqUpdatedHandler,
    {
      provide: KNOWLEDGE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaKnowledgeRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
  exports: [QueryKnowledgeUseCase, IndexFaqUseCase, IndexProductUseCase],
})
export class KnowledgeBaseModule {}
