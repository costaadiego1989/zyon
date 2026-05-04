import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { createPrismaClient } from "../checkout/infrastructure/prisma/prisma-client.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "./application/checkout-settings.use-cases.js";
import { CHECKOUT_SETTINGS_REPOSITORY } from "./domain/ports/checkout-settings-repository.port.js";
import { InMemoryCheckoutSettingsRepository } from "./infrastructure/in-memory-checkout-settings.repository.js";
import { PrismaCheckoutSettingsRepository } from "./infrastructure/prisma-checkout-settings.repository.js";
import { CheckoutSettingsController } from "./presentation/http/checkout-settings.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [CheckoutSettingsController],
  providers: [
    GetCheckoutSettingsUseCase,
    UpdateCheckoutSettingsUseCase,
    ResetCheckoutSettingsUseCase,
    GetCheckoutSettingsContextUseCase,
    InMemoryCheckoutSettingsRepository,
    {
      provide: CHECKOUT_SETTINGS_REPOSITORY,
      useFactory: (inMemory: InMemoryCheckoutSettingsRepository) => {
        if (process.env.CHECKOUT_SETTINGS_REPOSITORY === "prisma" || process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaCheckoutSettingsRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryCheckoutSettingsRepository]
    }
  ],
  exports: [GetCheckoutSettingsContextUseCase]
})
export class CheckoutSettingsModule {}
