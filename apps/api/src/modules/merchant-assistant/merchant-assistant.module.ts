import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PersistenceModule, PRISMA_CROSS_MERCHANT_CLIENT } from '../../shared/persistence/persistence.module.js';
import { TenantContextService } from '../../shared/tenant/tenant-context.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AiMeteringModule } from '../ai-metering/ai-metering.module.js';
import { AiGovernanceService } from '../ai-governance/ai-governance.service.js';
import { MerchantModule } from '../merchant/merchant.module.js';
import { MERCHANT_STORE_REPOSITORY, type MerchantStoreRepository } from '../merchant/domain/ports/merchant-store.repository.port.js';
import { AssistantContextRegistry } from './application/assistant-context.registry.js';
import { AssistantApiService } from './application/assistant-api.service.js';
import { createMerchantAssistantRuntime, type MerchantAssistantRuntime } from './infrastructure/runtime.js';
import { AssistantWorker } from './infrastructure/assistant.worker.js';
import { AssistantHttpErrorFilter, MerchantAssistantController } from './presentation/merchant-assistant.controller.js';
import { MERCHANT_GUIDE_SOURCES } from '../graph-rag/domain/merchant-guide-sources.port.js';
import { cashbackMerchantGuideSources } from './infrastructure/knowledge/cashback.pt-BR.js';
import { GraphRagModule } from '../graph-rag/graph-rag.module.js';
import { GRAPH_RETRIEVAL, type GraphRetrievalPort } from '../graph-rag/domain/graph-rag.port.js';

export const MERCHANT_ASSISTANT_RUNTIME = Symbol('MerchantAssistantRuntime');
@Module({
  imports: [PersistenceModule, AuthModule, MerchantModule, AiMeteringModule, GraphRagModule],
  controllers: [MerchantAssistantController],
  providers: [
    { provide: MERCHANT_GUIDE_SOURCES, useValue: cashbackMerchantGuideSources },
    { provide: MERCHANT_ASSISTANT_RUNTIME, useFactory: (prisma: PrismaClient, memberships: MerchantStoreRepository, tenant: TenantContextService, governance: AiGovernanceService, graph: GraphRetrievalPort) => createMerchantAssistantRuntime({ prisma, memberships, tenant, governance, graph, env: process.env }), inject: [PRISMA_CROSS_MERCHANT_CLIENT, MERCHANT_STORE_REPOSITORY, TenantContextService, AiGovernanceService, GRAPH_RETRIEVAL] },
    { provide: AssistantContextRegistry, useFactory: (value: MerchantAssistantRuntime) => value.contexts, inject: [MERCHANT_ASSISTANT_RUNTIME] },
    { provide: AssistantApiService, useFactory: (value: MerchantAssistantRuntime) => value.api, inject: [MERCHANT_ASSISTANT_RUNTIME] },
    { provide: AssistantWorker, useFactory: (value: MerchantAssistantRuntime) => value.worker, inject: [MERCHANT_ASSISTANT_RUNTIME] },
    AssistantHttpErrorFilter,
  ],
  exports: [MERCHANT_ASSISTANT_RUNTIME, AssistantContextRegistry, AssistantApiService, MERCHANT_GUIDE_SOURCES],
})
export class MerchantAssistantModule {}
