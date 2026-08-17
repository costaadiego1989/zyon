import { Controller, ForbiddenException, Get, Put, Post, Param, Body, UseGuards, Req } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetStoreSettingsUseCase, type StoreSettings } from "../../application/use-cases/get-store-settings.use-case.js";
import { UpdateStoreSettingsUseCase } from "../../application/use-cases/update-store-settings.use-case.js";
import { GetSeoSettingsUseCase, type SeoGtmConfig } from "../../application/use-cases/get-seo-settings.use-case.js";
import { UpdateSeoSettingsUseCase, type UpdateSeoInput, type UpdateSeoOutput } from "../../application/use-cases/update-seo-settings.use-case.js";
import { GenerateSeoSuggestionsUseCase } from "../../application/use-cases/generate-seo-suggestions.use-case.js";
import type { GenerateSeoSuggestionsRequest, GenerateSeoSuggestionsResponse } from "@zyon/shared-types";

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
  async getStoreSettings(@Req() req: any, @Param("mid") merchantId: string): Promise<StoreSettings> {
    this.assertOwnership(req, merchantId);
    return this.getSettings.execute(merchantId);
  }

  @Put(":mid/store-settings")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateStoreSettings(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Body() settings: StoreSettings,
  ): Promise<StoreSettings> {
    this.assertOwnership(req, merchantId);
    return this.updateSettings.execute(merchantId, settings);
  }

  @Get("me/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getSeoMe(@Req() req: any): Promise<SeoGtmConfig> {
    const user = currentUser(req);
    return this.getSeoSettings.execute(user.merchantId);
  }

  @Put("me/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateSeoMe(
    @Req() req: any,
    @Body() body: UpdateSeoInput,
  ): Promise<UpdateSeoOutput> {
    const user = currentUser(req);
    return this.updateSeoSettings.execute(user.merchantId, body);
  }

  @Post("me/store-settings/seo/generate")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateSeoMe(
    @Req() req: any,
    @Body() body: GenerateSeoSuggestionsRequest,
  ): Promise<GenerateSeoSuggestionsResponse> {
    const user = currentUser(req);
    return this.generateSeoSuggestions.execute(user.merchantId, body);
  }

  @Get(":mid/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getSeo(@Req() req: any, @Param("mid") merchantId: string): Promise<SeoGtmConfig> {
    this.assertOwnership(req, merchantId);
    return this.getSeoSettings.execute(merchantId);
  }

  @Put(":mid/store-settings/seo")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateSeo(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Body() body: UpdateSeoInput,
  ): Promise<UpdateSeoOutput> {
    this.assertOwnership(req, merchantId);
    return this.updateSeoSettings.execute(merchantId, body);
  }

  @Post(":mid/store-settings/seo/generate")
  @RequirePlan("STORE_ONLY", "BOTH")
  async generateSeo(
    @Req() req: any,
    @Param("mid") merchantId: string,
    @Body() body: GenerateSeoSuggestionsRequest,
  ): Promise<GenerateSeoSuggestionsResponse> {
    this.assertOwnership(req, merchantId);
    return this.generateSeoSuggestions.execute(merchantId, body);
  }

  private assertOwnership(req: any, merchantId: string): void {
    const user = currentUser(req);
    if (user.merchantId !== merchantId) {
      throw new ForbiddenException("access_denied");
    }
  }
}
