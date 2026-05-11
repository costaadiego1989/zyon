import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HttpModule } from "../../shared/http/http.module.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { SendSupportMessageUseCase } from "./application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "./application/get-support-settings.use-case.js";
import { UpdateSupportSettingsUseCase } from "./application/update-support-settings.use-case.js";
import { SUPPORT_SETTINGS_REPOSITORY } from "./domain/ports/support-settings-repository.port.js";
import { InMemorySupportSettingsRepository } from "./infrastructure/in-memory-support-settings.repository.js";
import { PrismaSupportSettingsRepository } from "./infrastructure/prisma-support-settings.repository.js";
import { SupportController } from "./presentation/http/support.controller.js";

@Module({
  imports: [AuthModule, HttpModule],
  controllers: [SupportController],
  providers: [
    SendSupportMessageUseCase,
    GetSupportSettingsUseCase,
    UpdateSupportSettingsUseCase,
    InMemorySupportSettingsRepository,
    {
      provide: SUPPORT_SETTINGS_REPOSITORY,
      useFactory: (inMemory: InMemorySupportSettingsRepository) => {
        if (
          process.env.SUPPORT_SETTINGS_REPOSITORY === "prisma" ||
          process.env.CHECKOUT_REPOSITORY === "prisma"
        ) {
          return new PrismaSupportSettingsRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemorySupportSettingsRepository],
    },
  ],
  exports: [GetSupportSettingsUseCase],
})
export class SupportModule {}
