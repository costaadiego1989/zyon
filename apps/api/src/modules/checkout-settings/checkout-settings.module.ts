import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { TenantAccessModule } from "../integrations/tenant-access.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "./application/checkout-settings.use-cases.js";
import { CHECKOUT_SETTINGS_REPOSITORY } from "./domain/ports/checkout-settings-repository.port.js";
import { PrismaCheckoutSettingsRepository } from "./infrastructure/prisma-checkout-settings.repository.js";
import { CheckoutSettingsController, CheckoutSettingsPublicController } from "./presentation/http/checkout-settings.controller.js";

@Module({
  imports: [TenantAccessModule],
  controllers: [CheckoutSettingsPublicController, CheckoutSettingsController],
  providers: [
    GetCheckoutSettingsUseCase,
    UpdateCheckoutSettingsUseCase,
    ResetCheckoutSettingsUseCase,
    GetCheckoutSettingsContextUseCase,
    {
      provide: CHECKOUT_SETTINGS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCheckoutSettingsRepository(prisma),
      inject: [PRISMA_CLIENT]
    }
  ],
  exports: [GetCheckoutSettingsUseCase, UpdateCheckoutSettingsUseCase, GetCheckoutSettingsContextUseCase, CHECKOUT_SETTINGS_REPOSITORY]
})
export class CheckoutSettingsModule {}
