import { Inject, Injectable, BadRequestException, Optional } from "@nestjs/common";
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

    const valueBrl = BILLING_PLANS[input.planKey as BillingPlan].monthlyPriceBrl;
    let billing = await this.repository.getBilling(input.merchantId);

    if (!billing) {
      billing = await this.repository.getOrCreateTrial(input.merchantId, 14);
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
      creditCard: input.card,
      creditCardHolderInfo: input.holderInfo,
      remoteIp: input.remoteIp,
    });

    const now = new Date();
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

    await this.repository.saveBilling({
      merchantId: input.merchantId,
      provider: "asaas",
      planKey: input.planKey as BillingPlan,
      status: "active",
      asaasCustomerId: customerId,
      asaasSubscriptionId: result.subscriptionId,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: currentPeriodEnd.toISOString(),
    });

    return this.repository.getBilling(input.merchantId);
  }
}
