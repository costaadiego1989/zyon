import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthModule } from "../auth/auth.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import {
  GetMerchantProfileUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "./application/merchant.use-cases.js";
import { GetMerchantThemeUseCase } from "./application/get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "./application/update-merchant-theme.use-case.js";
import { EnableCryptoPaymentsUseCase } from "./application/use-cases/enable-crypto-payments.use-case.js";
import { MERCHANT_REPOSITORY } from "./domain/ports/merchant-repository.port.js";
import { MERCHANT_RULES_REPOSITORY } from "./domain/ports/merchant-rules.repository.port.js";
import { PrismaMerchantRepository } from "./infrastructure/prisma-merchant.repository.js";
import { PrismaMerchantStoreRepository } from "./infrastructure/prisma-merchant-store.repository.js";
import { MERCHANT_STORE_REPOSITORY } from "./domain/ports/merchant-store.repository.port.js";
import { MerchantStoreService } from "./application/merchant-store.service.js";
import { ActivateMerchantStoreUseCase } from "./application/activate-merchant-store.use-case.js";
import { MerchantController } from "./presentation/merchant.controller.js";
import { CryptoPaymentsController } from "./presentation/http/crypto-payments.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";

@Module({
  imports: [AuthModule],
  controllers: [MerchantController, CryptoPaymentsController],
  providers: [
    GetMerchantProfileUseCase,
    GetMerchantRulesUseCase,
    UpdateMerchantRulesUseCase,
    GetMerchantThemeUseCase,
    UpdateMerchantThemeUseCase,
    EnableCryptoPaymentsUseCase,
    MerchantStoreService,
    ActivateMerchantStoreUseCase,
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: MERCHANT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaMerchantRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    { provide: MERCHANT_RULES_REPOSITORY, useExisting: MERCHANT_REPOSITORY },
    {
      provide: MERCHANT_STORE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaMerchantStoreRepository(prisma),
      inject: [PRISMA_CLIENT],
    }
  ],
  exports: [MERCHANT_REPOSITORY, MERCHANT_RULES_REPOSITORY, GetMerchantThemeUseCase]
})
export class MerchantModule {}
