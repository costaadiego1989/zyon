import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { CheckoutSettingsPatch } from "@aacp/shared-types";
import type { Response } from "express";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { EntityTagService } from "../../../../shared/http/entity-tag.service.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
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
    private readonly getContext: GetCheckoutSettingsContextUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  @Get()
  async get(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const settings = await this.getSettings.execute(
      currentUser(request as { user?: unknown }).merchantId,
    );
    this.entityTags.set(response, settings);
    return settings;
  }

  @Put()
  @Idempotent()
  async update(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: CheckoutSettingsPatch,
  ) {
    const merchantId = currentUser(
      request as { user?: unknown },
    ).merchantId;
    const current = await this.getSettings.execute(merchantId);
    this.entityTags.assertIfMatch(ifMatch, current);
    const updated = await this.updateSettings.execute(
      merchantId,
      body,
      current.updatedAt,
    );
    this.entityTags.set(response, updated);
    return updated;
  }

  @Post("reset")
  @Idempotent()
  async reset(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const merchantId = currentUser(
      request as { user?: unknown },
    ).merchantId;
    const current = await this.getSettings.execute(merchantId);
    this.entityTags.assertIfMatch(ifMatch, current);
    const reset = await this.resetSettings.execute(
      merchantId,
      current.updatedAt,
    );
    this.entityTags.set(response, reset);
    return reset;
  }

  @Get("context")
  context(@Req() request: unknown) {
    return this.getContext.execute(currentUser(request as { user?: unknown }).merchantId);
  }
}
