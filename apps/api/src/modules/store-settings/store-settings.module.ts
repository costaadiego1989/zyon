import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { GetStoreSettingsUseCase } from "./application/use-cases/get-store-settings.use-case.js";
import { UpdateStoreSettingsUseCase } from "./application/use-cases/update-store-settings.use-case.js";
import { StoreSettingsController } from "./presentation/http/store-settings.controller.js";

@Module({
  imports: [PersistenceModule],
  controllers: [StoreSettingsController],
  providers: [GetStoreSettingsUseCase, UpdateStoreSettingsUseCase],
  exports: [GetStoreSettingsUseCase, UpdateStoreSettingsUseCase],
})
export class StoreSettingsModule {}
