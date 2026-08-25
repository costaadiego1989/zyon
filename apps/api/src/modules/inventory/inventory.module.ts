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
import { INVENTORY_REPOSITORY } from "./domain/ports/inventory-repository.port.js";
import { INVENTORY_MOVEMENT_REPOSITORY } from "./domain/ports/inventory-movement-repository.port.js";
import { INVENTORY_ALERT_REPOSITORY } from "./domain/ports/inventory-alert-repository.port.js";
import { INVENTORY_LOCATION_REPOSITORY } from "./domain/ports/inventory-location-repository.port.js";
import { PrismaInventoryRepository } from "./infrastructure/repositories/prisma-inventory.repository.js";
import { PrismaInventoryMovementRepository } from "./infrastructure/repositories/prisma-inventory-movement.repository.js";
import { PrismaInventoryAlertRepository } from "./infrastructure/repositories/prisma-inventory-alert.repository.js";
import { PrismaInventoryLocationRepository } from "./infrastructure/repositories/prisma-inventory-location.repository.js";
import { InventoryDashboardController } from "./presentation/http/inventory-dashboard.controller.js";

@Module({
  controllers: [InventoryDashboardController],
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
    ListInventoryUseCase,
    RecordMovementUseCase,
    TransferStockUseCase,
    GetDashboardSummaryUseCase,
    ListMovementsUseCase,
    ListAlertsUseCase,
    AcknowledgeAlertUseCase,
    ListLocationsUseCase,
    CreateLocationUseCase,
  ],
  exports: [
    INVENTORY_REPOSITORY,
    INVENTORY_MOVEMENT_REPOSITORY,
    INVENTORY_ALERT_REPOSITORY,
    INVENTORY_LOCATION_REPOSITORY,
  ],
})
export class InventoryModule {}
