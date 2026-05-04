import { Body, Controller, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { CheckoutSettingsPatch } from "@aacp/shared-types";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "../../application/checkout-settings.use-cases.js";

@UseGuards(AuthGuard)
@Controller("checkout-settings")
export class CheckoutSettingsController {
  constructor(
    private readonly getSettings: GetCheckoutSettingsUseCase,
    private readonly updateSettings: UpdateCheckoutSettingsUseCase,
    private readonly resetSettings: ResetCheckoutSettingsUseCase,
    private readonly getContext: GetCheckoutSettingsContextUseCase
  ) {}

  @Get()
  get(@Req() request: unknown) {
    return this.getSettings.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Put()
  update(@Req() request: unknown, @Body() body: CheckoutSettingsPatch) {
    return this.updateSettings.execute(currentUser(request as { user?: unknown }).merchantId, body);
  }

  @Post("reset")
  reset(@Req() request: unknown) {
    return this.resetSettings.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Get("context")
  context(@Req() request: unknown) {
    return this.getContext.execute(currentUser(request as { user?: unknown }).merchantId);
  }
}
