import type { BillingCycle } from "@zyon/shared-types";
import { quoteBilling } from "../../../infrastructure/billing-offers.js";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import {
  STRIPE_PLATFORM_PORT,
  BILLING_CONFIG_PORT,
  type StripePlatformPort,
  type BillingConfigPort,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../../../merchant/domain/ports/merchant-repository.port.js";
import type { BillingPlan } from "../../../domain/payment-platform.types.js";
import { stripeBillingError } from "./stripe-billing-error.js";
import {
  MERCADOPAGO_BILLING_PORT,
  type MercadoPagoBillingPort,
} from "../../../domain/ports/mercadopago-billing.port.js";
import {
  billingCheckoutProvider,
  isMercadoPagoBillingConfigured,
} from "../../../infrastructure/mercadopago-billing-env.js";

@Injectable()
export class CreateBillingCheckoutUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
    @Optional()
    @Inject(MERCADOPAGO_BILLING_PORT)
    private readonly mercadoPago?: MercadoPagoBillingPort,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
    plan: BillingPlan;
    billingCycle?: BillingCycle;
  }): Promise<{ url: string; sessionId: string }> {
    if (!isPaidPlan(input.plan)) throw new BadRequestException("billing_paid_plan_required");
    const offer = quoteBilling(input.plan, input.billingCycle);
    const billing = await this.repository.getBilling(input.merchantId);
    if ((billing?.stripeSubscriptionId || billing?.asaasSubscriptionId) && ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(billing.status)) {
      throw new ConflictException("billing_subscription_exists_use_portal");
    }
    if (billingCheckoutProvider() === "mercadopago") {
      if (!isMercadoPagoBillingConfigured() || !this.mercadoPago) {
        throw new ServiceUnavailableException("mercadopago_billing_not_configured");
      }
      if ((billing?.stripeSubscriptionId || billing?.asaasSubscriptionId || billing?.mercadoPagoPreapprovalId) && ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"].includes(billing.status)) {
        throw new ConflictException("billing_subscription_exists_use_portal");
      }
      const result = await this.mercadoPago.createPendingPreapproval({
        merchantId: input.merchantId,
        email: input.email,
        plan: input.plan,
        billingCycle: offer.cycle,
        amountCents: offer.amountCents,
        returnUrl: `${this.billingConfig.consoleUrl()}/?billing=mercadopago#billing-plans`,
      });
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        provider: "mercadopago",
        planKey: billing?.planKey ?? "starter",
        mercadoPagoPreapprovalId: result.preapprovalId,
        status: billing?.status === "trialing" ? "trialing" : "incomplete",
        pendingUpgradePlanKey: input.plan,
        pendingUpgradeAmountCents: offer.amountCents,
        pendingUpgradeRequestedAt: new Date().toISOString(),
        billingAmountCents: offer.amountCents,
        billingCycle: offer.cycle,
        billingDiscountPercent: offer.discountPercent,
        cancelAtPeriodEnd: false,
      });
      return { url: result.checkoutUrl, sessionId: result.preapprovalId };
    }

    const priceId = this.billingConfig.priceId(input.plan, offer.cycle);
    const profile = await this.merchants.getProfile(input.merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");
    let customerId = billing?.stripeCustomerId;
    if (!customerId) {
      try {
        customerId = (
          await this.stripe.createBillingCustomer({
            merchantId: input.merchantId,
            merchantName: profile.name,
            email: input.email,
          })
        ).customerId;
      } catch (error) {
        throw stripeBillingError(error);
      }
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        provider: "stripe",
        planKey: billing?.planKey ?? "starter",
        status: billing?.status === "trialing" ? "trialing" : "incomplete",
        cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
        stripeCustomerId: customerId,
      });
    }
    const consoleUrl = this.billingConfig.consoleUrl();
    try {
      return await this.stripe.createSubscriptionCheckout({
        merchantId: input.merchantId,
        customerId,
        priceId,
        offer,
        successUrl: `${consoleUrl}/?billing=success#billing-plans`,
        cancelUrl: `${consoleUrl}/?billing=cancelled#billing-plans`,
      });
    } catch (error) {
      throw stripeBillingError(error);
    }
  }
}

function isPaidPlan(plan: BillingPlan): plan is Exclude<BillingPlan, "starter"> {
  return plan === "starter179" || plan === "growth" || plan === "scale";
}

