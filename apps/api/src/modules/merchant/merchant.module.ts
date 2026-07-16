import { Logger, Module, OnModuleInit, forwardRef } from "@nestjs/common";
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
import { EVM_PAYMENTS_CONFIG, createEvmPaymentsConfig, type EvmPaymentsConfig } from "./domain/services/evm-payments-config.js";
import { PrismaMerchantRepository } from "./infrastructure/prisma-merchant.repository.js";
import { MerchantController } from "./presentation/merchant.controller.js";
import { CryptoPaymentsController } from "./presentation/http/crypto-payments.controller.js";

const logger = new Logger("MerchantModule");

/**
 * EVM payments config validated at module init. Logs warning if env var missing
 * instead of crashing at first crypto-payments request.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [MerchantController, CryptoPaymentsController],
  providers: [
    GetMerchantProfileUseCase,
    GetMerchantRulesUseCase,
    UpdateMerchantRulesUseCase,
    GetMerchantThemeUseCase,
    UpdateMerchantThemeUseCase,
    EnableCryptoPaymentsUseCase,
    {
      provide: EVM_PAYMENTS_CONFIG,
      useFactory: () => createEvmPaymentsConfig(),
    },
    {
      provide: MERCHANT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaMerchantRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    { provide: MERCHANT_RULES_REPOSITORY, useExisting: MERCHANT_REPOSITORY }
  ],
  exports: [MERCHANT_REPOSITORY, MERCHANT_RULES_REPOSITORY]
})
export class MerchantModule implements OnModuleInit {
  constructor() {}

  onModuleInit(): void {
    const config = createEvmPaymentsConfig();
    if (!config.enabled) {
      logger.warn(
        "EVM_PLATFORM_PRIVATE_KEY not set — crypto payments disabled. " +
        "Set the env var to enable the POST /merchants/me/crypto-payments/enable endpoint."
      );
    }
  }
}
