import {
  Body,
  Controller,
  Get,
  Headers,
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
  RequireTenantAccess,
} from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";
import {
  CreateInstallationUseCase,
  GetInstallationUseCase,
  ListInstallationsUseCase,
  ReportInstallationHealthUseCase,
  UpdateInstallationUseCase,
} from "../../application/installation.use-cases.js";
import {
  CreateInstallationDto,
  ReportInstallationHealthDto,
  UpdateInstallationDto,
} from "./installation.dto.js";

@ApiTags("Installations")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller("installations")
export class InstallationsController {
  constructor(
    private readonly listInstallations: ListInstallationsUseCase,
    private readonly getInstallation: GetInstallationUseCase,
    private readonly createInstallation: CreateInstallationUseCase,
    private readonly updateInstallation: UpdateInstallationUseCase,
    private readonly reportHealth: ReportInstallationHealthUseCase,
    private readonly entityTags: EntityTagService,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  @ApiOperation({
    summary: "List installations",
    description: "Return a paginated list of widget installations for the authenticated merchant. Supports cursor-based pagination with configurable page size (max 200).",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, description: "Page size (1-200, default varies)" })
  @ApiQuery({ name: "cursor", required: false, type: String, description: "Opaque cursor from previous page's next_cursor" })
  @ApiResponse({
    status: 200,
    description: "Paginated list of installations",
    schema: {
      type: "object",
      properties: {
        data: { type: "array", items: { type: "object" } },
        next_cursor: { type: "string", nullable: true },
        has_more: { type: "boolean" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:read scope." })
  async list(
    @Req() request: unknown,
    @Query("limit") limitStr?: string,
    @Query("cursor") cursor?: string,
  ) {
    const limit = parsePageSize(limitStr);
    const result = await this.listInstallations.execute(tenantId(request), limit, cursor);
    return {
      data: result.data.map(toResponse),
      next_cursor: result.nextCursor,
      has_more: result.hasMore,
    };
  }

  @Post()
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  @ApiOperation({
    summary: "Create a new installation",
    description: "Register a new widget installation for the authenticated merchant. Each installation represents a deployment target (e.g. a storefront domain). Returns the created resource with an ETag header for optimistic concurrency.",
  })
  @ApiResponse({
    status: 201,
    description: "Installation created. ETag header set for conditional updates.",
  })
  @ApiResponse({ status: 400, description: "Validation error: invalid name, environment, origins, or widget version." })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:write scope." })
  @ApiResponse({ status: 409, description: "Conflict. Idempotency key collision with different payload." })
  async create(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Body() body: CreateInstallationDto,
  ) {
    const installation = await this.createInstallation.execute({
      merchantId: tenantId(request),
      name: body.name,
      environment: body.environment,
      widgetVersion: body.widget_version,
      allowedOrigins: body.allowed_origins,
    });
    this.entityTags.set(response, installation);
    return toResponse(installation);
  }

  @Get(":installationId")
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  @ApiOperation({
    summary: "Get installation by ID",
    description: "Retrieve a single installation by its ID within the authenticated merchant's tenant. Returns an ETag header for optimistic concurrency on subsequent updates.",
  })
  @ApiParam({ name: "installationId", type: String, description: "Installation unique identifier" })
  @ApiResponse({ status: 200, description: "Installation details. ETag header included." })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:read scope." })
  @ApiResponse({ status: 404, description: "Installation not found within this tenant." })
  async get(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Param("installationId") installationId: string,
  ) {
    const installation = await this.getInstallation.execute(
      tenantId(request),
      installationId,
    );
    this.entityTags.set(response, installation);
    return toResponse(installation);
  }

  @Put(":installationId")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  @ApiOperation({
    summary: "Update an installation",
    description: "Partially update an installation's name, status, widget version, or allowed origins. Supports optimistic concurrency via If-Match header (ETag). Omitted fields are not changed.",
  })
  @ApiParam({ name: "installationId", type: String, description: "Installation unique identifier" })
  @ApiResponse({ status: 200, description: "Installation updated. New ETag header set." })
  @ApiResponse({ status: 400, description: "Validation error: invalid field values." })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:write scope." })
  @ApiResponse({ status: 404, description: "Installation not found within this tenant." })
  @ApiResponse({ status: 409, description: "Conflict. If-Match ETag does not match current version (concurrent modification)." })
  @ApiResponse({ status: 412, description: "Precondition failed. If-Match header required but missing or mismatched." })
  async update(
    @Req() request: unknown,
    @Res({ passthrough: true }) response: Response,
    @Param("installationId") installationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: UpdateInstallationDto,
  ) {
    const current = await this.getInstallation.execute(
      tenantId(request),
      installationId,
    );
    this.entityTags.assertIfMatch(ifMatch, current);
    const updated = await this.updateInstallation.execute({
      merchantId: current.merchantId,
      installationId: current.id,
      expectedUpdatedAt: current.updatedAt,
      name: body.name,
      status: body.status,
      widgetVersion: body.widget_version,
      allowedOrigins: body.allowed_origins,
    });
    this.entityTags.set(response, updated);
    return toResponse(updated);
  }

  @Get(":installationId/health")
  @RequireTenantAccess({ serviceScopes: ["configuration:read"] })
  @ApiOperation({
    summary: "Get installation health status",
    description: "Retrieve the health status and diagnostics for an installation. Returns last health report timestamp, last seen time, widget version, and any error codes reported by the widget runtime.",
  })
  @ApiParam({ name: "installationId", type: String, description: "Installation unique identifier" })
  @ApiResponse({
    status: 200,
    description: "Installation health status",
    schema: {
      type: "object",
      properties: {
        installation_id: { type: "string" },
        status: { type: "string", enum: ["active", "disabled", "degraded"] },
        widget_version: { type: "string" },
        last_health_at: { type: "string", format: "date-time", nullable: true },
        last_seen_at: { type: "string", format: "date-time", nullable: true },
        last_error_code: { type: "string", nullable: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:read scope." })
  @ApiResponse({ status: 404, description: "Installation not found within this tenant." })
  async health(
    @Req() request: unknown,
    @Param("installationId") installationId: string,
  ) {
    const installation = await this.getInstallation.execute(
      tenantId(request),
      installationId,
    );
    return {
      installation_id: installation.id,
      status: installation.status,
      widget_version: installation.widgetVersion,
      last_health_at: installation.lastHealthAt ?? null,
      last_seen_at: installation.lastSeenAt ?? null,
      last_error_code: installation.lastErrorCode ?? null,
    };
  }

  @Post(":installationId/health")
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ["configuration:write"] })
  @ApiOperation({
    summary: "Report installation health",
    description: "Submit a health check report from a running widget instance. The widget runtime calls this endpoint periodically to report its operational status, origin, and any error codes. Updates the installation's last_health_at, last_seen_at, and status fields.",
  })
  @ApiParam({ name: "installationId", type: String, description: "Installation unique identifier" })
  @ApiResponse({ status: 201, description: "Health report recorded. Updated installation returned." })
  @ApiResponse({ status: 400, description: "Validation error: invalid body payload." })
  @ApiResponse({ status: 401, description: "Unauthorized. Invalid or missing credentials." })
  @ApiResponse({ status: 403, description: "Forbidden. Credential lacks configuration:write scope." })
  @ApiResponse({ status: 404, description: "Installation not found within this tenant." })
  async updateHealth(
    @Req() request: unknown,
    @Param("installationId") installationId: string,
    @Body() body: ReportInstallationHealthDto,
  ) {
    return toResponse(
      await this.reportHealth.execute({
        merchantId: tenantId(request),
        installationId,
        origin: body.origin,
        widgetVersion: body.widget_version,
        healthy: body.healthy,
        errorCode: body.error_code,
      }),
    );
  }
}

function tenantId(request: unknown): string {
  return currentTenantPrincipal(
    request as Parameters<typeof currentTenantPrincipal>[0],
  ).tenantId;
}

function parsePageSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 200) : undefined;
}

function toResponse(installation: {
  id: string;
  name: string;
  environment: string;
  status: string;
  widgetVersion: string;
  allowedOrigins: string[];
  lastHealthAt?: string;
  lastSeenAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: installation.id,
    name: installation.name,
    environment: installation.environment,
    status: installation.status,
    widget_version: installation.widgetVersion,
    allowed_origins: installation.allowedOrigins,
    last_health_at: installation.lastHealthAt ?? null,
    last_seen_at: installation.lastSeenAt ?? null,
    last_error_code: installation.lastErrorCode ?? null,
    created_at: installation.createdAt,
    updated_at: installation.updatedAt,
  };
}
