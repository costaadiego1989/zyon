import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ListPlatformOperatorDirectoryUseCase } from "../application/list-platform-operator-directory.use-case.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";
import { platformPermissionsForRole, type PlatformOperatorRole } from "../../platform-control/domain/platform-operator.js";

@ApiTags("Platform Control Operators")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/operators")
export class PlatformOperatorDirectoryController {
  constructor(private readonly listOperators: ListPlatformOperatorDirectoryUseCase) {}

  @Get()
  @RequirePlatformPermissions("platform:operators:read")
  @ApiOperation({ summary: "List platform operators, roles, and derived permissions" })
  @ApiQuery({ name: "query", required: false, description: "Search by operator email" })
  @ApiQuery({ name: "role", required: false, description: "Filter by platform role" })
  @ApiQuery({ name: "status", required: false, enum: ["active", "disabled"] })
  @ApiQuery({ name: "cursor", required: false, description: "Pagination cursor bound to the active filters" })
  @ApiQuery({ name: "limit", required: false, description: "Page size, between 1 and 100" })
  async list(
    @Query() query: { query?: unknown; role?: unknown; status?: unknown; cursor?: unknown; limit?: unknown },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      const page = await this.listOperators.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
      return {
        generated_at: new Date().toISOString(),
        summary: page.summary,
        items: page.items.map(presentOperator),
        next_cursor: page.nextCursor ?? null,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && isInvalidQueryError(error.message)) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

}

function presentOperator(operator: {
  id: string;
  email: string;
  role: PlatformOperatorRole;
  disabledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    operator_id: operator.id,
    email: operator.email,
    role: operator.role,
    permissions: platformPermissionsForRole(operator.role),
    status: operator.disabledAt ? "disabled" : "active",
    disabled_at: operator.disabledAt?.toISOString() ?? null,
    created_at: operator.createdAt.toISOString(),
    updated_at: operator.updatedAt.toISOString(),
  };
}

function isInvalidQueryError(code: string): boolean {
  return code === "platform_operators_invalid_cursor"
    || code === "platform_operators_invalid_limit"
    || code === "platform_operators_invalid_query"
    || code === "platform_operators_invalid_role"
    || code === "platform_operators_invalid_status";
}
