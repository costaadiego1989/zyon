import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  ApiOkResponse,
  ApiCreatedResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { currentTenantPrincipal } from "../../../../../shared/auth/tenant-principal.js";
import { EntityTagService } from "../../../../../shared/http/entity-tag.service.js";
import { Idempotent } from "../../../../../shared/http/idempotency/idempotent.decorator.js";
import { ResponseEnvelopeInterceptor } from "../../../../../shared/http/response-envelope.interceptor.js";
import {
  GetWebhookEndpointUseCase,
  DeleteWebhookEndpointUseCase,
  ListWebhookEndpointsUseCase,
  TestWebhookEndpointUseCase,
  UpsertWebhookEndpointUseCase,
  ListWebhookDeliveriesUseCase,
} from "../../../../integrations/application/integrations.use-cases.js";
import { RequireTenantAccess } from "../../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../../integrations/presentation/http/tenant-credential.guard.js";
import { WebhookEntityMapper } from "../../application/mappers/webhook-entity.mapper.js";
import { CreateWebhookDto, UpdateWebhookDto, TestWebhookDto, WebhookResponse, WebhookDeliveryResponse } from "./dtos/webhook.dtos.js";

/**
 * Public API v1 — Webhooks
 *
 * RESTful resource controller for webhook endpoint management.
 * Delegates to existing IntegrationsModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags("Webhooks")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@Controller("webhooks")
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class WebhooksV1Controller {
  constructor(
    private readonly listEndpoints: ListWebhookEndpointsUseCase,
    private readonly getEndpoint: GetWebhookEndpointUseCase,
    private readonly deleteEndpoint: DeleteWebhookEndpointUseCase,
    private readonly upsertEndpoint: UpsertWebhookEndpointUseCase,
    private readonly testEndpoint: TestWebhookEndpointUseCase,
    private readonly listDeliveries: ListWebhookDeliveriesUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  /**
   * GET /v1/webhooks
   * List all webhook endpoints for the merchant.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ["webhooks:read"] })
  @ApiOperation({ summary: "List webhook endpoints" })
  @ApiQuery({ name: "limit", type: "number", required: false, example: 20 })
  @ApiQuery({ name: "cursor", type: "string", required: false })
  @ApiOkResponse({ description: "Webhook endpoints list", type: [WebhookResponse] })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async list(
    @Req() request: any,
    @Query("limit") limit?: number,
    @Query("cursor") cursor?: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const endpoints = await this.listEndpoints.execute(merchantId);

    return {
      data: WebhookEntityMapper.toListResponse(endpoints),
      pagination: {
        next_cursor: null,
        has_more: false,
      },
    };
  }

  /**
   * GET /v1/webhooks/:id
   * Get a single webhook endpoint.
   */
  @Get(":id")
  @RequireTenantAccess({ serviceScopes: ["webhooks:read"] })
  @ApiOperation({ summary: "Get webhook endpoint" })
  @ApiParam({ name: "id", type: "string", description: "Webhook endpoint ID" })
  @ApiOkResponse({ description: "Webhook endpoint details", type: WebhookResponse })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Webhook not found" })
  async get(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const endpoint = await this.getEndpoint.execute(merchantId, id);
    this.entityTags.set(response, endpoint);
    return WebhookEntityMapper.toResponse(endpoint);
  }

  /**
   * POST /v1/webhooks
   * Create a new webhook endpoint.
   */
  @Post()
  @Idempotent({ redactResponseFields: ["secret_key"] })
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  @ApiOperation({ summary: "Create webhook endpoint" })
  @ApiBody({ type: CreateWebhookDto })
  @ApiCreatedResponse({ description: "Webhook endpoint created", type: WebhookResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async create(
    @Req() request: any,
    @Body() body: CreateWebhookDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const endpoint = await this.upsertEndpoint.execute({
      merchantId,
      url: body.url,
      events: body.events,
      enabled: body.active,
      description: body.description,
    });
    return WebhookEntityMapper.toResponse(endpoint);
  }

  /**
   * PUT /v1/webhooks/:id
   * Update an existing webhook endpoint.
   */
  @Put(":id")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  @ApiOperation({ summary: "Update webhook endpoint" })
  @ApiParam({ name: "id", type: "string", description: "Webhook endpoint ID" })
  @ApiHeader({ name: "If-Match", required: false, description: "ETag for optimistic concurrency control" })
  @ApiBody({ type: UpdateWebhookDto })
  @ApiOkResponse({ description: "Webhook endpoint updated", type: WebhookResponse })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Webhook not found" })
  @ApiResponse({ status: 412, description: "Precondition failed — ETag mismatch" })
  async update(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: UpdateWebhookDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const current = await this.getEndpoint.execute(merchantId, id);
    this.entityTags.assertIfMatch(ifMatch, current);

    const endpoint = await this.upsertEndpoint.execute({
      merchantId,
      endpointId: id,
      url: body.url,
      events: body.events,
      enabled: body.active,
      description: body.description,
    });
    this.entityTags.set(response, endpoint);
    return WebhookEntityMapper.toResponse(endpoint);
  }

  /**
   * DELETE /v1/webhooks/:id
   * Delete a webhook endpoint.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  @ApiOperation({ summary: "Delete webhook endpoint" })
  @ApiParam({ name: "id", type: "string", description: "Webhook endpoint ID" })
  @ApiResponse({ status: 204, description: "Webhook endpoint deleted" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Webhook not found" })
  async delete(
    @Req() request: any,
    @Param("id") id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    await this.deleteEndpoint.execute(merchantId, id);
  }

  /**
   * POST /v1/webhooks/:id/test
   * Send a test webhook to verify the endpoint.
   */
  @Post(":id/test")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["webhooks:write"] })
  @ApiOperation({ summary: "Send test webhook" })
  @ApiParam({ name: "id", type: "string", description: "Webhook endpoint ID" })
  @ApiBody({ type: TestWebhookDto })
  @ApiOkResponse({ description: "Test webhook sent", type: WebhookDeliveryResponse })
  @ApiResponse({ status: 400, description: "Test failed" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Webhook not found" })
  async test(
    @Req() request: any,
    @Param("id") id: string,
    @Body() body?: TestWebhookDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const delivery = await this.testEndpoint.execute(merchantId, id);
    return WebhookEntityMapper.toDeliveryResponse(delivery);
  }
}
