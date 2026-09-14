import type { BillingCycle } from "@zyon/shared-types";
import { quoteBilling } from "../../../infrastructure/billing-offers.js";
import { Inject, Injectable, BadRequestException, ConflictException, Optional } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_PROVIDER,
  type BillingProviderPort,
} from "../../../domain/ports/billing-provider.port.js";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository,
} from "../../../../merchant/domain/ports/merchant-repository.port.js";
import { BILLING_PLANS } from "../../../domain/billing-plans.js";
import type { BillingPlan } from "../../../domain/payment-platform.types.js";

export interface SubscribeToPlanInput {
  merchantId: string;
  planKey: "growth" | "scale";
  billingCycle?: BillingCycle;
  card: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  holderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone: string;
  };
  remoteIp?: string;
}

@Injectable()
export class SubscribeToPlanUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
    @Optional()
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants?: MerchantRepository,
  ) {}

  async execute(input: SubscribeToPlanInput) {
    // planKey is typed to paid plans only ("growth" | "scale"); guard at runtime
    // in case a caller bypasses the type (e.g. untyped JSON body).
    if ((input.planKey as string) === "starter") {
      throw new BadRequestException("starter_is_free");
    }

    const offer = quoteBilling(input.planKey, input.billingCycle);
    const valueBrl = offer.amountCents / 100;
    let billing = await this.repository.getBilling(input.merchantId);

    if (!billing) {
      billing = await this.repository.getOrCreateTrial(input.merchantId, 14);
    }

    if ((billing.asaasSubscriptionId || billing.stripeSubscriptionId) && !["cancelled", "starter"].includes(billing.status)) {
      throw new ConflictException("billing_subscription_exists_use_portal");
    }
    let customerId = billing.asaasCustomerId;
    if (!customerId) {
      const profile = await this.merchants?.getProfile(input.merchantId);
      const customerInput = {
        merchantId: input.merchantId,
        name: profile?.name ?? input.holderInfo.name,
        // MerchantProfile has no top-level email (it lives in storeSettings.company.email);
        // the card holder's email is the authoritative billing contact here.
        email: profile?.storeSettings?.company?.email ?? input.holderInfo.email,
        cpfCnpj: input.holderInfo.cpfCnpj,
      };
      const created = await this.provider.createCustomer(customerInput);
      customerId = created.customerId;
    }

    const result = await this.provider.createSubscription({
      customerId,
      planKey: input.planKey as BillingPlan,
      valueBrl,
      billingCycle: offer.cycle,
      creditCard: input.card,
      creditCardHolderInfo: input.holderInfo,
      remoteIp: input.remoteIp,
    });

    const trialIsStillActive = billing.status === "trialing" &&
      Boolean(billing.trialEndsAt) && new Date(billing.trialEndsAt!).getTime() > Date.now();

    await this.repository.saveBilling({
      merchantId: input.merchantId,
      provider: "asaas",
      // The paid entitlement remains pending until an authenticated Asaas
      // payment event proves this exact amount was received.
      planKey: billing.planKey ?? "starter",
      // Asaas validates a card when creating a subscription, but the first
      // charge happens on `nextDueDate`. Paid access must wait for the billing
      // webhook; keep an existing Free trial intact in the meantime.
      status: trialIsStillActive ? "trialing" : "incomplete",
      asaasCustomerId: customerId,
      asaasSubscriptionId: result.subscriptionId,
      pendingUpgradePlanKey: input.planKey as BillingPlan,
      pendingUpgradeAmountCents: Math.round(valueBrl * 100),
      pendingUpgradeRequestedAt: new Date().toISOString(),
      billingAmountCents: offer.amountCents,
      billingCycle: offer.cycle,
      billingDiscountPercent: offer.discountPercent,
      cancelAtPeriodEnd: false,
    });

    return this.repository.getBilling(input.merchantId);
  }
}
