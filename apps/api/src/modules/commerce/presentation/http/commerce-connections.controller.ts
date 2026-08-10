import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PlanLimitGuard, RequirePlanLimit } from "../../../payment/domain/billing-plan-guard.js";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import {
  RequireTenantAccess,
} from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  ConnectCommerceUseCase,
  DisconnectCommerceUseCase,
  GetCommerceConnectionUseCase,
  SyncCommerceConnectionUseCase,
  TestCommerceConnectionUseCase,
} from "../../application/manage-commerce-connection.use-cases.js";
import type {
  MerchantCommerceConnection,
  SaveMerchantCommerceCredentialsInput,
} from "../../domain/ports/commerce-connection.port.js";
import { ConnectCommerceDto } from "./commerce-connection.dto.js";

@ApiTags("Commerce connections")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("commerce/connections")
export class CommerceConnectionsController {
  constructor(
    private readonly getConnection: GetCommerceConnectionUseCase,
    private readonly connectCommerce: ConnectCommerceUseCase,
    private readonly testConnection: TestCommerceConnectionUseCase,
    private readonly syncConnection: SyncCommerceConnectionUseCase,
    private readonly disconnectCommerce: DisconnectCommerceUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List commerce connections",
    description: "Retrieves the merchant's commerce platform connection status and credentials metadata. Returns connection details including provider, status, sync history, and any errors.",
  })
  @ApiResponse({
    status: 200,
    description: "Commerce connection retrieved successfully. Returns array with 0 or 1 connection.",
    schema: {
      properties: {
        data: {
          type: "array",
          items: { $ref: "#/components/schemas/CommerceConnection" },
        },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @RequireTenantAccess({ serviceScopes: ["commerce:read"] })
  async list(@Req() request: unknown) {
    const merchantId = tenantId(request);
    const connection = await this.getConnection.execute(merchantId);
    return {
      data: connection ? [toResponse(connection)] : [],
      next_cursor: null,
      has_more: false,
    };
  }

  @Post()
  @Idempotent()
  @UseGuards(PlanLimitGuard)
  @RequirePlanLimit("commerceConnections")
  @ApiOperation({
    summary: "Connect commerce platform",
    description: "Connects a new commerce platform (Shopify, WooCommerce, Nuvemshop, or Tray). Requires platform-specific credentials (API keys, tokens, etc.). Replaces any existing connection.",
  })
  @ApiBody({
    description: "Platform-specific connection credentials",
    schema: {
      oneOf: [
        {
          properties: {
            provider: { type: "string", enum: ["shopify"] },
            shop_domain: { type: "string" },
            admin_access_token: { type: "string" },
            storefront_access_token: { type: "string" },
            api_version: { type: "string" },
            webhook_secret: { type: "string" },
          },
        },
        {
          properties: {
            provider: { type: "string", enum: ["woocommerce"] },
            store_url: { type: "string" },
            consumer_key: { type: "string" },
            consumer_secret: { type: "string" },
            webhook_secret: { type: "string" },
          },
        },
        {
          properties: {
            provider: { type: "string", enum: ["nuvemshop"] },
            store_id: { type: "string" },
            access_token: { type: "string" },
            user_agent: { type: "string" },
          },
        },
        {
          properties: {
            provider: { type: "string", enum: ["tray"] },
            api_address: { type: "string" },
            tray_access_token: { type: "string" },
            tray_refresh_token: { type: "string" },
            tray_consumer_key: { type: "string" },
            tray_consumer_secret: { type: "string" },
            tray_access_token_expires_at: { type: "string" },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Connection established successfully",
    schema: { $ref: "#/components/schemas/CommerceConnection" },
  })
  @ApiResponse({ status: 400, description: "Invalid credentials or missing required fields for provider" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions or plan limit reached" })
  @RequireTenantAccess({ serviceScopes: ["commerce:write"] })
  async connect(
    @Req() request: unknown,
    @Body() body: ConnectCommerceDto,
  ) {
    const connection = await this.connectCommerce.execute(
      toCredentials(tenantId(request), body),
    );
    return toResponse(connection);
  }

  @Post("test")
  @Idempotent()
  @ApiOperation({
    summary: "Test commerce connection",
    description: "Validates the current commerce connection by testing credentials and retrieving store metadata (name, currency). Does not modify state.",
  })
  @ApiResponse({
    status: 200,
    description: "Connection test successful",
    schema: {
      properties: {
        connection: { $ref: "#/components/schemas/CommerceConnection" },
        store_name: { type: "string" },
        currency: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Connection test failed - invalid credentials or unreachable platform" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "No active connection to test" })
  @RequireTenantAccess({ serviceScopes: ["commerce:write"] })
  async test(@Req() request: unknown) {
    const result = await this.testConnection.execute(tenantId(request));
    return {
      connection: toResponse(result.connection),
      store_name: result.storeName,
      currency: result.currency,
    };
  }

  @Post("sync")
  @Idempotent()
  @ApiOperation({
    summary: "Synchronize commerce data",
    description: "Fetches orders, customers, and products from the connected commerce platform and syncs them into the system. Returns updated connection status.",
  })
  @ApiResponse({
    status: 200,
    description: "Sync completed successfully",
    schema: { $ref: "#/components/schemas/CommerceConnection" },
  })
  @ApiResponse({ status: 400, description: "Sync failed - invalid connection or platform error" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "No active connection to sync" })
  @RequireTenantAccess({ serviceScopes: ["commerce:write"] })
  async sync(@Req() request: unknown) {
    return toResponse(
      await this.syncConnection.execute(tenantId(request)),
    );
  }

  @Delete()
  @Idempotent()
  @ApiOperation({
    summary: "Disconnect commerce platform",
    description: "Removes stored commerce platform credentials and stops all data synchronization. Orders and customers remain in the system.",
  })
  @ApiResponse({
    status: 200,
    description: "Disconnected successfully",
    schema: { properties: { disconnected: { type: "boolean" } } },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @RequireTenantAccess({ serviceScopes: ["commerce:write"] })
  async disconnect(@Req() request: unknown) {
    await this.disconnectCommerce.execute(tenantId(request));
    return { disconnected: true };
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

function toCredentials(
  merchantId: string,
  body: ConnectCommerceDto,
): SaveMerchantCommerceCredentialsInput {
  if (body.provider === "shopify") {
    return {
      merchantId,
      provider: "shopify",
      shopDomain: body.shop_domain ?? "",
      adminAccessToken: body.admin_access_token ?? "",
      storefrontAccessToken: body.storefront_access_token ?? "",
      apiVersion: body.api_version,
      webhookSecret: body.webhook_secret,
    };
  }
  if (body.provider === "nuvemshop") {
    return {
      merchantId,
      provider: "nuvemshop",
      storeId: body.store_id ?? "",
      accessToken: body.access_token ?? "",
      userAgent: body.user_agent,
    };
  }
  if (body.provider === "tray") {
    return {
      merchantId,
      provider: "tray",
      apiAddress: body.api_address ?? "",
      accessToken: body.tray_access_token ?? "",
      refreshToken: body.tray_refresh_token ?? "",
      consumerKey: body.tray_consumer_key ?? "",
      consumerSecret: body.tray_consumer_secret ?? "",
      accessTokenExpiresAt: Number(body.tray_access_token_expires_at ?? 0),
    };
  }
  return {
    merchantId,
    provider: "woocommerce",
    storeUrl: body.store_url ?? "",
    consumerKey: body.consumer_key ?? "",
    consumerSecret: body.consumer_secret ?? "",
    webhookSecret: body.webhook_secret,
  };
}

function toResponse(connection: MerchantCommerceConnection) {
  return {
    provider: connection.provider,
    store_url: connection.storeUrl,
    status: connection.status,
    api_version: connection.apiVersion ?? null,
    last_tested_at: connection.lastTestedAt ?? null,
    last_synced_at: connection.lastSyncedAt ?? null,
    last_error_code: connection.lastErrorCode ?? null,
    created_at: connection.createdAt,
    updated_at: connection.updatedAt,
  };
}
