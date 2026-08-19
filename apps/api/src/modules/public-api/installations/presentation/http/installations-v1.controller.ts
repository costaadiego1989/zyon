import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { currentTenantPrincipal } from "../../../../../shared/auth/tenant-principal.js";
import { EntityTagService } from "../../../../../shared/http/entity-tag.service.js";
import { Idempotent } from "../../../../../shared/http/idempotency/idempotent.decorator.js";
import { ResponseEnvelopeInterceptor } from "../../../../../shared/http/response-envelope.interceptor.js";
import {
  CreateInstallationUseCase,
  GetInstallationUseCase,
  ListInstallationsUseCase,
  UpdateInstallationUseCase,
  ResolveInstallationForEmbedUseCase,
} from "../../../../installations/application/installation.use-cases.js";
import { RequireTenantAccess } from "../../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../../integrations/presentation/http/tenant-credential.guard.js";
import { InstallationEntityMapper } from "../../application/mappers/installation-entity.mapper.js";
import {
  CreateInstallationDto,
  UpdateInstallationDto,
} from "./dtos/installation.dtos.js";

/**
 * Public API v1 — Installations
 *
 * RESTful resource controller for widget installation management.
 * Delegates to existing InstallationsModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags("Installations")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@Controller("installations")
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class InstallationsV1Controller {
  constructor(
    private readonly listInstallations: ListInstallationsUseCase,
    private readonly getInstallation: GetInstallationUseCase,
    private readonly createInstallation: CreateInstallationUseCase,
    private readonly updateInstallation: UpdateInstallationUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  /**
   * GET /v1/installations
   * List all installations for the merchant.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ["installations:read"] })
  @ApiOperation({ summary: "List installations" })
  @ApiQuery({
    name: "limit",
    type: "number",
    required: false,
    example: 20,
  })
  @ApiQuery({ name: "cursor", type: "string", required: false })
  @ApiResponse({ status: 200, description: "Installations list" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async list(
    @Req() request: any,
    @Query("limit") limit?: number,
    @Query("cursor") cursor?: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const result = await this.listInstallations.execute(
      merchantId,
      limit,
      cursor,
    );
    return InstallationEntityMapper.toListResponse(
      result.data,
      result.nextCursor,
      result.hasMore,
    );
  }

  /**
   * GET /v1/installations/:id
   * Get a single installation.
   */
  @Get(":id")
  @RequireTenantAccess({ serviceScopes: ["installations:read"] })
  @ApiOperation({ summary: "Get installation" })
  @ApiParam({
    name: "id",
    type: "string",
    description: "Installation ID",
  })
  @ApiResponse({ status: 200, description: "Installation details" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Installation not found" })
  async get(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const installation = await this.getInstallation.execute(merchantId, id);
    if (!installation) {
      throw new NotFoundException("installation_not_found");
    }
    this.entityTags.set(response, installation);
    return InstallationEntityMapper.toResponse(installation);
  }

  /**
   * POST /v1/installations
   * Create a new installation.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ["installations:write"] })
  @ApiOperation({ summary: "Create installation" })
  @ApiResponse({ status: 201, description: "Installation created" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  async create(
    @Req() request: any,
    @Body() body: CreateInstallationDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const installation = await this.createInstallation.execute({
      merchantId,
      name: body.name,
      environment: (body.environment as "test" | "live") || "live",
      widgetVersion: body.widget_version || "1.0.0",
      allowedOrigins: body.allowed_origins,
    });
    return InstallationEntityMapper.toResponse(installation);
  }

  /**
   * PATCH /v1/installations/:id
   * Update an installation.
   */
  @Patch(":id")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["installations:write"] })
  @ApiOperation({ summary: "Update installation" })
  @ApiParam({
    name: "id",
    type: "string",
    description: "Installation ID",
  })
  @ApiHeader({
    name: "If-Match",
    required: false,
    description: "ETag for optimistic concurrency control",
  })
  @ApiResponse({ status: 200, description: "Installation updated" })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Installation not found" })
  @ApiResponse({ status: 412, description: "Precondition failed — ETag mismatch" })
  async update(
    @Req() request: any,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: UpdateInstallationDto,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const current = await this.getInstallation.execute(merchantId, id);
    if (!current) {
      throw new NotFoundException("installation_not_found");
    }

    const installation = await this.updateInstallation.execute({
      merchantId,
      installationId: id,
      expectedUpdatedAt: current.updatedAt,
      name: body.name,
      status: body.status as any,
      widgetVersion: body.widget_version,
      allowedOrigins: body.allowed_origins,
    });

    this.entityTags.set(response, installation);
    return InstallationEntityMapper.toResponse(installation);
  }

  /**
   * DELETE /v1/installations/:id
   * Delete an installation.
   */
  @Delete(":id")
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantAccess({ serviceScopes: ["installations:write"] })
  @ApiOperation({ summary: "Delete installation" })
  @ApiParam({
    name: "id",
    type: "string",
    description: "Installation ID",
  })
  @ApiResponse({ status: 204, description: "Installation deleted" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  @ApiResponse({ status: 404, description: "Installation not found" })
  async delete(
    @Req() request: any,
    @Param("id") id: string,
  ) {
    const merchantId = currentTenantPrincipal(request).tenantId;
    const current = await this.getInstallation.execute(merchantId, id);
    if (!current) {
      throw new NotFoundException("installation_not_found");
    }

    await this.updateInstallation.execute({
      merchantId,
      installationId: id,
      expectedUpdatedAt: current.updatedAt,
      status: "disabled",
    });
  }
}
