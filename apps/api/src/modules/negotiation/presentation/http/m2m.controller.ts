import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { TenantAccessGuard } from "../../../integrations/presentation/http/tenant-access.guard.js";
import type { TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";

@ApiTags("M2M - Machine-to-Machine Protocol")
@Controller("m2m")
@UseGuards(TenantAccessGuard)
@ApiBearerAuth("JWT")
export class M2mController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Post("register")
  @ApiOperation({ summary: "Register buyer agent for M2M protocol" })
  @ApiOkResponse({ description: "Agent registered" })
  async registerAgent(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      agentId: body?.agentId,
      message: "Agent registered",
    };
  }

  @Post("discover")
  @ApiOperation({ summary: "Search catalog via M2M protocol" })
  @ApiOkResponse({ description: "Catalog search results" })
  async discoverProducts(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      query: body?.query,
      results: [],
      message: "Catalog search results",
    };
  }

  @Post("negotiate")
  @ApiOperation({ summary: "Initiate negotiation session via M2M" })
  @ApiOkResponse({ description: "Negotiation initiated" })
  async initiateNegotiation(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      sessionId: body?.sessionId,
      message: "Negotiation session created",
    };
  }

  @Post("quote")
  @ApiOperation({ summary: "Get quote (pricing + shipping) via M2M" })
  @ApiOkResponse({ description: "Quote generated" })
  async getQuote(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      cart: body?.cart,
      quote: {
        subtotalCents: 0,
        shippingCents: 0,
        totalCents: 0,
      },
      message: "Quote calculated",
    };
  }

  @Post("checkout")
  @ApiOperation({ summary: "Create order via M2M protocol" })
  @ApiOkResponse({ description: "Order created" })
  async createOrder(
    @Req() req: TenantPrincipalRequest,
    @Body() body: any,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      orderId: body?.orderId,
      message: "Order created",
    };
  }

  @Get("track/:orderId")
  @ApiOperation({ summary: "Track order fulfillment status via M2M" })
  @ApiOkResponse({ description: "Order status retrieved" })
  async trackOrder(
    @Req() req: TenantPrincipalRequest,
    @Param("orderId") orderId: string,
  ) {
    const principal = currentTenantPrincipal(req);
    return {
      merchantId: principal.tenantId,
      orderId,
      status: "pending",
      message: "Order status",
    };
  }
}
