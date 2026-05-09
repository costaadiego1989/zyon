import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import {
  GetBuyerPurchaseContextUseCase,
  RecordCompletedPurchaseUseCase
} from "./application/buyer-purchase-history.use-cases.js";
import { BUYER_PURCHASE_HISTORY_REPOSITORY } from "./domain/ports/buyer-purchase-history-repository.port.js";
import { BUYER_IDENTITY_REPOSITORY } from "./domain/ports/buyer-identity.repository.port.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "./infrastructure/in-memory-buyer-purchase-history.repository.js";
import { InMemoryBuyerIdentityRepository } from "./infrastructure/in-memory-buyer-identity.repository.js";
import { PrismaBuyerPurchaseHistoryRepository } from "./infrastructure/prisma-buyer-purchase-history.repository.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { BuyerPurchaseHistoryController } from "./presentation/http/buyer-purchase-history.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [BuyerPurchaseHistoryController],
  providers: [
    InMemoryBuyerPurchaseHistoryRepository,
    InMemoryBuyerIdentityRepository,
    RecordCompletedPurchaseUseCase,
    GetBuyerPurchaseContextUseCase,
    {
      provide: BUYER_IDENTITY_REPOSITORY,
      useClass: InMemoryBuyerIdentityRepository
    },
    {
      provide: BUYER_PURCHASE_HISTORY_REPOSITORY,
      useFactory: (inMemory: InMemoryBuyerPurchaseHistoryRepository) => {
        if (
          process.env.BUYER_PURCHASE_HISTORY_REPOSITORY === "prisma" ||
          process.env.CHECKOUT_REPOSITORY === "prisma"
        ) {
          return new PrismaBuyerPurchaseHistoryRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryBuyerPurchaseHistoryRepository]
    }
  ],
  exports: [RecordCompletedPurchaseUseCase, GetBuyerPurchaseContextUseCase, BUYER_IDENTITY_REPOSITORY]
})
export class BuyerPurchaseHistoryModule {}
