import { ConflictException, Inject, Injectable } from "@nestjs/common";
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

@Injectable()
export class CreateBillingPortalUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  async execute(merchantId: string): Promise<{ url: string }> {
    let billing = await this.repository.getOrCreateTrial(
      merchantId,
      14,
    );
    if (!billing.stripeCustomerId) {
      try {
        const { customerId } = await this.stripe.createBillingCustomer({
          merchantId,
          merchantName: merchantId,
          email: `billing-${merchantId.slice(-8)}@zyon.ai`,
        });
        await this.repository.saveBilling({
          merchantId,
          stripeCustomerId: customerId,
          status: billing.status ?? "trialing",
        });
        billing = { ...billing, stripeCustomerId: customerId };
      } catch (e) {
        throw new ConflictException("billing_customer_creation_failed");
      }
    }
    return this.stripe.createBillingPortal({
      customerId: billing.stripeCustomerId!,
      returnUrl: `${this.billingConfig.consoleUrl()}/settings/billing`,
    });
  }
}

