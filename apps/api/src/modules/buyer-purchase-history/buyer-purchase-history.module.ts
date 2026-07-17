import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthModule } from "../auth/auth.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import {
  GetBuyerPurchaseContextUseCase,
  RecordCompletedPurchaseUseCase
} from "./application/buyer-purchase-history.use-cases.js";
import { BUYER_PURCHASE_HISTORY_REPOSITORY } from "./domain/ports/buyer-purchase-history-repository.port.js";
import { BUYER_IDENTITY_REPOSITORY } from "./domain/ports/buyer-identity.repository.port.js";
import { PrismaBuyerIdentityRepository } from "./infrastructure/prisma-buyer-identity.repository.js";
import { PrismaBuyerPurchaseHistoryRepository } from "./infrastructure/prisma-buyer-purchase-history.repository.js";
import { BuyerPurchaseHistoryController } from "./presentation/http/buyer-purchase-history.controller.js";
import { BUYER_PURCHASE_HISTORY_CONFIG } from "./domain/buyer-purchase-history.config.js";
import { createBuyerPurchaseHistoryConfig } from "./infrastructure/buyer-purchase-history.config.factory.js";

@Module({
  imports: [AuthModule],
  controllers: [BuyerPurchaseHistoryController],
  providers: [
    RecordCompletedPurchaseUseCase,
    GetBuyerPurchaseContextUseCase,
    {
      provide: BUYER_IDENTITY_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaBuyerIdentityRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: BUYER_PURCHASE_HISTORY_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaBuyerPurchaseHistoryRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: BUYER_PURCHASE_HISTORY_CONFIG,
      useFactory: () => createBuyerPurchaseHistoryConfig()
    }
  ],
  exports: [
    RecordCompletedPurchaseUseCase,
    GetBuyerPurchaseContextUseCase,
    BUYER_IDENTITY_REPOSITORY,
    BUYER_PURCHASE_HISTORY_REPOSITORY,
    BUYER_PURCHASE_HISTORY_CONFIG
  ]
})
export class BuyerPurchaseHistoryModule {}
