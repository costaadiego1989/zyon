import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import type { MerchantRules, MerchantTheme } from "@aacp/shared-types";
import { AuthGuard, currentUser } from "../../auth/presentation/auth.guard.js";
import {
  GetMerchantProfileUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../application/merchant.use-cases.js";
import { GetMerchantThemeUseCase } from "../application/get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "../application/update-merchant-theme.use-case.js";

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
  profile(@Req() request: unknown) {
    return this.getProfile.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Get("rules")
  rules(@Req() request: unknown) {
    return this.getRules.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Put("rules")
  update(@Req() request: unknown, @Body() body: Partial<MerchantRules>) {
    return this.updateRules.execute(currentUser(request as { user?: unknown }).merchantId, body);
  }

  @Get("theme")
  theme(@Req() request: unknown) {
    return this.getTheme.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Put("theme")
  putTheme(@Req() request: unknown, @Body() body: MerchantTheme) {
    return this.updateTheme.execute(currentUser(request as { user?: unknown }).merchantId, body);
  }
}
