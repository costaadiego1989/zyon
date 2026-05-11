import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { SupportSettingsPatch } from "@aacp/shared-types";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import {
  SendSupportMessageUseCase,
  type SupportMessageInput,
} from "../../application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "../../application/get-support-settings.use-case.js";
import { UpdateSupportSettingsUseCase } from "../../application/update-support-settings.use-case.js";

@Controller("support")
export class SupportController {
  constructor(
    private readonly sendSupportMessage: SendSupportMessageUseCase,
    private readonly getSettings: GetSupportSettingsUseCase,
    private readonly updateSettings: UpdateSupportSettingsUseCase,
  ) {}

  @Post("chat")
  async chat(@Body() body: SupportMessageInput) {
    const settings = await this.getSettings.execute(body.merchant_id);
    return this.sendSupportMessage.execute(body, {
      faqItems: settings.faqItems,
    });
  }

  @Get("faq")
  async getFaq(@Query("merchant_id") merchantId: string) {
    const settings = await this.getSettings.execute(merchantId);
    return { faqItems: settings.faqItems };
  }

  @UseGuards(AuthGuard)
  @Get("settings")
  getSettings_(@Req() request: unknown) {
    return this.getSettings.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @UseGuards(AuthGuard)
  @Put("settings")
  updateSettings_(@Req() request: unknown, @Body() body: SupportSettingsPatch) {
    return this.updateSettings.execute(
      currentUser(request as { user?: unknown }).merchantId,
      body,
    );
  }
}
