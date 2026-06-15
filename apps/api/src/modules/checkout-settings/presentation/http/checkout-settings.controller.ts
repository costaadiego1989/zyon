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
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiTags,
} from "@nestjs/swagger";
import type { CheckoutSettingsPatch } from "@aacp/shared-types";
import type { Response } from "express";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { EntityTagService } from "../../../../shared/http/entity-tag.service.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  GetCheckoutSettingsContextUseCase,
  GetCheckoutSettingsUseCase,
  ResetCheckoutSettingsUseCase,
  UpdateCheckoutSettingsUseCase
} from "../../application/checkout-settings.use-cases.js";

@ApiTags("Checkout configuration")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
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
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  async get(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const settings = await this.getSettings.execute(
      tenantId(request),
    );
    this.entityTags.set(response, settings);
    return settings;
  }

  @Put()
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  async update(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: CheckoutSettingsPatch,
  ) {
    const merchantId = tenantId(request);
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
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  async reset(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const merchantId = tenantId(request);
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
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  context(@Req() request: unknown) {
    return this.getContext.execute(tenantId(request));
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}
