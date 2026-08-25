import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { ListInventoryUseCase } from "./application/use-cases/list-inventory.use-case.js";
import { RecordMovementUseCase } from "./application/use-cases/record-movement.use-case.js";
import { TransferStockUseCase } from "./application/use-cases/transfer-stock.use-case.js";
import { GetDashboardSummaryUseCase } from "./application/use-cases/get-dashboard-summary.use-case.js";
import { ListMovementsUseCase } from "./application/use-cases/list-movements.use-case.js";
import { ListAlertsUseCase } from "./application/use-cases/list-alerts.use-case.js";
import { AcknowledgeAlertUseCase } from "./application/use-cases/acknowledge-alert.use-case.js";
import { ListLocationsUseCase } from "./application/use-cases/list-locations.use-case.js";
import { CreateLocationUseCase } from "./application/use-cases/create-location.use-case.js";
import { HandleSaleCompletedUseCase } from "./application/use-cases/handle-sale-completed.use-case.js";
import { ListCrmConnectionsUseCase } from "./application/use-cases/list-crm-connections.use-case.js";
import { ConnectCrmUseCase } from "./application/use-cases/connect-crm.use-case.js";
import { DisconnectCrmUseCase } from "./application/use-cases/disconnect-crm.use-case.js";
import { ListErpConnectionsUseCase } from "./application/use-cases/list-erp-connections.use-case.js";
import { ConnectOmieUseCase } from "./application/use-cases/connect-omie.use-case.js";
import { DisconnectErpUseCase } from "./application/use-cases/disconnect-erp.use-case.js";
import { TriggerMarketplaceSyncUseCase } from "./application/use-cases/trigger-marketplace-sync.use-case.js";
import { MarketplaceStockPushService } from "./application/services/marketplace-stock-push.service.js";
import { INVENTORY_REPOSITORY } from "./domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY } from "./domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_ALERT_REPOSITORY } from "./domain/ports/inventory-alert-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY } from "./domain/ports/inventory-location-repository.port.js";
import { CRM_PROVIDER_PORT } from "./domain/ports/crm-provider.port.js";
import { CRM_CONNECTION_REPOSITORY } from "./domain/ports/crm-connection-repository.port.js";
import { ERP_REPOSITORY } from "./domain/ports/erp-repository.port.js";
import { PrismaInventoryRepository } from "./infrastructure/repositories/prisma-inventory.repository.js";
import { PrismaInventoryMovementRepository } from "./infrastructure/repositories/prisma-inventory-movement.repository.js";
import { PrismaInventoryAlertRepository } from "./infrastructure/repositories/prisma-inventory-alert.repository.js";
import { PrismaInventoryLocationRepository } from "./infrastructure/repositories/prisma-inventory-location.repository.js";
import { PrismaCrmConnectionRepository } from "./infrastructure/repositories/prisma-crm-connection.repository.js";
import { PrismaErpRepository } from "./infrastructure/repositories/prisma-erp.repository.js";
import { NoopCrmAdapter } from "./infrastructure/adapters/noop-crm.adapter.js";
import { CrmAdapterFactory } from "./infrastructure/adapters/crm-adapter.factory.js";
import { OnSaleCompletedHandler } from "./infrastructure/event-handlers/on-sale-completed.handler.js";
import { InventoryOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { ErpStockPushService } from "./application/services/erp-stock-push.service.js";
import { InventoryWebhookEmitterService } from "./application/services/inventory-webhook-emitter.service.js";
import { CrmSyncService } from "./application/services/crm-sync.service.js";
import { InventoryDashboardController } from "./presentation/http/inventory-dashboard.controller.js";
import { ErpOAuthController } from "./presentation/http/erp-oauth.controller.js";

@Module({
  controllers: [InventoryDashboardController, ErpOAuthController],
  providers: [
    {
      provide: INVENTORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaInventoryRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: INVENTORY_MOVEMENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaInventoryMovementRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: INVENTORY_ALERT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaInventoryAlertRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: INVENTORY_LOCATION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaInventoryLocationRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: CRM_CONNECTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCrmConnectionRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: ERP_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaErpRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: CRM_PROVIDER_PORT,
      useClass: NoopCrmAdapter,
    },
    ListInventoryUseCase,
    RecordMovementUseCase,
    TransferStockUseCase,
    GetDashboardSummaryUseCase,
    ListMovementsUseCase,
    ListAlertsUseCase,
    AcknowledgeAlertUseCase,
    ListLocationsUseCase,
    CreateLocationUseCase,
    ListCrmConnectionsUseCase,
    ConnectCrmUseCase,
    DisconnectCrmUseCase,
    ListErpConnectionsUseCase,
    ConnectOmieUseCase,
    DisconnectErpUseCase,
    TriggerMarketplaceSyncUseCase,
    MarketplaceStockPushService,
    OnSaleCompletedHandler,
    ErpStockPushService,
    InventoryWebhookEmitterService,
    CrmSyncService,
    CrmAdapterFactory,
    HandleSaleCompletedUseCase,
    InventoryOnOrderCompletedHandler,
  ],
  exports: [
    INVENTORY_REPOSITORY,
    INVENTORY_MOVEMENT_REPOSITORY,
    INVENTORY_ALERT_REPOSITORY,
    INVENTORY_LOCATION_REPOSITORY,
    HandleSaleCompletedUseCase,
  ],
})
export class InventoryModule {}
