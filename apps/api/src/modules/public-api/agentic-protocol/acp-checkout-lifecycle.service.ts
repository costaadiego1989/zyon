import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository,
} from "../../checkout/domain/ports/checkout-session.repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../merchant/domain/ports/merchant-repository.port.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository,
} from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import {
  PRODUCT_VARIANT_LOOKUP_PORT,
  type ProductVariantLookupPort,
} from "../../checkout/domain/ports/product-variant-lookup.port.js";
import {
  COUPON_REPOSITORY,
  type CouponRepository,
} from "../../coupons/domain/ports/coupon-repository.port.js";
import { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";
import { GetCheckoutSessionUseCase } from "../../checkout/application/use-cases/get-checkout-session.use-case.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";
import { CheckoutSessionMapper } from "./checkout-session.mapper.js";
import { AcpStatusPolicy } from "./acp-status.policy.js";
import { AcpMutabilityPolicy } from "./acp-mutability.policy.js";
import { AcpLineItemsResolver, type AcpLineItemInput } from "./acp-line-items.resolver.js";
import { AcpBuyerMerger, type AcpAddressInput, type AcpBuyerInput } from "./acp-buyer.merger.js";
import { AcpCouponApplier } from "./acp-coupon.applier.js";
import { AcpFulfillmentSelector } from "./acp-fulfillment.selector.js";
import {
  AcpPaymentOrchestrator,
  type AcpCompleteBody,
  type AcpPaymentMethodInput,
} from "./acp-payment.orchestrator.js";
import { AcpStoreDomainService } from "./acp-store-domain.service.js";

export type UpdateSessionBody = {
  fulfillment_option_id?: string;
  line_items?: ReadonlyArray<AcpLineItemInput>;
  coupon_code?: string;
  buyer?: AcpBuyerInput;
  fulfillment_address?: AcpAddressInput;
};

export type CompleteSessionBody = AcpCompleteBody & {
  payment_method?: AcpPaymentMethodInput;
};

export type CompleteSessionResult = {
  order_id: string;
  status: "completed";
  confirmation_url: string;
  session: ReturnType<typeof CheckoutSessionMapper.toAcp>;
};

@Injectable()
export class AcpCheckoutLifecycleService {
  private readonly statusPolicy: AcpStatusPolicy;
  private readonly mutabilityPolicy: AcpMutabilityPolicy;
  private readonly lineItemsResolver: AcpLineItemsResolver;
  private readonly buyerMerger: AcpBuyerMerger;
  private readonly couponApplier: AcpCouponApplier;
  private readonly fulfillmentSelector: AcpFulfillmentSelector;
  private readonly paymentOrchestrator: AcpPaymentOrchestrator;
  private readonly storeDomain: AcpStoreDomainService;

  constructor(
    private readonly getCheckoutSession: GetCheckoutSessionUseCase,
    private readonly updateCart: UpdateCartUseCase,
    private readonly completeOrder: CompleteOrderUseCase,
    private readonly applyCoupon: ApplyCouponUseCase,
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    @Inject(CHECKOUT_SESSION_REPOSITORY)
    private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Optional() @Inject(PRODUCT_VARIANT_LOOKUP_PORT)
    private readonly variantLookup?: ProductVariantLookupPort,
    @Optional() @Inject(COUPON_REPOSITORY)
    private readonly coupons?: CouponRepository,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly merchantRules?: MerchantRulesRepository,
  ) {
    this.statusPolicy = new AcpStatusPolicy(sessions);
    this.mutabilityPolicy = new AcpMutabilityPolicy(this.statusPolicy);
    this.lineItemsResolver = new AcpLineItemsResolver(updateCart, sessions, variantLookup);
    this.buyerMerger = new AcpBuyerMerger(sessions);
    this.couponApplier = new AcpCouponApplier(applyCoupon, coupons, merchantRules);
    this.fulfillmentSelector = new AcpFulfillmentSelector(sessions);
    this.paymentOrchestrator = new AcpPaymentOrchestrator(
      createPaymentIntent,
      completeOrder,
    );
    this.storeDomain = new AcpStoreDomainService();
  }

  async getSession(merchantId: string, sessionId: string) {
    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    const aacpStatus = await this.statusPolicy.derive(session);
    return CheckoutSessionMapper.toAcp({ session, aacpStatus });
  }

  async updateSession(merchantId: string, sessionId: string, body: UpdateSessionBody) {
    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    await this.mutabilityPolicy.assertMutable(session);

    if (body.line_items) {
      await this.lineItemsResolver.resolveAndApply(merchantId, session, body.line_items);
    }
    if (body.buyer || body.fulfillment_address) {
      await this.buyerMerger.mergeAndApply(session, body.buyer, body.fulfillment_address);
    }
    if (body.coupon_code) {
      await this.couponApplier.applyCoupon(session, body.coupon_code);
    }
    if (body.fulfillment_option_id) {
      await this.fulfillmentSelector.selectAndApply(session, body.fulfillment_option_id);
    }

    const refreshed = await this.getCheckoutSession.execute(merchantId, sessionId);
    const aacpStatus = await this.statusPolicy.derive(refreshed);
    return CheckoutSessionMapper.toAcp({ session: refreshed, aacpStatus });
  }

  async cancelSession(merchantId: string, sessionId: string) {
    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    await this.mutabilityPolicy.assertMutable(session);

    await this.sessions.recordEvent(merchantId, sessionId, "checkout_abandoned", {
      source: "acp.protocol",
      reason: "buyer_initiated",
    });
    await this.sessions.saveSession({
      ...session,
      cart: { ...session.cart, items: [], total: 0 },
      shipping: undefined,
      updatedAt: new Date().toISOString(),
    });

    const refreshed = await this.getCheckoutSession.execute(merchantId, sessionId);
    return CheckoutSessionMapper.toAcp({ session: refreshed, aacpStatus: "canceled" });
  }

  async completeSession(
    merchantId: string,
    sessionId: string,
    claims: EmbedTokenClaims,
    body: CompleteSessionBody,
  ): Promise<CompleteSessionResult> {
    if (!claims.scopes?.includes("payment:intents:confirm")) {
      throw new ForbiddenException({
        code: "token_scope_not_granted",
        missing_scopes: ["payment:intents:confirm"],
      });
    }

    const session = await this.getCheckoutSession.execute(merchantId, sessionId);
    await this.mutabilityPolicy.assertMutable(session);

    if ((session.cart?.items?.length ?? 0) === 0) {
      throw new BadRequestException("acp_cart_empty");
    }
    if (!session.shipping) {
      throw new BadRequestException("acp_shipping_required");
    }

    const { orderId } = await this.paymentOrchestrator.createIntentAndComplete(
      merchantId,
      sessionId,
      session,
      body,
      claims,
    );

    const profile = await this.merchants.getProfile(merchantId);
    const confirmationUrl = this.storeDomain.buildConfirmationUrl(profile, orderId);

    const refreshed = await this.getCheckoutSession.execute(merchantId, sessionId);
    const acpSession = CheckoutSessionMapper.toAcp({
      session: refreshed,
      aacpStatus: "completed",
    });

    return {
      order_id: orderId,
      status: "completed" as const,
      confirmation_url: confirmationUrl,
      session: acpSession,
    };
  }

  async assertMutable(session: CheckoutSession): Promise<void> {
    await this.mutabilityPolicy.assertMutable(session);
  }
}
