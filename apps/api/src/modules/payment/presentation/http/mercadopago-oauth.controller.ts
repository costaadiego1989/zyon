import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  currentTenantPrincipal,
  type TenantPrincipal,
} from "../../../../shared/auth/tenant-principal.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_CONFIG_PORT,
  type BillingConfigPort,
} from "../../domain/ports/payment-platform-provider.port.js";
import {
  CreateMercadoPagoOAuthLinkUseCase,
  HandleMercadoPagoOAuthCallbackUseCase,
  SyncMercadoPagoConnectionUseCase,
  RefreshMercadoPagoTokenUseCase,
  DeleteMercadoPagoConnectionUseCase,
} from "../../application/mercadopago-platform.use-cases.js";
import type { PaymentConnectionSnapshot } from "../../domain/payment-platform.types.js";
import { toConnectionResponse } from "./payment-platform.controller.js";

@ApiTags("Mercado Pago OAuth")
@Controller("payment/mercadopago")
export class MercadoPagoOAuthController {
  private readonly logger = new Logger(MercadoPagoOAuthController.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  @ApiOperation({
    summary: "Mercado Pago OAuth callback",
    description:
      "Public endpoint that Mercado Pago redirects to after authorization. Exchanges auth code for access token and stores credentials.",
  })
  @ApiResponse({
    status: 302,
    description: "Redirect to dashboard payment connections page",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid callback parameters",
  })
  @Get("callback")
  @Redirect()
  async handleOAuthCallback(
    @Query("code") code?: string,
    @Query("state") state?: string,
  ) {
    if (!code || !state) {
      throw new BadRequestException(
        "mercadopago_oauth_missing_code_or_state",
      );
    }

    const handleCallback = new HandleMercadoPagoOAuthCallbackUseCase(
      this.repository,
    );

    try {
      const result = await handleCallback.execute({ code, state });
      this.logger.log(
        `OAuth callback succeeded for merchant=${result.merchantId}`,
      );

      // Redirect to dashboard payment connections page
      return {
        url: `${this.getConsoleUrl()}/settings/payments/mercadopago/success`,
        statusCode: 302,
      };
    } catch (error) {
      this.logger.error(`OAuth callback failed: ${String(error)}`);
      return {
        url: `${this.getConsoleUrl()}/settings/payments/mercadopago/error`,
        statusCode: 302,
      };
    }
  }

  private getConsoleUrl(): string {
    const raw = process.env.DASHBOARD_URL?.trim();
    if (raw) return raw.replace(/\/+$/, "");
    return "https://dashboard.athom.com";
  }
}

@ApiTags("Payment connections")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({
  humanOnly: true,
  humanRoles: ["owner", "admin"],
})
@Controller("merchants/me/payment-connections/mercadopago")
export class MerchantMercadoPagoController {
  private readonly logger = new Logger(MerchantMercadoPagoController.name);

  constructor(
    private readonly createLink: CreateMercadoPagoOAuthLinkUseCase,
    private readonly sync: SyncMercadoPagoConnectionUseCase,
    private readonly refresh: RefreshMercadoPagoTokenUseCase,
    private readonly remove: DeleteMercadoPagoConnectionUseCase,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  @ApiOperation({
    summary: "Create Mercado Pago OAuth link",
    description:
      "Generate OAuth authorization link for Mercado Pago. User is redirected to MP login.",
  })
  @ApiResponse({
    status: 200,
    description: "OAuth link generated",
    schema: {
      example: {
        url: "https://auth.mercadopago.com/authorization?...",
      },
    },
  })
  @Post("oauth-link")
  async generateOAuthLink(@Req() request: unknown) {
    const principal = humanPrincipal(request);
    return this.createLink.execute(principal.tenantId);
  }

  @ApiOperation({
    summary: "Sync Mercado Pago connection status",
    description: "Poll Mercado Pago API for latest account status and details.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection status synced",
  })
  @Post("sync")
  async syncConnection(@Req() request: unknown) {
    return toConnectionResponse(
      await this.sync.execute(humanPrincipal(request).tenantId),
    );
  }

  @ApiOperation({
    summary: "Refresh Mercado Pago access token",
    description:
      "Refresh the access token using the stored refresh_token. Called when token expires.",
  })
  @ApiResponse({
    status: 200,
    description: "Token refreshed",
  })
  @Post("refresh-token")
  async refreshAccessToken(@Req() request: unknown) {
    return toConnectionResponse(
      await this.refresh.execute(humanPrincipal(request).tenantId),
    );
  }

  @ApiOperation({
    summary: "Disconnect Mercado Pago",
    description: "Remove Mercado Pago connection.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection removed",
  })
  @Delete()
  async disconnect(@Req() request: unknown) {
    return this.remove.execute(humanPrincipal(request).tenantId);
  }
}

function humanPrincipal(
  request: unknown,
): Extract<TenantPrincipal, { kind: "human" }> {
  const principal = currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  );
  if (principal.kind !== "human") {
    throw new Error("human_principal_expected");
  }
  return principal;
}
