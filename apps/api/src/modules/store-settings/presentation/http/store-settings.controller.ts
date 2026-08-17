import { Controller, Get, Put, Post, Param, Body, UseGuards, Req } from "@nestjs/common";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetStoreSettingsUseCase, type StoreSettings } from "../../application/use-cases/get-store-settings.use-case.js";
import { UpdateStoreSettingsUseCase } from "../../application/use-cases/update-store-settings.use-case.js";
import { GetSeoSettingsUseCase, type SeoGtmConfig } from "../../application/use-cases/get-seo-settings.use-case.js";
import { UpdateSeoSettingsUseCase, type UpdateSeoInput, type UpdateSeoOutput } from "../../application/use-cases/update-seo-settings.use-case.js";
import { GenerateSeoSuggestionsUseCase } from "../../application/use-cases/generate-seo-suggestions.use-case.js";
import type { GenerateSeoSuggestionsRequest, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

interface AuthenticatedRequest {
  merchantId: string;
}

@UseGuards(AuthGuard, RequirePlanGuard)
@Controller("merchants")
export class StoreSettingsController {
  constructor(
    private readonly getSettings: GetStoreSettingsUseCase,
    private readonly updateSettings: UpdateStoreSettingsUseCase,
    private readonly getSeoSettings: GetSeoSettingsUseCase,
    private readonly updateSeoSettings: UpdateSeoSettingsUseCase,
    private readonly generateSeoSuggestions: GenerateSeoSuggestionsUseCase,
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

  @Get("me/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getSeoMe(@Req() req: AuthenticatedRequest): Promise<SeoGtmConfig> {
    return this.getSeoSettings.execute(req.merchantId);
  }

  @Put("me/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateSeoMe(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateSeoInput,
  ): Promise<UpdateSeoOutput> {
    return this.updateSeoSettings.execute(req.merchantId, body);
  }

  @Post("me/store-settings/seo/generate")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateSeoMe(
    @Req() req: AuthenticatedRequest,
    @Body() body: GenerateSeoSuggestionsRequest,
  ): Promise<GenerateSeoSuggestionsResponse> {
    return this.generateSeoSuggestions.execute(req.merchantId, body);
  }

  @Get(":mid/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getSeo(@Param("mid") merchantId: string): Promise<SeoGtmConfig> {
    return this.getSeoSettings.execute(merchantId);
  }

  @Put(":mid/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateSeo(
    @Param("mid") merchantId: string,
    @Body() body: UpdateSeoInput,
  ): Promise<UpdateSeoOutput> {
    return this.updateSeoSettings.execute(merchantId, body);
  }

  @Post(":mid/store-settings/seo/generate")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateSeo(
    @Param("mid") merchantId: string,
    @Body() body: GenerateSeoSuggestionsRequest,
  ): Promise<GenerateSeoSuggestionsResponse> {
    return this.generateSeoSuggestions.execute(merchantId, body);
  }
}
