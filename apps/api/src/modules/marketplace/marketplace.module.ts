import { Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

import { MARKETPLACE_CONFIG_REPOSITORY } from "./domain/ports/marketplace-config-repository.port.js";
import { FEDERATED_PRODUCT_REPOSITORY } from "./domain/ports/federated-product-repository.port.js";
import { CROSS_STORE_ORDER_REPOSITORY } from "./domain/ports/cross-store-order-repository.port.js";
import { MARKETPLACE_SETTLEMENT_REPOSITORY } from "./domain/ports/marketplace-settlement-repository.port.js";
import { MARKETPLACE_SELLER_DEBT_REPOSITORY } from "./domain/ports/marketplace-seller-debt-repository.port.js";

import { PrismaMarketplaceConfigRepository } from "./infrastructure/repositories/prisma-marketplace-config.repository.js";
import { PrismaFederatedProductRepository } from "./infrastructure/repositories/prisma-federated-product.repository.js";
import { PrismaCrossStoreOrderRepository } from "./infrastructure/repositories/prisma-cross-store-order.repository.js";
import { PrismaMarketplaceSettlementRepository } from "./infrastructure/repositories/prisma-marketplace-settlement.repository.js";
import { PrismaMarketplaceSellerDebtRepository } from "./infrastructure/repositories/prisma-marketplace-seller-debt.repository.js";

import { CommissionCalculatorService } from "./domain/services/commission-calculator.service.js";
import { FederatedSearchService } from "./domain/services/federated-search.service.js";
import { SettlementStateMachineService } from "./domain/services/settlement-state-machine.service.js";

import { SearchFederatedProductsUseCase } from "./application/use-cases/search-federated-products.use-case.js";
import { AddCrossStoreItemUseCase } from "./application/use-cases/add-cross-store-item.use-case.js";
import { PlaceCrossStoreOrderUseCase } from "./application/use-cases/place-cross-store-order.use-case.js";
import { UpdateMarketplaceConfigUseCase } from "./application/use-cases/update-marketplace-config.use-case.js";
import { SyncMerchantProductsUseCase } from "./application/use-cases/sync-merchant-products.use-case.js";
import { HandleMarketplaceChargebackUseCase } from "./application/use-cases/handle-marketplace-chargeback.use-case.js";
import { ProcessScheduledTransfersUseCase } from "./application/use-cases/process-scheduled-transfers.use-case.js";
import { GetSellerOrdersUseCase } from "./application/use-cases/get-seller-orders.use-case.js";
import { GetSellerStatsUseCase } from "./application/use-cases/get-seller-stats.use-case.js";
import { ListSellerSettlementsUseCase } from "./application/use-cases/list-seller-settlements.use-case.js";
import { GetSettlementDetailUseCase } from "./application/use-cases/get-settlement-detail.use-case.js";
import { ListSellerDebtsUseCase } from "./application/use-cases/list-seller-debts.use-case.js";
import { GetDebtDetailUseCase } from "./application/use-cases/get-debt-detail.use-case.js";
import { ListMarketplaceChargebacksUseCase } from "./application/use-cases/list-marketplace-chargebacks.use-case.js";
import { ListMarketplaceEventsUseCase } from "./application/use-cases/list-marketplace-events.use-case.js";

import { SyncMarketplaceIndexJob } from "./infrastructure/jobs/sync-marketplace-index.job.js";
import { ProcessTransfersJob } from "./infrastructure/jobs/process-transfers.job.js";
import { FinalizeSettlementsJob } from "./infrastructure/jobs/finalize-settlements.job.js";
import { MarketplaceCatalogSyncScheduler, MarketplaceCatalogSyncWorker } from "./application/handlers/marketplace-catalog-sync.handler.js";

import { MarketplaceController } from "./presentation/http/marketplace.controller.js";
import { MarketplaceDiscoveryController } from "./presentation/http/marketplace-discovery.controller.js";

const prismaProvider = {
  provide: PrismaClient,
  useFactory: () => createPrismaClient(),
};


@Module({
  controllers: [MarketplaceController, MarketplaceDiscoveryController],
  providers: [
    prismaProvider,
    BillingPlanMeteringService,
    PlanLimitGuard,

    // Repositories
    {
      provide: MARKETPLACE_CONFIG_REPOSITORY,
      useClass: PrismaMarketplaceConfigRepository,
    },
    {
      provide: FEDERATED_PRODUCT_REPOSITORY,
      useClass: PrismaFederatedProductRepository,
    },
    {
      provide: CROSS_STORE_ORDER_REPOSITORY,
      useClass: PrismaCrossStoreOrderRepository,
    },
    {
      provide: MARKETPLACE_SETTLEMENT_REPOSITORY,
      useClass: PrismaMarketplaceSettlementRepository,
    },
    {
      provide: MARKETPLACE_SELLER_DEBT_REPOSITORY,
      useClass: PrismaMarketplaceSellerDebtRepository,
    },

    // Domain Services
    CommissionCalculatorService,
    SettlementStateMachineService,
    {
      provide: FederatedSearchService,
      useFactory: (productRepo: PrismaFederatedProductRepository) =>
        new FederatedSearchService(productRepo),
      inject: [FEDERATED_PRODUCT_REPOSITORY],
    },

    // Use Cases
    {
      provide: SearchFederatedProductsUseCase,
      useFactory: (
        productRepo: PrismaFederatedProductRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        searchService: FederatedSearchService,
      ) =>
        new SearchFederatedProductsUseCase(
          productRepo,
          configRepo,
          searchService,
        ),
      inject: [
        FEDERATED_PRODUCT_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        FederatedSearchService,
      ],
    },
    {
      provide: AddCrossStoreItemUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        productRepo: PrismaFederatedProductRepository,
        commissionCalc: CommissionCalculatorService,
      ) =>
        new AddCrossStoreItemUseCase(
          orderRepo,
          configRepo,
          productRepo,
          commissionCalc,
        ),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        FEDERATED_PRODUCT_REPOSITORY,
        CommissionCalculatorService,
      ],
    },
    {
      provide: PlaceCrossStoreOrderUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
        configRepo: PrismaMarketplaceConfigRepository,
        stateMachine: SettlementStateMachineService,
      ) =>
        new PlaceCrossStoreOrderUseCase(
          orderRepo,
          settlementRepo,
          configRepo,
          stateMachine,
        ),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_CONFIG_REPOSITORY,
        SettlementStateMachineService,
      ],
    },
    {
      provide: UpdateMarketplaceConfigUseCase,
      useFactory: (configRepo: PrismaMarketplaceConfigRepository) =>
        new UpdateMarketplaceConfigUseCase(configRepo),
      inject: [MARKETPLACE_CONFIG_REPOSITORY],
    },
    {
      provide: SyncMerchantProductsUseCase,
      useFactory: (productRepo: PrismaFederatedProductRepository) =>
        new SyncMerchantProductsUseCase(productRepo),
      inject: [FEDERATED_PRODUCT_REPOSITORY],
    },
    {
      provide: HandleMarketplaceChargebackUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        stateMachine: SettlementStateMachineService,
      ) =>
        new HandleMarketplaceChargebackUseCase(
          settlementRepo,
          debtRepo,
          stateMachine,
        ),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        SettlementStateMachineService,
      ],
    },
    {
      provide: ProcessScheduledTransfersUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        stateMachine: SettlementStateMachineService,
      ) =>
        new ProcessScheduledTransfersUseCase(settlementRepo, stateMachine),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY, SettlementStateMachineService],
    },
    {
      provide: GetSellerOrdersUseCase,
      useFactory: (orderRepo: PrismaCrossStoreOrderRepository) =>
        new GetSellerOrdersUseCase(orderRepo),
      inject: [CROSS_STORE_ORDER_REPOSITORY],
    },
    {
      provide: GetSellerStatsUseCase,
      useFactory: (
        orderRepo: PrismaCrossStoreOrderRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
      ) =>
        new GetSellerStatsUseCase(orderRepo, settlementRepo, debtRepo),
      inject: [
        CROSS_STORE_ORDER_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
      ],
    },
    {
      provide: ListSellerSettlementsUseCase,
      useFactory: (settlementRepo: PrismaMarketplaceSettlementRepository) =>
        new ListSellerSettlementsUseCase(settlementRepo),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY],
    },
    {
      provide: GetSettlementDetailUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        stateMachine: SettlementStateMachineService,
      ) =>
        new GetSettlementDetailUseCase(settlementRepo, debtRepo, stateMachine),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        SettlementStateMachineService,
      ],
    },
    {
      provide: ListSellerDebtsUseCase,
      useFactory: (debtRepo: PrismaMarketplaceSellerDebtRepository) =>
        new ListSellerDebtsUseCase(debtRepo),
      inject: [MARKETPLACE_SELLER_DEBT_REPOSITORY],
    },
    {
      provide: GetDebtDetailUseCase,
      useFactory: (
        debtRepo: PrismaMarketplaceSellerDebtRepository,
        settlementRepo: PrismaMarketplaceSettlementRepository,
      ) =>
        new GetDebtDetailUseCase(debtRepo, settlementRepo),
      inject: [
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
        MARKETPLACE_SETTLEMENT_REPOSITORY,
      ],
    },
    {
      provide: ListMarketplaceChargebacksUseCase,
      useFactory: (
        settlementRepo: PrismaMarketplaceSettlementRepository,
        debtRepo: PrismaMarketplaceSellerDebtRepository,
      ) =>
        new ListMarketplaceChargebacksUseCase(settlementRepo, debtRepo),
      inject: [
        MARKETPLACE_SETTLEMENT_REPOSITORY,
        MARKETPLACE_SELLER_DEBT_REPOSITORY,
      ],
    },
    {
      provide: ListMarketplaceEventsUseCase,
      useFactory: (settlementRepo: PrismaMarketplaceSettlementRepository) =>
        new ListMarketplaceEventsUseCase(settlementRepo),
      inject: [MARKETPLACE_SETTLEMENT_REPOSITORY],
    },

    // Background Jobs
    SyncMarketplaceIndexJob,
    ProcessTransfersJob,
    FinalizeSettlementsJob,

    // Event Handlers (BullMQ: event-driven sync from Catalog → Federated Index)
    MarketplaceCatalogSyncScheduler,
    MarketplaceCatalogSyncWorker,
  ],
  exports: [
    SearchFederatedProductsUseCase,
    AddCrossStoreItemUseCase,
    PlaceCrossStoreOrderUseCase,
    UpdateMarketplaceConfigUseCase,
    SyncMerchantProductsUseCase,
    HandleMarketplaceChargebackUseCase,
    ProcessScheduledTransfersUseCase,
    GetSellerOrdersUseCase,
    GetSellerStatsUseCase,
    ListSellerSettlementsUseCase,
    GetSettlementDetailUseCase,
    ListSellerDebtsUseCase,
    GetDebtDetailUseCase,
    ListMarketplaceChargebacksUseCase,
    ListMarketplaceEventsUseCase,
  ],
})
export class MarketplaceModule {}
