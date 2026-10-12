import { HttpException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { MERCHANT_RULES_REPOSITORY, type MerchantRulesRepository } from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import { CHECKOUT_SETTINGS_PORT, type CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../../../payment/domain/ports/payment-repository.port.js";
import { ApplyCouponUseCase } from "../../../coupons/application/use-cases/apply-coupon.use-case.js";
import { checkoutBenefitsPolicy } from "../../domain/services/checkout-benefits-policy.js";
import type { AdvancedRule } from "../../domain/services/advanced-rule-evaluator.service.js";
import { CheckoutOfferService } from "./checkout-offer.service.js";

@Injectable()
export class CheckoutBenefitsService {
  private readonly logger = new Logger(CheckoutBenefitsService.name);
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRules: MerchantRulesRepository,
    @Inject(CHECKOUT_SETTINGS_PORT) private readonly settings: CheckoutSettingsPort,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly coupons: ApplyCouponUseCase,
    @Optional() private readonly offers?: CheckoutOfferService,
  ) {}

  async prepare(merchantId: string, sessionId: string, method: string) {
    let session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new NotFoundException("checkout_session_not_found");
    if (await this.payments.hasCommittedPaymentForSession(merchantId, sessionId)) return session;
    const [rules, settings, config, history] = await Promise.all([
      this.merchantRules.getRules(merchantId), this.settings.getContext(merchantId),
      this.settings.getInterventionConfig(merchantId), this.sessions.getSessionEvents(merchantId, sessionId),
    ]);
    if (!rules) return session;
    session = await this.sessions.prepareProgressiveIncentivePayment?.(merchantId, sessionId, method) ?? session;
    // Selecting a method is a real stage; record it BEFORE any provider intent.
    if (!history.includes("payment_method_selected")) {
      await this.sessions.recordEvent(merchantId, sessionId, "payment_method_selected", { method, source: "payment_preparation" });
      session = await this.sessions.getSession(merchantId, sessionId);
      if (!session) throw new NotFoundException("checkout_session_not_found");
    }
    let advancedRules = (config.advancedRules ?? []) as AdvancedRule[];
    if (this.offers) {
      advancedRules = (await this.offers.shapeAdvancedRulesForExperiment(merchantId, sessionId, session.promptVariantId, advancedRules)).rules;
    }
    let evaluated = checkoutBenefitsPolicy({ session, rules, advancedRules,
      progressivePolicy: settings?.checkout_settings.progressive_discount,
      events: [...history, "payment_method_selected"], paymentMethod: method });
    if (evaluated.couponCode) {
      try {
        const applied = await this.coupons.executeForCheckout({ merchant_id: merchantId, session_id: sessionId,
          code: evaluated.couponCode, expectedVersion: session.persistenceVersion });
        return applied.session;
      } catch (error) {
        // An expired/exhausted/unavailable promotion is not an entitlement.
        // Database, concurrency and immutability errors must still fail closed.
        if (!(error instanceof HttpException) || ![400, 404, 422].includes(error.getStatus())
          || !error.message.startsWith("COUPON_")) throw error;
        this.logger.warn({ event: "checkout.automatic_coupon_ineligible", merchantId, sessionId, reason: error.message });
        evaluated = checkoutBenefitsPolicy({ session, rules,
          advancedRules: advancedRules.filter(rule => rule.action.type !== "offer_coupon"),
          progressivePolicy: settings?.checkout_settings.progressive_discount,
          events: [...history, "payment_method_selected"], paymentMethod: method });
      }
    }
    if (JSON.stringify(evaluated.session.cart) === JSON.stringify(session.cart)
      && JSON.stringify(evaluated.session.shipping) === JSON.stringify(session.shipping)) return session;
    // Do not fall back to an unguarded write: real persistence must serialize
    // the grant against provider admission and concurrent checkout changes.
    if (!this.sessions.saveBenefitsIfMutable) throw new Error("CHECKOUT_BENEFITS_PERSISTENCE_UNAVAILABLE");
    return this.sessions.saveBenefitsIfMutable(evaluated.session, session, rules);
  }
}
