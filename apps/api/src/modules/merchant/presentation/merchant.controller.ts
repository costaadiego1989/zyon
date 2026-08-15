import { Body, Controller, Get, Put, UseGuards, ValidationPipe } from "@nestjs/common";
import type { MerchantTheme } from "@zyon/shared-types";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
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
@ApiTags("Merchant")
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

  @ApiOperation({
    summary: "Get merchant profile",
    description:
      "Retrieve current merchant profile data including ID, email, name, and subscription status.",
  })
  @ApiResponse({
    status: 200,
    description: "Merchant profile",
    schema: {
      example: {
        id: "merch_123",
        email: "owner@example.com",
        name: "Example Store",
        status: "active",
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated",
  })
  @Get()
  profile(@CurrentTenant() merchantId: string) {
    return this.getProfile.execute(merchantId);
  }

  @ApiOperation({
    summary: "Get merchant business rules",
    description:
      "Retrieve discount and margin rules. maxDiscountPercent: 0-100 (hard cap on discounts). minimumMarginPercent: 0-100 (margin floor for cost-based calculations). defaultCostPercent: 0-100 (fallback cost = price * percent if not provided).",
  })
  @ApiResponse({
    status: 200,
    description: "Business rules",
    schema: {
      example: {
        maxDiscountPercent: 50,
        minimumMarginPercent: 15,
        defaultCostPercent: 50,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated",
  })
  @Get("rules")
  rules(@CurrentTenant() merchantId: string) {
    return this.getRules.execute(merchantId);
  }

  @ApiOperation({
    summary: "Update merchant business rules",
    description:
      "Update discount and margin rules. All fields optional. maxDiscountPercent limits offer engine. minimumMarginPercent enforces profit floor. defaultCostPercent sets fallback cost.",
  })
  @ApiResponse({
    status: 200,
    description: "Rules updated",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid rule values (must be 0-100)",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated",
  })
  @Put("rules")
  update(
    @CurrentTenant() merchantId: string,
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    body: UpdateMerchantRulesDto
  ) {
    return this.updateRules.execute(merchantId, body);
  }

  @ApiOperation({
    summary: "Get merchant theme",
    description:
      "Retrieve storefront theme settings (colors, fonts, logo, accent). Used by widget to render branded checkout.",
  })
  @ApiResponse({
    status: 200,
    description: "Theme configuration",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated",
  })
  @Get("theme")
  theme(@CurrentTenant() merchantId: string) {
    return this.getTheme.execute(merchantId);
  }

  @ApiOperation({
    summary: "Update merchant theme",
    description:
      "Update storefront theme. Supports partial updates. Fields: primaryColor, accentColor, logoUrl, fontFamily, borderRadius, etc.",
  })
  @ApiResponse({
    status: 200,
    description: "Theme updated",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid theme values",
  })
  @ApiResponse({
    status: 401,
    description: "Not authenticated",
  })
  @Put("theme")
  putTheme(@CurrentTenant() merchantId: string, @Body() body: MerchantTheme) {
    return this.updateTheme.execute(merchantId, body);
  }

  @Put("store-category")
  async putStoreCategory(
    @CurrentTenant() merchantId: string,
    @Body() body: { storeCategory: string }
  ) {
    return this.updateTheme.executeCategory(merchantId, body.storeCategory);
  }

  @Get("store-settings")
  async getStoreSettings(@CurrentTenant() merchantId: string) {
    return this.updateTheme.getStoreSettings(merchantId);
  }

  @Put("store-settings")
  async putStoreSettings(
    @CurrentTenant() merchantId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.updateTheme.updateStoreSettings(merchantId, body);
  }
}
