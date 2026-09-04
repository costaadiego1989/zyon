import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
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
import { BUYER_SERVICE_FEE_CENTS } from "../../../payment/domain/billing-plans.js";
import { BuyerResolutionService } from "../services/buyer-resolution.service.js";
import { BuyerContextService } from "../services/buyer-context.service.js";
import { CheckoutBootstrapService } from "../services/checkout-bootstrap.service.js";
import { InterventionRuleTextBuilder } from "../services/intervention-rule-text.builder.js";

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
    @Inject(CHECKOUT_EXPERIENCE_CONFIG) private readonly experienceConfig: CheckoutExperienceConfig = { platformFeeBrl: 1.99 }
  ) { }

  async execute(input: StartCheckoutRequest): Promise<StartCheckoutResponse> {
    const settings = await this.checkoutSettings?.getContext(input.merchant_id);
    const merchant = await this.merchantRepository?.getProfile(input.merchant_id);

    // Plano efetivo do merchant → gates de features no checkout:
    // - whiteLabel: badge "Powered by Zyon" só quando plano NÃO tem a feature.
    // - voiceCheckout: canal de voz só quando plano tem a feature (Growth+).
    // Starter (Free) e trial caem em Starter (effectiveBillingPlan).
    const { showBranding, voiceEnabled } = await this.merchantPlan?.resolveExperienceFlags(input.merchant_id) ?? { showBranding: true, voiceEnabled: false };
    const merchantRules = await this.merchantRepository?.getRules(input.merchant_id);

    // Phase 1: Buyer Resolution
    const { input: enrichedInput, globalUserId } = await this.buyerResolution.resolve(input);

    // Phase 2: Buyer Context
    const { agent, buyerIntent } = await this.buyerContext.load(input.merchant_id, globalUserId);

    // Phase 3: Checkout Bootstrap
    const { session } = await this.bootstrap.bootstrap(enrichedInput, globalUserId);

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
        serviceFee: BUYER_SERVICE_FEE_CENTS / 100, // R$0,99 fixo, todos os planos
        suggestedProducts,
        stripeConnectAccountId: merchant?.stripeConnectAccountId,
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

