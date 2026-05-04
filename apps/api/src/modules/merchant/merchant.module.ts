import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { createPrismaClient } from "../checkout/infrastructure/prisma/prisma-client.js";
import {
  GetMerchantProfileUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "./application/merchant.use-cases.js";
import { MERCHANT_REPOSITORY } from "./domain/ports/merchant-repository.port.js";
import { InMemoryMerchantRepository } from "./infrastructure/in-memory-merchant.repository.js";
import { PrismaMerchantRepository } from "./infrastructure/prisma-merchant.repository.js";
import { MerchantController } from "./presentation/merchant.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [MerchantController],
  providers: [
    GetMerchantProfileUseCase,
    GetMerchantRulesUseCase,
    UpdateMerchantRulesUseCase,
    InMemoryMerchantRepository,
    {
      provide: MERCHANT_REPOSITORY,
      useFactory: (inMemory: InMemoryMerchantRepository) => {
        if (process.env.MERCHANT_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaMerchantRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryMerchantRepository]
    }
  ],
  exports: [MERCHANT_REPOSITORY]
})
export class MerchantModule {}
