import { Controller, ForbiddenException, Get, Put, Post, Param, Body, UseGuards, Req, Inject } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequirePlan } from "../../../../shared/guards/require-plan.decorator.js";
import { RequirePlanGuard } from "../../../../shared/guards/require-plan.guard.js";
import { GetStoreSettingsUseCase, type StoreSettings } from "../../application/use-cases/get-store-settings.use-case.js";
import { UpdateStoreSettingsUseCase } from "../../application/use-cases/update-store-settings.use-case.js";
import { GetSeoSettingsUseCase, type SeoGtmConfig } from "../../application/use-cases/get-seo-settings.use-case.js";
import { UpdateSeoSettingsUseCase, type UpdateSeoInput, type UpdateSeoOutput } from "../../application/use-cases/update-seo-settings.use-case.js";
import { GenerateSeoSuggestionsUseCase } from "../../application/use-cases/generate-seo-suggestions.use-case.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import type { GenerateSeoSuggestionsRequest, GenerateSeoSuggestionsResponse, CrossSellConfig } from "@zyon/shared-types";
import { DEFAULT_CROSS_SELL_CONFIG } from "@zyon/shared-types";

@UseGuards(AuthGuard, RequirePlanGuard)
@Controller("merchants")
export class StoreSettingsController {
  constructor(
    private readonly getSettings: GetStoreSettingsUseCase,
    private readonly updateSettings: UpdateStoreSettingsUseCase,
    private readonly getSeoSettings: GetSeoSettingsUseCase,
    private readonly updateSeoSettings: UpdateSeoSettingsUseCase,
    private readonly generateSeoSuggestions: GenerateSeoSuggestionsUseCase,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
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

  @Get("me/cross-sell-config")
  @RequirePlan("STORE_ONLY", "BOTH")
  async getCrossSellConfig(@Req() req: any): Promise<CrossSellConfig> {
    const user = currentUser(req);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: user.merchantId }, select: { storeSettings: true } });
    const settings = (merchant?.storeSettings as Record<string, any>) ?? {};
    return { ...DEFAULT_CROSS_SELL_CONFIG, ...settings.crossSell };
  }

  @Put("me/cross-sell-config")
  @RequirePlan("STORE_ONLY", "BOTH")
  async updateCrossSellConfig(@Req() req: any, @Body() body: Partial<CrossSellConfig>): Promise<CrossSellConfig> {
    const user = currentUser(req);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: user.merchantId }, select: { storeSettings: true } });
    const settings = (merchant?.storeSettings as Record<string, any>) ?? {};
    const current = { ...DEFAULT_CROSS_SELL_CONFIG, ...settings.crossSell };
    const updated: CrossSellConfig = {
      ...current,
      ...body,
      touchpoints: { ...current.touchpoints, ...body.touchpoints },
      limits: { ...current.limits, ...body.limits },
      discount: { ...current.discount, ...body.discount },
      display: { ...current.display, ...body.display },
    };
    await this.prisma.merchant.update({
      where: { id: user.merchantId },
      data: { storeSettings: { ...settings, crossSell: updated } as any },
    });
    return updated;
  }

  private assertOwnership(req: any, merchantId: string): void {
    const user = currentUser(req);
    if (user.merchantId !== merchantId) {
      throw new ForbiddenException("access_denied");
    }
  }
}
