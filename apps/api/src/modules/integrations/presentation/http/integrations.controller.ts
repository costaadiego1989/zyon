import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { RequireTenantRoles } from "../../../auth/presentation/tenant-role.decorator.js";
import { TenantRoleGuard } from "../../../auth/presentation/tenant-role.guard.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import {
  CreateMerchantApiKeyUseCase,
  ListMerchantApiKeysUseCase,
  ListTenantShipmentsUseCase,
  ListWebhookDeliveriesUseCase,
  ListWebhookEndpointsUseCase,
  ReplayWebhookDeliveryUseCase,
  RevokeMerchantApiKeyUseCase,
  RotateMerchantApiKeyUseCase,
  TestWebhookEndpointUseCase,
  UpsertWebhookEndpointUseCase
} from "../../application/integrations.use-cases.js";
import type { TenantWebhookEventType } from "../../domain/integrations.types.js";
import {
  CreateMerchantApiKeyDto,
  RotateMerchantApiKeyDto,
} from "./api-key.dto.js";

@ApiTags("Developer operations")
@ApiCookieAuth("console_session")
@RequireTenantRoles("owner", "admin")
@UseGuards(AuthGuard, TenantRoleGuard)
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly createApiKey: CreateMerchantApiKeyUseCase,
    private readonly listApiKeys: ListMerchantApiKeysUseCase,
    private readonly revokeApiKey: RevokeMerchantApiKeyUseCase,
    private readonly rotateApiKey: RotateMerchantApiKeyUseCase,
    private readonly listWebhookEndpoints: ListWebhookEndpointsUseCase,
    private readonly upsertWebhookEndpoint: UpsertWebhookEndpointUseCase,
    private readonly listWebhookDeliveries: ListWebhookDeliveriesUseCase,
    private readonly replayWebhookDelivery: ReplayWebhookDeliveryUseCase,
    private readonly testWebhookEndpoint: TestWebhookEndpointUseCase,
    private readonly listShipments: ListTenantShipmentsUseCase
  ) {}

  @Get("api-keys")
  apiKeys(@Req() request: unknown) {
    return this.listApiKeys.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Post("api-keys")
  @Idempotent()
  createKey(@Req() request: unknown, @Body() body: CreateMerchantApiKeyDto) {
    return this.createApiKey.execute({
      merchantId: currentUser(request as { user?: unknown }).merchantId,
      name: body.name,
      scopes: body.scopes,
      environment: body.environment,
      expiresAt: body.expires_at,
      allowedCidrs: body.allowed_cidrs,
    });
  }

  @Delete("api-keys/:apiKeyId")
  @Idempotent()
  revokeKey(@Req() request: unknown, @Param("apiKeyId") apiKeyId: string) {
    return this.revokeApiKey.execute(currentUser(request as { user?: unknown }).merchantId, apiKeyId);
  }

  @Post("api-keys/:apiKeyId/rotate")
  @Idempotent()
  rotateKey(
    @Req() request: unknown,
    @Param("apiKeyId") apiKeyId: string,
    @Body() body: RotateMerchantApiKeyDto,
  ) {
    return this.rotateApiKey.execute({
      merchantId: currentUser(request as { user?: unknown }).merchantId,
      apiKeyId,
      overlapSeconds: body.overlap_seconds,
    });
  }

  @Get("webhooks")
  webhooks(@Req() request: unknown) {
    return this.listWebhookEndpoints.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Post("webhooks")
  @Idempotent()
  createWebhook(@Req() request: unknown, @Body() body: { url: string; events?: TenantWebhookEventType[]; enabled?: boolean; description?: string }) {
    return this.upsertWebhookEndpoint.execute({
      merchantId: currentUser(request as { user?: unknown }).merchantId,
      url: body.url,
      events: body.events,
      enabled: body.enabled,
      description: body.description
    });
  }

  @Put("webhooks/:endpointId")
  @Idempotent()
  updateWebhook(
    @Req() request: unknown,
    @Param("endpointId") endpointId: string,
    @Body() body: { url: string; events?: TenantWebhookEventType[]; enabled?: boolean; description?: string }
  ) {
    return this.upsertWebhookEndpoint.execute({
      merchantId: currentUser(request as { user?: unknown }).merchantId,
      endpointId,
      url: body.url,
      events: body.events,
      enabled: body.enabled,
      description: body.description
    });
  }

  @Post("webhooks/:endpointId/test")
  @Idempotent()
  testWebhook(@Req() request: unknown, @Param("endpointId") endpointId: string) {
    return this.testWebhookEndpoint.execute(currentUser(request as { user?: unknown }).merchantId, endpointId);
  }

  @Get("webhook-deliveries")
  deliveries(@Req() request: unknown, @Query("limit") limit?: string) {
    return this.listWebhookDeliveries.execute(currentUser(request as { user?: unknown }).merchantId, numberOrUndefined(limit));
  }

  @Post("webhook-deliveries/:deliveryId/replay")
  @Idempotent()
  replayDelivery(@Req() request: unknown, @Param("deliveryId") deliveryId: string) {
    return this.replayWebhookDelivery.execute(currentUser(request as { user?: unknown }).merchantId, deliveryId);
  }

  @Get("shipments")
  shipments(@Req() request: unknown, @Query("limit") limit?: string) {
    return this.listShipments.execute(currentUser(request as { user?: unknown }).merchantId, numberOrUndefined(limit));
  }
}

function numberOrUndefined(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : undefined;
}
