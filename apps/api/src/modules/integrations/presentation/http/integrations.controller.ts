import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
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
  @ApiOperation({
    summary: "List API keys",
    description: "Retrieves all API keys for the merchant including environment, scopes, expiry date, and CIDR restrictions.",
  })
  @ApiResponse({
    status: 200,
    description: "API keys retrieved successfully",
    schema: { type: "array" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  apiKeys(@Req() request: unknown) {
    return this.listApiKeys.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Post("api-keys")
  @Idempotent({ redactResponseFields: ["secret_key"] })
  @ApiOperation({
    summary: "Create API key",
    description: "Creates a new API key with specified scopes, environment (test/live), and optional expiry/CIDR restrictions. Returns secret_key once only.",
  })
  @ApiBody({
    schema: {
      properties: {
        name: { type: "string" },
        scopes: { type: "array", items: { type: "string" } },
        environment: { type: "string", enum: ["test", "live"] },
        expires_at: { type: "string", format: "date-time" },
        allowed_cidrs: { type: "array", items: { type: "string" } },
      },
      required: ["name", "scopes", "environment"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "API key created successfully",
    schema: {
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        secret_key: { type: "string", description: "Secret key shown only once" },
        prefix: { type: "string" },
        environment: { type: "string" },
        scopes: { type: "array" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid scopes or environment" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
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
  @ApiOperation({
    summary: "Revoke API key",
    description: "Immediately revokes and deactivates an API key. All requests using this key will be rejected.",
  })
  @ApiParam({ name: "apiKeyId", type: "string", description: "API Key ID to revoke" })
  @ApiResponse({
    status: 200,
    description: "API key revoked successfully",
    schema: { properties: { revoked: { type: "boolean" } } },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "API key not found" })
  revokeKey(@Req() request: unknown, @Param("apiKeyId") apiKeyId: string) {
    return this.revokeApiKey.execute(currentUser(request as { user?: unknown }).merchantId, apiKeyId);
  }

  @Post("api-keys/:apiKeyId/rotate")
  @Idempotent({ redactResponseFields: ["secret_key"] })
  @ApiOperation({
    summary: "Rotate API key",
    description: "Generates a new secret for an API key with optional overlap period. Old secret remains valid during overlap for zero-downtime transitions.",
  })
  @ApiParam({ name: "apiKeyId", type: "string", description: "API Key ID to rotate" })
  @ApiBody({
    schema: {
      properties: {
        overlap_seconds: { type: "number", description: "Seconds to keep old secret valid (default: 60)" },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "API key rotated successfully",
    schema: {
      properties: {
        id: { type: "string" },
        secret_key: { type: "string", description: "New secret key" },
        prefix: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "API key not found" })
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
  @ApiOperation({
    summary: "List webhook endpoints",
    description: "Lists all webhook endpoints (legacy endpoint - see /webhook-endpoints for new API).",
  })
  @ApiResponse({
    status: 200,
    description: "Webhook endpoints retrieved successfully",
    schema: { type: "array" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  webhooks(@Req() request: unknown) {
    return this.listWebhookEndpoints.execute(currentUser(request as { user?: unknown }).merchantId);
  }

  @Post("webhooks")
  @Idempotent({ redactResponseFields: ["signingSecret"] })
  @ApiOperation({
    summary: "Create webhook endpoint",
    description: "Creates a new webhook endpoint with event subscriptions and generates a signing secret for HMAC verification.",
  })
  @ApiBody({
    schema: {
      properties: {
        url: { type: "string", format: "uri" },
        events: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
        description: { type: "string" },
      },
      required: ["url"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Webhook endpoint created successfully",
    schema: { $ref: "#/components/schemas/WebhookEndpoint" },
  })
  @ApiResponse({ status: 400, description: "Invalid URL or events" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
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
  @ApiOperation({
    summary: "Update webhook endpoint",
    description: "Updates webhook URL, events, enabled status, or description for an existing endpoint.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiBody({
    schema: {
      properties: {
        url: { type: "string", format: "uri" },
        events: { type: "array", items: { type: "string" } },
        enabled: { type: "boolean" },
        description: { type: "string" },
      },
      required: ["url"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Webhook endpoint updated successfully",
    schema: { $ref: "#/components/schemas/WebhookEndpoint" },
  })
  @ApiResponse({ status: 400, description: "Invalid URL or events" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
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
  @ApiOperation({
    summary: "Test webhook endpoint",
    description: "Sends a test webhook delivery to verify endpoint is accessible and signature validation works.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiResponse({
    status: 200,
    description: "Test delivery sent successfully",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 400, description: "Test delivery failed - endpoint unreachable" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  testWebhook(@Req() request: unknown, @Param("endpointId") endpointId: string) {
    return this.testWebhookEndpoint.execute(currentUser(request as { user?: unknown }).merchantId, endpointId);
  }

  @Get("webhook-deliveries")
  @ApiOperation({
    summary: "List webhook deliveries",
    description: "Lists webhook delivery attempts with status, retry counts, and response information.",
  })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Max items to return (max: 100)" })
  @ApiResponse({
    status: 200,
    description: "Webhook deliveries retrieved successfully",
    schema: { type: "array" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  deliveries(@Req() request: unknown, @Query("limit") limit?: string) {
    return this.listWebhookDeliveries.execute(currentUser(request as { user?: unknown }).merchantId, numberOrUndefined(limit));
  }

  @Post("webhook-deliveries/:deliveryId/replay")
  @Idempotent()
  @ApiOperation({
    summary: "Replay webhook delivery",
    description: "Retries a failed webhook delivery, resending the event to the endpoint.",
  })
  @ApiParam({ name: "deliveryId", type: "string", description: "Webhook delivery ID" })
  @ApiResponse({
    status: 200,
    description: "Delivery replayed successfully",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Delivery not found" })
  replayDelivery(@Req() request: unknown, @Param("deliveryId") deliveryId: string) {
    return this.replayWebhookDelivery.execute(currentUser(request as { user?: unknown }).merchantId, deliveryId);
  }

  @Get("shipments")
  @ApiOperation({
    summary: "List shipments",
    description: "Lists all merchant shipments with tracking and delivery information.",
  })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Max items to return (max: 100)" })
  @ApiResponse({
    status: 200,
    description: "Shipments retrieved successfully",
    schema: { type: "array" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  shipments(@Req() request: unknown, @Query("limit") limit?: string) {
    return this.listShipments.execute(currentUser(request as { user?: unknown }).merchantId, numberOrUndefined(limit));
  }
}

function numberOrUndefined(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : undefined;
}
