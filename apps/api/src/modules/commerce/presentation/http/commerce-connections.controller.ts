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
  ApiCookieAuth,
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
  @RequireTenantAccess({ serviceScopes: ["commerce:write"] })
  async sync(@Req() request: unknown) {
    return toResponse(
      await this.syncConnection.execute(tenantId(request)),
    );
  }

  @Delete()
  @Idempotent()
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
