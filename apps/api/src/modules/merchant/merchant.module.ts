import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import {
  GetMerchantProfileUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "./application/merchant.use-cases.js";
import { GetMerchantThemeUseCase } from "./application/get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "./application/update-merchant-theme.use-case.js";
import { MERCHANT_REPOSITORY } from "./domain/ports/merchant-repository.port.js";
import { MERCHANT_RULES_REPOSITORY } from "./domain/ports/merchant-rules.repository.port.js";
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
    GetMerchantThemeUseCase,
    UpdateMerchantThemeUseCase,
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
    },
    { provide: MERCHANT_RULES_REPOSITORY, useExisting: MERCHANT_REPOSITORY }
  ],
  exports: [MERCHANT_REPOSITORY, MERCHANT_RULES_REPOSITORY]
})
export class MerchantModule {}
