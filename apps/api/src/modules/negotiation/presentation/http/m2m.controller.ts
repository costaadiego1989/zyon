import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { EvaluateNegotiationUseCase } from "../../application/evaluate-negotiation.use-case.js";
import { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import { SearchProductsUseCase } from "../../../catalog/application/use-cases/search-products.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { CompleteOrderUseCase } from "../../../checkout/application/use-cases/complete-order.use-case.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { randomUUID } from "node:crypto";

@ApiTags("M2M - Machine-to-Machine Protocol")
@Controller("m2m")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class M2mController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() private readonly evaluateNegotiation?: EvaluateNegotiationUseCase,
    @Optional() private readonly getMerchantPolicy?: GetMerchantNegotiationPolicyUseCase,
    @Optional() private readonly getBuyerPreferences?: GetBuyerAgentPreferencesUseCase,
    @Optional() private readonly searchProducts?: SearchProductsUseCase,
    @Optional() private readonly startCheckout?: StartCheckoutUseCase,
    @Optional() private readonly completeOrder?: CompleteOrderUseCase,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccounts?: BuyerAccountRepository,
  ) {}

  @Post("register")
  @ApiOperation({ summary: "Register buyer agent for M2M protocol" })
  @ApiOkResponse({ description: "Agent registered with credentials" })
  async registerAgent(
    @Req() req: any,
    @Body() body: { agentId: string; globalUserId: string },
  ) {
    const user = currentUser(req);
    if (!this.buyerAccounts) {
      throw new BadRequestException("buyer_accounts_unavailable");
    }

    // Fetch or create agent profile
    let agent = await this.buyerAccounts.findAgentByGlobalUserId(body.globalUserId);
    if (!agent) {
      throw new NotFoundException("agent_profile_not_found");
    }

    // Generate M2M credentials: secret is random + hashed for storage
    const secret = randomBytes(32).toString("hex");
    const secretHash = createHash("sha256").update(secret).digest("hex");

    // Enable M2M on agent
    const updatedAgent = agent.withM2mEnabled(secretHash);
    await this.buyerAccounts.saveAgent(updatedAgent);

    return {
      agent_id: body.agentId,
      secret: `m2m_${secret}`,
      globalUserId: body.globalUserId,
      createdAt: new Date().toISOString(),
    };
  }

  @Post("discover")
  @ApiOperation({ summary: "Search catalog via M2M protocol" })
  @ApiOkResponse({ description: "Catalog search results" })
  async discoverProducts(
    @Req() req: any,
    @Body() body: { merchantId: string; query?: string; limit?: number },
  ) {
    const user = currentUser(req);
    if (!this.searchProducts) {
      return {
        merchantId: body.merchantId,
        query: body.query,
        results: [],
        message: "Search unavailable",
      };
    }

    try {
      const result = await this.searchProducts.execute({
        merchantId: body.merchantId,
        query: body.query || "",
        limit: body.limit ?? 20,
      });

      return {
        merchantId: body.merchantId,
        query: body.query,
        results: result.products.map((p: any) => ({
          id: p.id,
          title: p.title || p.name,
          price: p.price,
        })),
        total: result.total,
      };
    } catch (error) {
      return {
        merchantId: body.merchantId,
        query: body.query,
        results: [],
        error: String(error),
      };
    }
  }

  @Post("negotiate")
  @ApiOperation({ summary: "Initiate negotiation session via M2M" })
  @ApiOkResponse({ description: "Negotiation agreement" })
  async initiateNegotiation(
    @Req() req: any,
    @Body() body: {
      merchantId: string;
      globalUserId: string;
      cart: { total: number; items: Array<{ sku: string; price: number; quantity: number }> };
    },
  ) {
    const user = currentUser(req);
    if (!this.evaluateNegotiation || !this.getMerchantPolicy || !this.getBuyerPreferences) {
      throw new BadRequestException("negotiation_services_unavailable");
    }

    try {
      const [policy, preferencesResolved] = await Promise.all([
        this.getMerchantPolicy.executeResolved(body.merchantId),
        this.getBuyerPreferences.executeResolved({
          merchantId: body.merchantId,
          globalUserId: body.globalUserId,
        }),
      ]);

      const result = this.evaluateNegotiation.execute({
        merchantId: body.merchantId,
        globalUserId: body.globalUserId,
        cart: body.cart,
        merchantPolicy: policy,
        buyerPreferences: preferencesResolved,
      });

      return {
        merchantId: body.merchantId,
        agreement: result.agreement,
        selectedDiscountPercent: result.selectedDiscountPercent,
        selectedScope: result.selectedScope,
        denialReason: result.denialReason,
        audit: result.audit,
      };
    } catch (error) {
      throw new BadRequestException(`negotiation_failed: ${String(error)}`);
    }
  }

  @Post("quote")
  @ApiOperation({ summary: "Get quote (pricing + shipping) via M2M" })
  @ApiOkResponse({ description: "Quote generated" })
  async getQuote(
    @Req() req: any,
    @Body() body: {
      merchantId: string;
      cart: { total: number; items: Array<{ sku: string; price: number; quantity: number }> };
      discountPercent?: number;
      shippingCents?: number;
    },
  ) {
    const user = currentUser(req);

    const subtotalCents = Math.round(body.cart.total * 100);
    const discountPercent = body.discountPercent ?? 0;
    const discountCents = Math.round(subtotalCents * (discountPercent / 100));
    const shippingCents = body.shippingCents ?? 0;

    const totalCents = subtotalCents - discountCents + shippingCents;

    return {
      merchantId: body.merchantId,
      subtotalCents,
      discountCents,
      discountPercent,
      shippingCents,
      totalCents,
      currency: "BRL",
    };
  }

  @Post("checkout")
  @ApiOperation({ summary: "Create order via M2M protocol" })
  @ApiOkResponse({ description: "Order created" })
  async createOrder(
    @Req() req: any,
    @Body() body: {
      merchantId: string;
      globalUserId: string;
      sessionId?: string;
      cart: { total: number; items: Array<{ sku: string; name: string; price: number; quantity: number }> };
      customer?: { email?: string; phone?: string };
    },
  ) {
    const user = currentUser(req);
    if (!this.startCheckout) {
      throw new BadRequestException("checkout_services_unavailable");
    }

    try {
      const sessionId = body.sessionId || `m2m_${randomUUID()}`;
      const response = await this.startCheckout.execute({
        session_id: sessionId,
        merchant_id: body.merchantId,
        customer: body.customer || {},
        cart: {
          ...body.cart,
          currency: "BRL",
        },
      });

      return {
        merchantId: body.merchantId,
        sessionId: response.session_id,
        status: "session_created",
        cartTotal: body.cart.total,
      };
    } catch (error) {
      throw new BadRequestException(`checkout_failed: ${String(error)}`);
    }
  }

  @Get("track/:orderId")
  @ApiOperation({ summary: "Track order fulfillment status via M2M" })
  @ApiOkResponse({ description: "Order status retrieved" })
  async trackOrder(
    @Req() req: any,
    @Param("orderId") orderId: string,
  ) {
    const user = currentUser(req);

    try {
      // Query completed order by ID
      const order = await (this.prisma as any).completedOrder.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          merchantId: true,
          status: true,
          commerceOrderId: true,
          fulfillmentStatus: true,
          trackingCode: true,
          estimatedDelivery: true,
          createdAt: true,
        },
      });

      if (!order) {
        throw new NotFoundException("order_not_found");
      }

      if (order.merchantId !== user.merchantId) {
        throw new BadRequestException("order_merchant_mismatch");
      }

      return {
        orderId: order.id,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        trackingCode: order.trackingCode,
        estimatedDelivery: order.estimatedDelivery,
        createdAt: order.createdAt,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(`track_failed: ${String(error)}`);
    }
  }
}
