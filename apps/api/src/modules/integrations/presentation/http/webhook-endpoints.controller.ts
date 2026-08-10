import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { EntityTagService } from "../../../../shared/http/entity-tag.service.js";
import { Idempotent } from "../../../../shared/http/idempotency/idempotent.decorator.js";
import {
  GetWebhookDeliveryUseCase,
  GetWebhookEndpointUseCase,
  ListWebhookDeliveriesUseCase,
  ListWebhookEndpointsUseCase,
  ReplayWebhookDeliveryUseCase,
  RotateWebhookSigningSecretUseCase,
  TestWebhookEndpointUseCase,
  UpsertWebhookEndpointUseCase,
} from "../../application/integrations.use-cases.js";
import { RequireTenantAccess } from "./tenant-access.decorator.js";
import { TenantAccessGuard } from "./tenant-access.guard.js";
import { TenantCredentialGuard } from "./tenant-credential.guard.js";
import { UpsertWebhookEndpointDto } from "./webhook-endpoint.dto.js";
import { PlanLimitGuard, RequirePlanLimit } from "../../../payment/domain/billing-plan-guard.js";

@ApiTags("Webhooks")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("webhook-endpoints")
export class WebhookEndpointsController {
  constructor(
    private readonly listEndpoints: ListWebhookEndpointsUseCase,
    private readonly getEndpoint: GetWebhookEndpointUseCase,
    private readonly upsertEndpoint: UpsertWebhookEndpointUseCase,
    private readonly rotateSecret: RotateWebhookSigningSecretUseCase,
    private readonly testEndpoint: TestWebhookEndpointUseCase,
    private readonly listDeliveries: ListWebhookDeliveriesUseCase,
    private readonly getDelivery: GetWebhookDeliveryUseCase,
    private readonly replayDelivery: ReplayWebhookDeliveryUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "List webhook endpoints",
    description: "Retrieves all webhook endpoints for the merchant.",
  })
  @ApiResponse({
    status: 200,
    description: "Webhook endpoints retrieved successfully",
    schema: {
      properties: {
        data: { type: "array" },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:read"] })
  async list(@Req() request: unknown) {
    return {
      data: (
        await this.listEndpoints.execute(tenantId(request))
      ).map(toEndpointResponse),
      next_cursor: null,
      has_more: false,
    };
  }

  @Post()
  @Idempotent({ redactResponseFields: ["signing_secret"] })
  @UseGuards(PlanLimitGuard)
  @RequirePlanLimit("webhookEndpoints")
  @ApiOperation({
    summary: "Create webhook endpoint",
    description: "Creates a new webhook endpoint with event subscriptions. Returns a signing_secret for HMAC signature verification of incoming webhooks.",
  })
  @ApiBody({
    schema: {
      properties: {
        url: { type: "string", format: "uri", description: "HTTPS endpoint URL to receive webhooks" },
        events: { type: "array", items: { type: "string" }, description: "Event types to subscribe to" },
        description: { type: "string" },
        enabled: { type: "boolean", default: true },
      },
      required: ["url"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Webhook endpoint created successfully",
    schema: { $ref: "#/components/schemas/WebhookEndpoint" },
  })
  @ApiResponse({ status: 400, description: "Invalid URL or configuration" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions or plan limit reached" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  async create(
    @Req() request: unknown,
    @Body() body: UpsertWebhookEndpointDto,
  ) {
    return toEndpointResponse(await this.upsertEndpoint.execute({
      merchantId: tenantId(request),
      ...body,
    }));
  }

  @Get(":endpointId")
  @ApiOperation({
    summary: "Get webhook endpoint",
    description: "Retrieves webhook endpoint configuration and signing_secret hint (full secret not shown).",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiResponse({
    status: 200,
    description: "Webhook endpoint retrieved successfully",
    schema: { $ref: "#/components/schemas/WebhookEndpoint" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:read"] })
  async get(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Param("endpointId") endpointId: string,
  ) {
    const endpoint = await this.getEndpoint.execute(
      tenantId(request),
      endpointId,
    );
    this.entityTags.set(response, endpoint);
    return toEndpointResponse(endpoint);
  }

  @Put(":endpointId")
  @Idempotent()
  @ApiOperation({
    summary: "Update webhook endpoint",
    description: "Updates webhook endpoint configuration. Supports ETag-based optimistic concurrency control via If-Match header.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiHeader({ name: "If-Match", required: false, description: "ETag for optimistic concurrency control" })
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
  @ApiResponse({ status: 400, description: "Invalid configuration" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  @ApiResponse({ status: 412, description: "Precondition failed - ETag mismatch" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  async update(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Param("endpointId") endpointId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: UpsertWebhookEndpointDto,
  ) {
    const merchantId = tenantId(request);
    const current = await this.getEndpoint.execute(merchantId, endpointId);
    this.entityTags.assertIfMatch(ifMatch, current);
    const endpoint = await this.upsertEndpoint.execute({
      merchantId,
      endpointId,
      ...body,
    });
    this.entityTags.set(response, endpoint);
    return toEndpointResponse(endpoint);
  }

  @Post(":endpointId/rotate-secret")
  @Idempotent({ redactResponseFields: ["signing_secret"] })
  @ApiOperation({
    summary: "Rotate webhook signing secret",
    description: "Generates a new signing_secret for this endpoint. Old secret remains valid temporarily to allow graceful migration.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiResponse({
    status: 200,
    description: "Secret rotated successfully",
    schema: { $ref: "#/components/schemas/WebhookEndpoint" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  async rotate(
    @Req() request: unknown,
    @Param("endpointId") endpointId: string,
  ) {
    return toEndpointResponse(
      await this.rotateSecret.execute(tenantId(request), endpointId),
    );
  }

  @Post(":endpointId/test")
  @Idempotent()
  @ApiOperation({
    summary: "Send test webhook",
    description: "Sends a test webhook delivery to this endpoint to verify it can receive and process webhooks with proper signature validation.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiResponse({
    status: 200,
    description: "Test webhook sent successfully",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 400, description: "Test failed - endpoint unreachable or invalid" })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  async test(
    @Req() request: unknown,
    @Param("endpointId") endpointId: string,
  ) {
    return toDeliveryResponse(
      await this.testEndpoint.execute(tenantId(request), endpointId),
    );
  }

  @Get(":endpointId/deliveries")
  @ApiOperation({
    summary: "List endpoint deliveries",
    description: "Lists all webhook delivery attempts for a specific endpoint, including status, response codes, and retry scheduling.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiQuery({ name: "limit", type: "string", required: false, description: "Max items to return (1-100)" })
  @ApiResponse({
    status: 200,
    description: "Deliveries retrieved successfully",
    schema: {
      properties: {
        data: { type: "array" },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint not found" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:read"] })
  async deliveries(
    @Req() request: unknown,
    @Param("endpointId") endpointId: string,
    @Query("limit") limit?: string,
  ) {
    await this.getEndpoint.execute(tenantId(request), endpointId);
    const data = (
      await this.listDeliveries.execute(
        tenantId(request),
        parseLimit(limit),
      )
    ).filter((delivery) => delivery.endpointId === endpointId);
    return {
      data: data.map(toDeliveryResponse),
      next_cursor: null,
      has_more: false,
    };
  }

  @Post(":endpointId/deliveries/:deliveryId/replay")
  @Idempotent()
  @ApiOperation({
    summary: "Replay webhook delivery",
    description: "Retries a specific webhook delivery for this endpoint. Useful for recovering from transient failures.",
  })
  @ApiParam({ name: "endpointId", type: "string", description: "Webhook endpoint ID" })
  @ApiParam({ name: "deliveryId", type: "string", description: "Delivery ID to replay" })
  @ApiResponse({
    status: 200,
    description: "Delivery replayed successfully",
    schema: { type: "object" },
  })
  @ApiResponse({ status: 401, description: "Unauthorized - invalid or missing credentials" })
  @ApiResponse({ status: 403, description: "Forbidden - insufficient permissions" })
  @ApiResponse({ status: 404, description: "Webhook endpoint or delivery not found" })
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  async replay(
    @Req() request: unknown,
    @Param("endpointId") endpointId: string,
    @Param("deliveryId") deliveryId: string,
  ) {
    const merchantId = tenantId(request);
    const delivery = await this.getDelivery.execute(merchantId, deliveryId);
    if (delivery.endpointId !== endpointId) {
      throw new NotFoundException("webhook_delivery_not_found");
    }
    return toDeliveryResponse(
      await this.replayDelivery.execute(merchantId, deliveryId),
    );
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

function parseLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(1, Math.min(parsed, 100))
    : undefined;
}

function toEndpointResponse(endpoint: {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
  signingSecretHint: string;
}) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled: endpoint.enabled,
    events: endpoint.events,
    description: endpoint.description ?? null,
    signing_secret: endpoint.signingSecret,
    signing_secret_hint: endpoint.signingSecretHint,
    created_at: endpoint.createdAt,
    updated_at: endpoint.updatedAt,
  };
}

function toDeliveryResponse(delivery: {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt?: string;
  responseStatus?: number;
  responseBody?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}) {
  return {
    id: delivery.id,
    endpoint_id: delivery.endpointId,
    endpoint_url: delivery.endpointUrl,
    event_id: delivery.eventId,
    event_type: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    next_attempt_at: delivery.nextAttemptAt ?? null,
    response_status: delivery.responseStatus ?? null,
    response_body: delivery.responseBody ?? null,
    error: delivery.error ?? null,
    created_at: delivery.createdAt,
    updated_at: delivery.updatedAt,
    delivered_at: delivery.deliveredAt ?? null,
  };
}
