import { Body, Controller, Get, Put, UseGuards, ValidationPipe } from "@nestjs/common";
import type { MerchantTheme } from "@zyon/shared-types";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { CurrentTenant } from "../../../shared/tenant/current-tenant.decorator.js";
import {
  GetMerchantProfileUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../application/merchant.use-cases.js";
import { GetMerchantThemeUseCase } from "../application/get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "../application/update-merchant-theme.use-case.js";
import { UpdateMerchantRulesDto } from "./dto/update-merchant-rules.dto.js";

/**
 * MERC-H2: Uses @CurrentTenant() decorator instead of unsafe request casting.
 * MERC-H5: Crypto payments route merged into this controller.
 */
@UseGuards(AuthGuard)
@Controller("merchants/me")
export class MerchantController {
  constructor(
    private readonly getProfile: GetMerchantProfileUseCase,
    private readonly getRules: GetMerchantRulesUseCase,
    private readonly updateRules: UpdateMerchantRulesUseCase,
    private readonly getTheme: GetMerchantThemeUseCase,
    private readonly updateTheme: UpdateMerchantThemeUseCase
  ) {}

  @Get()
  profile(@CurrentTenant() merchantId: string) {
    return this.getProfile.execute(merchantId);
  }

  @Get("rules")
  rules(@CurrentTenant() merchantId: string) {
    return this.getRules.execute(merchantId);
  }

  @Put("rules")
  update(
    @CurrentTenant() merchantId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: UpdateMerchantRulesDto
  ) {
    return this.updateRules.execute(merchantId, body);
  }

  @Get("theme")
  theme(@CurrentTenant() merchantId: string) {
    return this.getTheme.execute(merchantId);
  }

  @Put("theme")
  putTheme(@CurrentTenant() merchantId: string, @Body() body: MerchantTheme) {
    return this.updateTheme.execute(merchantId, body);
  }
}
