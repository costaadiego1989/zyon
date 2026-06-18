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
  ApiCookieAuth,
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
