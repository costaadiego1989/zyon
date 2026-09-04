import {
  BadRequestException,
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
import { InvalidCursorError } from "../../domain/errors/invalid-cursor.error.js";
import { toAuditEventResponse } from "./audit-events.mapper.js";

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
    @Query("action") action?: string,
    @Query("resource_type") resourceType?: string,
    @Query("actor_id") actorId?: string,
    @Query("since") since?: string,
    @Query("until") until?: string,
  ) {
    try {
      const page = await this.listAuditEvents.execute({
        merchantId: currentTenantPrincipal(
          request as Parameters<typeof currentTenantPrincipal>[0],
        ).tenantId,
        limit: parseLimit(limit),
        cursor,
        action,
        resourceType,
        actorId,
        since,
        until,
      });
      return {
        data: page.data.map(toAuditEventResponse),
        next_cursor: page.nextCursor,
        has_more: page.nextCursor !== null,
      };
    } catch (error) {
      // AUD-M4: Map domain error to HTTP 400.
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

function parseLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
