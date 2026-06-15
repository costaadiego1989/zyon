import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiTags,
} from "@nestjs/swagger";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import { ListAuditEventsUseCase } from "../../application/audit.use-cases.js";
import { RequireTenantAccess } from "../../../integrations/presentation/http/tenant-access.decorator.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import { TenantCredentialGuard } from "../../../integrations/presentation/http/tenant-credential.guard.js";

@ApiTags("Audit")
@ApiBearerAuth("service_api_key")
@ApiCookieAuth("console_session")
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@RequireTenantAccess({ serviceScopes: ["audit:read"] })
@Controller("audit-events")
export class AuditEventsController {
  constructor(private readonly listAuditEvents: ListAuditEventsUseCase) {}

  @Get()
  async list(
    @Req() request: unknown,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const page = await this.listAuditEvents.execute({
      merchantId: currentTenantPrincipal(
        request as Parameters<typeof currentTenantPrincipal>[0],
      ).tenantId,
      limit: parseLimit(limit),
      cursor,
    });
    return {
      data: page.data.map((event) => ({
        id: event.id,
        actor_type: event.actorType,
        actor_id: event.actorId,
        action: event.action,
        resource_type: event.resourceType,
        resource_id: event.resourceId ?? null,
        correlation_id: event.correlationId ?? null,
        metadata: event.metadata,
        occurred_at: event.occurredAt,
      })),
      next_cursor: page.nextCursor,
      has_more: page.nextCursor !== null,
    };
  }
}

function parseLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
