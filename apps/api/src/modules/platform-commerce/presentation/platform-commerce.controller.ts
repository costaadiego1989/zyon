import { BadRequestException, Controller, Get, HttpException, NotFoundException, Param, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ReadPlatformCommerceUseCases } from "../application/read-platform-commerce.use-cases.js";
import { PlatformAccessGuard } from "../../platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../../platform-control/presentation/platform-permission.guard.js";
import { RequirePlatformPermissions } from "../../platform-control/presentation/platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../../platform-control/presentation/platform-principal.js";

@ApiTags("Platform Control Commerce")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform")
export class PlatformCommerceController {
  constructor(private readonly commerce: ReadPlatformCommerceUseCases) {}

  @Get("orders")
  @RequirePlatformPermissions("platform:orders:read")
  @ApiOperation({ summary: "List platform orders without buyer personal data" })
  async orders(@Query() query: { from?: string; to?: string; status?: string; merchant_id?: string; query?: string; cursor?: string; limit?: string }, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.execute(() => this.commerce.listOrders(query, this.audit(request)));
  }

  @Get("orders/:id")
  @RequirePlatformPermissions("platform:orders:read")
  @ApiOperation({ summary: "Read protected order detail with buyer and shipping data" })
  async order(@Param("id") id: string, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.execute(async () => {
      const result = await this.commerce.orderDetail(id, this.audit(request));
      if (!result) throw new NotFoundException("platform_order_not_found");
      return result;
    });
  }

  @Get("merchants/:id/detail")
  @RequirePlatformPermissions("platform:merchants:read")
  @ApiOperation({ summary: "Read sales, billing and AI detail for one merchant" })
  async merchant(@Param("id") id: string, @Query() query: { from?: string; to?: string }, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.execute(async () => {
      const result = await this.commerce.merchantDetail(id, query, this.audit(request));
      if (!result) throw new NotFoundException("platform_merchant_not_found");
      return result;
    });
  }

  @Get("merchant-rankings")
  @RequirePlatformPermissions("platform:orders:read")
  @ApiOperation({ summary: "Rank merchants by sales, AI cost or AI tokens" })
  async ranking(@Query() query: { from?: string; to?: string; sort?: string; limit?: string }, @Req() request: PlatformPrincipalRequest & { correlationId?: string }) {
    return this.execute(() => this.commerce.merchantRanking(query, this.audit(request)));
  }

  private audit(request: PlatformPrincipalRequest & { correlationId?: string }) {
    const principal = currentPlatformPrincipal(request);
    return { actorOperatorId: principal.operatorId, correlationId: request.correlationId ?? crypto.randomUUID(), environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown" };
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try { return this.serialize(await operation()); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : undefined;
      if (code?.startsWith("platform_orders_invalid_") || code?.startsWith("platform_merchants_invalid_")) throw new BadRequestException(code);
      throw error;
    }
  }

  private serialize<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current)) as T;
  }
}
