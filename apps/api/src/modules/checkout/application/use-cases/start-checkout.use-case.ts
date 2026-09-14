import { BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import type {
  StartCheckoutRequest,
  StartCheckoutResponse,
  SuggestedProduct
} from "@zyon/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { MERCHANT_PLAN_PORT, type MerchantPlanPort } from "../../domain/ports/merchant-plan.port.js";
import { buildExperienceFromSession } from "../services/checkout-experience.service.js";
import { CHECKOUT_EXPERIENCE_CONFIG, type CheckoutExperienceConfig } from "../../domain/checkout-experience.config.js";
import {
  CHECKOUT_CROSS_SELL_RECOMMENDER,
  type CheckoutCrossSellRecommenderPort
} from "../../domain/ports/cross-sell-recommender.port.js";
import { DEFAULT_PLATFORM_FEE_BRL } from "../../../../shared/config/platform-fee.config.js";
import { BuyerResolutionService } from "../services/buyer-resolution.service.js";
import { BuyerContextService } from "../services/buyer-context.service.js";
import { CheckoutBootstrapService } from "../services/checkout-bootstrap.service.js";
import { InterventionRuleTextBuilder } from "../services/intervention-rule-text.builder.js";
import { CheckoutCartAuthorityService } from "../services/checkout-cart-authority.service.js";
import { unverifiedCustomerHints } from "../services/checkout-input-policy.js";
import type { TrustedCheckoutBuyer } from "../services/trusted-checkout-buyer.js";
import { OrderQuotaService } from "../../../payment/application/services/order-quota.service.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../payment/domain/ports/payment-platform-repository.port.js";
import { isStripeConfigured } from "../../../payment/infrastructure/stripe-env.js";
import {
  resolveCheckoutPaymentCapabilities,
  type CheckoutPaymentCapabilities,
} from "../../../payment/domain/checkout-payment-routing.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";
import { PROMPT_EXPERIMENT_PORT, type PromptExperimentPort } from "../../domain/ports/prompt-experiment.port.js";
import { selectWeightedVariant } from "../../../../shared/experiments/weighted-variant-assignment.js";

@Injectable()
export class StartCheckoutUseCase {
  private readonly logger = new Logger(StartCheckoutUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly buyerResolution: BuyerResolutionService,
    private readonly buyerContext: BuyerContextService,
    private readonly bootstrap: CheckoutBootstrapService,
    private readonly ruleBuilder: InterventionRuleTextBuilder,
    @Optional() @Inject(CHECKOUT_SETTINGS_PORT) private readonly checkoutSettings?: CheckoutSettingsPort,
    @Optional() @Inject(MERCHANT_REPOSITORY) private readonly merchantRepository?: MerchantRepository,
    @Optional() @Inject(MERCHANT_PLAN_PORT) private readonly merchantPlan?: MerchantPlanPort,
    @Optional() @Inject(CHECKOUT_CROSS_SELL_RECOMMENDER) private readonly crossSell?: CheckoutCrossSellRecommenderPort,
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: DEFAULT_PLATFORM_FEE_BRL },
    @Optional() private readonly cartAuthority?: CheckoutCartAuthorityService,
    private readonly orderQuota?: OrderQuotaService,
    @Optional() @Inject(PAYMENT_PLATFORM_REPOSITORY) private readonly paymentConnections?: PaymentPlatformRepository,
    @Optional() @Inject(PROMPT_EXPERIMENT_PORT) private readonly promptExperiment?: PromptExperimentPort,
  ) { }

  async execute(input: StartCheckoutRequest, trustedContext?: { storefrontCartRef?: string; trustedBuyer?: TrustedCheckoutBuyer; requireBuyerProof?: boolean }): Promise<StartCheckoutResponse> {
    if (typeof input.merchant_id !== "string" || !input.merchant_id.trim()) {
      throw new BadRequestException("checkout_merchant_required");
    }
    await this.orderQuota?.assertCanAcceptNewSales(input.merchant_id);
    if (!this.cartAuthority) throw new ServiceUnavailableException("checkout_cart_authority_unavailable");
    const { global_user_id: _untrustedBuyerId, ...untrustedInput } = input as StartCheckoutRequest & { global_user_id?: unknown };
    input = {
      ...untrustedInput,
      merchant_id: input.merchant_id.trim(),
      cart: trustedContext?.storefrontCartRef
        ? await this.cartAuthority.resolveStorefront(input.merchant_id.trim(), trustedContext.storefrontCartRef)
        : await this.cartAuthority.resolve(input.merchant_id.trim(), input.cart),
      customer: trustedContext?.trustedBuyer?.customer ?? unverifiedCustomerHints(input.customer),
      shipping: undefined,
    };
    const settings = await this.checkoutSettings?.getContext(input.merchant_id);
    const merchant = await this.merchantRepository?.getProfile(input.merchant_id);
    const paymentMethods = await this.resolvePaymentMethods(
      input.merchant_id,
      merchant?.stripeConnectAccountId,
      merchant?.storeSettings,
    );

    // Plano efetivo do merchant → gates de features no checkout:
    // - whiteLabel: badge "Powered by Zyon" só quando plano NÃO tem a feature.
    // - voiceCheckout: canal de voz só quando plano tem a feature (Growth+).
    // Starter (Free) e trial caem em Starter (effectiveBillingPlan).
    const { showBranding, voiceEnabled } = await this.merchantPlan?.resolveExperienceFlags(input.merchant_id) ?? { showBranding: true, voiceEnabled: false };
    const merchantRules = await this.merchantRepository?.getRules(input.merchant_id);
    // Only application-verified proof may provide the buyer identity. Browser
    // hints stay anonymous until this bridge or checkout OTP authenticates them.
    const globalUserId = trustedContext?.trustedBuyer?.globalUserId ?? (await this.buyerResolution.resolve({
      ...input,
      customer: undefined
    })).globalUserId;
    const enrichedInput = input;

    // Phase 2: Buyer Context
    const { agent, buyerIntent } = await this.buyerContext.load(input.merchant_id, globalUserId);

    // Phase 3: Checkout Bootstrap
    let { session } = await this.bootstrap.bootstrap(enrichedInput, globalUserId, true, {
      trustedBuyer: trustedContext?.trustedBuyer,
      requireBuyerProof: trustedContext?.requireBuyerProof,
    });
    session = await this.assignExperimentVariant(input.merchant_id, session);

    // Phase 4: Suggested Products
    const suggestedProducts = await this.resolveSuggestedProducts(input.merchant_id, session);

    // Build intervention rules from settings
    let advancedRules: string[] | undefined;
    try {
      const interventionConfig = await this.checkoutSettings?.getInterventionConfig(input.merchant_id);
      if (interventionConfig) {
        advancedRules = this.ruleBuilder.build(interventionConfig);
      }
    } catch { /* non-critical */ }

    return {
      conversation_id: session.conversationId,
      session_id: session.sessionId,
      global_user_id: session.globalUserId,
      agent_enabled: settings?.checkout_settings.mode !== "manual_only",
      initial_mode: settings?.checkout_settings.mode === "proactive" ? "open" : "silent",
      tracking_token: `trk_${crypto.randomUUID()}`,
      experience: buildExperienceFromSession(session, {
        merchantName: merchant?.name,
        theme: merchant?.theme,
        agent,
        couponBoxEnabled: merchantRules?.couponBoxEnabled,
        rules: merchantRules,
        showBranding,
        voiceEnabled,
        serviceFee: this.experienceConfig.platformFeeBrl,
        suggestedProducts,
        stripeConnectAccountId: merchant?.stripeConnectAccountId,
        paymentMethods,
        cryptoPaymentsEnabled: !!(merchantRules as any)?.cryptoPayments?.enabled,
        cryptoPayments: (merchantRules as any)?.cryptoPayments ?? null,
        merchantRulesForWidget: merchantRules ? {
          maxDiscountPercent: merchantRules.maxDiscountPercent,
          allowFreeShipping: merchantRules.allowFreeShipping,
          allowShippingDiscount: merchantRules.allowShippingDiscount,
          freeShippingMinCartValue: merchantRules.freeShippingMinCartValue,
          maxShippingSubsidy: merchantRules.maxShippingSubsidy,
          maxPartialShippingDiscount: merchantRules.maxPartialShippingDiscount,
          offerExpirationMinutes: merchantRules.offerExpirationMinutes,
          blockedRegions: merchantRules.blockedRegions,
          brandVoice: merchantRules.brandVoice,
          originZip: merchantRules.originZip,
        } : undefined,
        advancedRules,
        visual: merchant?.theme ? {
          mode: (merchant.theme as any).mode,
          density: (merchant.theme as any).density,
          backgroundImageUrl: (merchant.theme as any).backgroundImageUrl,
          borderRadius: (merchant.theme as any).borderRadius,
          fontFamily: (merchant.theme as any).fontFamily,
          fontDisplay: (merchant.theme as any).fontDisplay,
        } : undefined,
      }),
      turns: session.chatHistory
    };
  }

  private async resolvePaymentMethods(
    merchantId: string,
    stripeConnectAccountId: string | null | undefined,
    storeSettings?: MerchantStoreSettings,
  ): Promise<CheckoutPaymentCapabilities> {
    // A database outage must not make the checkout claim that a payment rail is
    // usable. The payment-intent endpoint remains the final authority.
    if (!this.paymentConnections) {
      return resolveCheckoutPaymentCapabilities(storeSettings?.paymentRouting, {
        asaas: false,
        mercadoPagoPix: false,
        mercadoPagoHostedCard: false,
        stripeCard: Boolean(isStripeConfigured() && stripeConnectAccountId),
        asaasHostedCard: false,
      });
    }

    try {
      const [asaas, mercadopago, stripe] = await Promise.all([
        this.paymentConnections.getConnection(merchantId, "asaas"),
        this.paymentConnections.getConnection(merchantId, "mercadopago"),
        this.paymentConnections.getConnection(merchantId, "stripe"),
      ]);
      const asaasActive = asaas?.status === "active";
      // Mercado Pago is operational only when the signed webhook can reconcile
      // payment and refund events. It may still be connected in the dashboard
      // while the platform secret is missing.
      const mercadoPagoPixActive =
        mercadopago?.status === "active" &&
        Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim());
      const stripeCardActive =
        isStripeConfigured() &&
        stripe?.status === "active" &&
        Boolean(stripe.externalAccountId || stripeConnectAccountId);

      return resolveCheckoutPaymentCapabilities(storeSettings?.paymentRouting, {
        asaas: asaasActive,
        mercadoPagoPix: mercadoPagoPixActive,
        mercadoPagoHostedCard: mercadoPagoPixActive,
        stripeCard: stripeCardActive,
        // The Asaas invoice page collects card data on Asaas, so Zyon never
        // receives a card number or CVV for this option.
        asaasHostedCard: asaasActive,
      });
    } catch {
      return resolveCheckoutPaymentCapabilities(storeSettings?.paymentRouting, {
        asaas: false,
        mercadoPagoPix: false,
        mercadoPagoHostedCard: false,
        stripeCard: false,
        asaasHostedCard: false,
      });
    }
  }

  private async assignExperimentVariant(merchantId: string, session: any) {
    if (!this.promptExperiment || session.promptVariantId || session.cohort === "holdout") return session;
    try {
      const running = await this.promptExperiment.findRunningExperiment(merchantId);
      const variant = running && selectWeightedVariant(session.sessionId, running.variants);
      if (!variant) return session;

      const assigned = { ...session, promptVariantId: variant.id };
      await this.sessions.saveSession(assigned);
      return assigned;
    } catch (error) {
      this.logger.warn({
        event: "checkout.experiment.assignment_failed",
        merchantId,
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return session;
    }
  }


  private async resolveSuggestedProducts(merchantId: string, session: any): Promise<SuggestedProduct[]> {
    if (!this.crossSell || session.cart.items.length === 0) return [];
    try {
      return await this.crossSell.suggest({
        merchant_id: merchantId,
        session_id: session.sessionId,
        cart: session.cart,
        touchpoint: "pre_payment"
      });
    } catch (error) {
      this.logger.warn({
        event: "checkout.cross_sell.initial_suggest_failed",
        merchantId,
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}

