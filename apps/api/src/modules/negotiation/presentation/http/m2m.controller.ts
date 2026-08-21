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
import type { Request } from "express";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";

@ApiTags("M2M - Machine-to-Machine Protocol")
@Controller("m2m")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class M2mController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  @Post("register")
  @ApiOperation({ summary: "Register buyer agent for M2M protocol" })
  @ApiOkResponse({ description: "Agent registered" })
  async registerAgent(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      agentId: body?.agentId,
      message: "Agent registered",
    };
  }

  @Post("discover")
  @ApiOperation({ summary: "Search catalog via M2M protocol" })
  @ApiOkResponse({ description: "Catalog search results" })
  async discoverProducts(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      query: body?.query,
      results: [],
      message: "Catalog search results",
    };
  }

  @Post("negotiate")
  @ApiOperation({ summary: "Initiate negotiation session via M2M" })
  @ApiOkResponse({ description: "Negotiation initiated" })
  async initiateNegotiation(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      sessionId: body?.sessionId,
      message: "Negotiation session created",
    };
  }

  @Post("quote")
  @ApiOperation({ summary: "Get quote (pricing + shipping) via M2M" })
  @ApiOkResponse({ description: "Quote generated" })
  async getQuote(
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
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
    @Req() req: Request,
    @Body() body: any,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      orderId: body?.orderId,
      message: "Order created",
    };
  }

  @Get("track/:orderId")
  @ApiOperation({ summary: "Track order fulfillment status via M2M" })
  @ApiOkResponse({ description: "Order status retrieved" })
  async trackOrder(
    @Req() req: Request,
    @Param("orderId") orderId: string,
  ) {
    const user = currentUser(req);
    return {
      merchantId: user.merchantId,
      orderId,
      status: "pending",
      message: "Order status",
    };
  }
}
