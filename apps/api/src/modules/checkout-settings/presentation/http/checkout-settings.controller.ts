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
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { CheckoutSettingsPatch } from "@zyon/shared-types";
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
import { CheckoutSettingsPatchDto } from "./checkout-settings.dto.js";

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

  @ApiOperation({
    summary: "Get checkout settings",
    description:
      "Retrieve current checkout settings for the merchant. Returns an ETag header for optimistic concurrency on subsequent PUT. Settings include checkout mode (silent_until_trigger, proactive, manual_only), suppression rules, and trigger configuration.",
  })
  @ApiResponse({
    status: 200,
    description: "Checkout settings retrieved with ETag header",
  })
  @ApiResponse({
    status: 403,
    description: "Missing configuration:read scope",
  })
  @Get()
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  async get(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const settings = await this.getSettings.execute(
      tenantId(request),
    );
    // CSS-C2: Set ETag header on GET so clients can use it for conditional PUT
    this.entityTags.set(response, settings);
    return settings;
  }

  @ApiOperation({
    summary: "Update checkout settings",
    description:
      "Partial update of checkout settings. Supports optimistic concurrency via If-Match header (ETag from GET). Configurable fields: mode (silent_until_trigger | proactive | manual_only), suppression rules, trigger events, and widget behavior. Validates whitelist — unknown fields are rejected.",
  })
  @ApiResponse({
    status: 200,
    description: "Settings updated; new ETag in response header",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid or unknown settings fields",
  })
  @ApiResponse({
    status: 403,
    description: "Missing configuration:write scope",
  })
  @ApiResponse({
    status: 412,
    description: "ETag mismatch — concurrent modification detected",
  })
  @Put()
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  async update(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })) body: CheckoutSettingsPatchDto,
  ) {
    const merchantId = tenantId(request);
    const current = await this.getSettings.execute(merchantId);
    this.entityTags.assertIfMatch(ifMatch, current);
    const updated = await this.updateSettings.execute(
      merchantId,
      body as unknown as CheckoutSettingsPatch,
      current.updatedAt,
    );
    this.entityTags.set(response, updated);
    return updated;
  }

  @ApiOperation({
    summary: "Reset checkout settings to defaults",
    description:
      "Clear all custom checkout settings and restore factory defaults. Supports optimistic concurrency via If-Match header. Requires idempotency key.",
  })
  @ApiResponse({
    status: 200,
    description: "Settings reset to defaults; new ETag in response header",
  })
  @ApiResponse({
    status: 403,
    description: "Missing configuration:write scope",
  })
  @ApiResponse({
    status: 412,
    description: "ETag mismatch — concurrent modification detected",
  })
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

  @ApiOperation({
    summary: "Get checkout context",
    description:
      "Retrieve read-only context information used by checkout (features, constraints, limits). Used by SDK to determine capabilities.",
  })
  @ApiResponse({
    status: 200,
    description: "Checkout context data",
  })
  @ApiResponse({
    status: 403,
    description: "Missing configuration:read scope",
  })
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
