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
