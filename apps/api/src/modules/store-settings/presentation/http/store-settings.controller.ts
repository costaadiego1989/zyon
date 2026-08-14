import { Controller, Get, Put, Param, Body, UseGuards } from "@nestjs/common";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetStoreSettingsUseCase } from "../../application/use-cases/get-store-settings.use-case.js";
import { UpdateStoreSettingsUseCase, type StoreSettings } from "../../application/use-cases/update-store-settings.use-case.js";

@UseGuards(RequirePlanGuard)
@Controller("merchants")
export class StoreSettingsController {
  constructor(
    private readonly getSettings: GetStoreSettingsUseCase,
    private readonly updateSettings: UpdateStoreSettingsUseCase,
  ) {}

  @Get(":mid/store-settings")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getStoreSettings(@Param("mid") merchantId: string): Promise<StoreSettings> {
    return this.getSettings.execute(merchantId);
  }

  @Put(":mid/store-settings")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateStoreSettings(
    @Param("mid") merchantId: string,
    @Body() settings: StoreSettings,
  ): Promise<StoreSettings> {
    return this.updateSettings.execute(merchantId, settings);
  }
}
