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
import { M2mDualAuthGuard } from "./m2m-dual-auth.guard.js";
import { EvaluateNegotiationUseCase } from "../../application/evaluate-negotiation.use-case.js";
import { GetMerchantNegotiationPolicyUseCase } from "../../application/merchant-negotiation-policy.use-cases.js";
import { GetBuyerAgentPreferencesUseCase } from "../../application/buyer-agent-preferences.use-cases.js";
import { SearchProductsUseCase } from "../../../catalog/application/use-cases/search-products.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { CompleteOrderUseCase } from "../../../checkout/application/use-cases/complete-order.use-case.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { randomUUID } from "node:crypto";
import { QuoteShippingUseCase } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";
import { CreatePaymentIntentUseCase, type CreatePaymentIntentRequest } from "../../../payment/application/create-payment-intent.use-case.js";
import { CheckoutCustomerService } from "../../../checkout/application/services/checkout-customer.service.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../../checkout/domain/ports/checkout-session.repository.port.js";
import type { ShippingQuote } from "@zyon/shared-types";
import { M2MWebhookDispatcherService } from "../../infrastructure/m2m-webhook-dispatcher.service.js";

@ApiTags("M2M - Machine-to-Machine Protocol")
@Controller("m2m")
@UseGuards(M2mDualAuthGuard)
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
    @Optional() private readonly quoteShipping?: QuoteShippingUseCase,
    @Optional() private readonly createPaymentIntent?: CreatePaymentIntentUseCase,
    @Optional() private readonly checkoutCustomerService?: CheckoutCustomerService,
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly checkoutSession?: CheckoutSessionRepository,
    @Optional() private readonly webhookDispatcher?: M2MWebhookDispatcherService,
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

    const result = {
      agent_id: body.agentId,
      secret: `m2m_${secret}`,
      globalUserId: body.globalUserId,
      createdAt: new Date().toISOString(),
    };

    void this.webhookDispatcher?.dispatch(user.merchantId, "m2m.agent.registered", { agent_id: body.agentId, global_user_id: body.globalUserId });

    return result;
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

      void this.webhookDispatcher?.dispatch(user.merchantId, "m2m.negotiation.completed", {
        agreement: result.agreement,
        selected_discount_percent: result.selectedDiscountPercent,
        denial_reason: result.denialReason,
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
      shipping_address?: { cep: string };
    },
  ) {
    const user = currentUser(req);
    const subtotalCents = Math.round(body.cart.total * 100);
    const discountPercent = body.discountPercent ?? 0;
    const discountCents = Math.round(subtotalCents * (discountPercent / 100));
    const totalWithoutShippingCents = subtotalCents - discountCents;

    let shippingOptions: ShippingQuote[] = [];

    // If CEP provided, fetch real shipping quotes
    if (body.shipping_address?.cep && this.quoteShipping) {
      try {
        const cep = body.shipping_address.cep.replace(/\D/g, "");
        if (cep.length === 8) {
          const sessionId = `m2m_${randomUUID()}`;
          const quoteSnapshot = await this.quoteShipping.execute({
            session_id: sessionId,
            merchant_id: body.merchantId,
            destination_zip: cep,
            cart_total: body.cart.total,
            packages: body.cart.items.map((item) => ({
              weightKg: 0.3,
              heightCm: 10,
              widthCm: 15,
              lengthCm: 20,
              quantity: item.quantity ?? 1,
            })),
          });
          shippingOptions = quoteSnapshot.results.map((r) => ({
            customerPrice: r.price / 100,
            realCost: r.is_free ? 0 : r.price / 100,
            carrier: r.label,
            method: r.label,
            deliveryDays: r.eta_days,
            destinationZip: cep,
          }));
        }
      } catch (err) {
        // Fall back to empty shipping options if quote fails
      }
    }

    // Calculate total with first available shipping option (or use 0 if none)
    const shippingCents = shippingOptions.length > 0 ? Math.round(shippingOptions[0].customerPrice * 100) : 0;
    const totalCents = totalWithoutShippingCents + shippingCents;

    return {
      merchantId: body.merchantId,
      subtotalCents,
      discountCents,
      discountPercent,
      shippingCents,
      shippingOptions,
      totalCents,
      currency: "BRL",
      paymentMethods: ["pix", "credit_card"],
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
      payment_method?: "pix" | "credit_card";
      buyer_info?: {
        name: string;
        email: string;
        cpf: string;
        phone: string;
        address?: {
          cep: string;
          street: string;
          number: string;
          complement?: string;
          neighborhood?: string;
          city: string;
          state: string;
        };
      };
      selected_shipping?: { carrier: string; priceInCents: number };
    },
  ) {
    const user = currentUser(req);
    if (!this.startCheckout) {
      throw new BadRequestException("checkout_services_unavailable");
    }

    try {
      const sessionId = body.sessionId || `m2m_${randomUUID()}`;

      // 1. Create checkout session
      const response = await this.startCheckout.execute({
        session_id: sessionId,
        merchant_id: body.merchantId,
        customer: body.customer || {},
        cart: {
          ...body.cart,
          currency: "BRL",
        },
      });

      const session = await this.checkoutSession?.getSession(body.merchantId, sessionId);
      if (!session) {
        throw new NotFoundException("checkout_session_not_found");
      }

      // 2. Update session with buyer info and address
      if (body.buyer_info && this.checkoutCustomerService) {
        const updatedSession = this.checkoutCustomerService.mergeCustomers(session, {
          fullName: body.buyer_info.name,
          email: body.buyer_info.email,
          cpf: body.buyer_info.cpf,
          phone: body.buyer_info.phone,
          address: body.buyer_info.address ? {
            zip: body.buyer_info.address.cep,
            street: body.buyer_info.address.street,
            number: body.buyer_info.address.number,
            complement: body.buyer_info.address.complement || "",
            neighborhood: body.buyer_info.address.neighborhood || "",
            city: body.buyer_info.address.city,
            state: body.buyer_info.address.state,
          } : undefined,
        });

        await this.checkoutSession?.saveSession(updatedSession);
      }

      // 3. Add shipping selection if provided
      if (body.selected_shipping && this.checkoutSession) {
        const updatedSession = await this.checkoutSession.getSession(body.merchantId, sessionId);
        if (updatedSession) {
          updatedSession.shipping = {
            customerPrice: body.selected_shipping.priceInCents / 100,
            realCost: body.selected_shipping.priceInCents / 100,
            carrier: body.selected_shipping.carrier,
            method: body.selected_shipping.carrier,
            deliveryDays: 5, // Estimated
            destinationZip: body.buyer_info?.address?.cep || "",
          };
          await this.checkoutSession.saveSession(updatedSession);
        }
      }

      // 4. Create payment intent
      const paymentMethod = body.payment_method || "pix";
      const idempotencyKey = `${sessionId}_${paymentMethod}`;

      if (this.createPaymentIntent) {
        const paymentIntentRequest: CreatePaymentIntentRequest = {
          merchant_id: body.merchantId,
          session_id: sessionId,
          idempotency_key: idempotencyKey,
          method: paymentMethod === "credit_card" ? "card" : "pix",
          remote_ip: req.ip,
        };

        const paymentIntent = await this.createPaymentIntent.execute(paymentIntentRequest);

        return {
          merchantId: body.merchantId,
          sessionId: response.session_id,
          status: "payment_intent_created",
          paymentIntentId: paymentIntent.id,
          payment: {
            method: paymentMethod,
            status: paymentIntent.status,
            qrCode: paymentIntent.buyerFacing?.qrCodeCopyPaste,
            qrCodeImage: paymentIntent.buyerFacing?.encodedQrImage,
            clientSecret: paymentIntent.buyerFacing?.clientSecret, // for Stripe
            expiresAt: paymentIntent.buyerFacing?.quoteExpiresAt,
          },
          cartTotal: body.cart.total,
        };
      }

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
