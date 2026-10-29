import { BadRequestException, Controller, Get, HttpException, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { ListPlatformMerchantDirectoryUseCase } from "../application/list-platform-merchant-directory.use-case.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";

@ApiTags("Platform Control Merchants")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/merchants")
export class PlatformMerchantDirectoryController {
  constructor(private readonly listMerchants: ListPlatformMerchantDirectoryUseCase) {}

  @Get()
  @RequirePlatformPermissions("platform:merchants:read")
  @ApiOperation({ summary: "List the global merchant directory for platform operators" })
  @ApiQuery({ name: "query", required: false, description: "Search by merchant name, id, or store slug" })
  @ApiQuery({ name: "cursor", required: false, description: "Pagination cursor" })
  @ApiQuery({ name: "limit", required: false, description: "Page size, between 1 and 100" })
  async list(
    @Query() query: { query?: string; cursor?: string; limit?: string },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      const page = await this.listMerchants.execute(query, {
        actorOperatorId: principal.operatorId,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
      return {
        items: page.items.map(merchant => ({
          id: merchant.id,
          name: merchant.name,
          ...(merchant.storeSlug ? { store_slug: merchant.storeSlug } : {}),
          ...(merchant.storeCategory ? { store_category: merchant.storeCategory } : {}),
          plan: merchant.plan,
          member_count: merchant.memberCount,
          created_at: merchant.createdAt.toISOString(),
          updated_at: merchant.updatedAt.toISOString(),
        })),
        ...(page.nextCursor ? { next_cursor: page.nextCursor } : {}),
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

function isInvalidQueryError(code: string): boolean {
  return code === "platform_merchants_invalid_cursor"
    || code === "platform_merchants_invalid_limit"
    || code === "platform_merchants_invalid_query";
}
