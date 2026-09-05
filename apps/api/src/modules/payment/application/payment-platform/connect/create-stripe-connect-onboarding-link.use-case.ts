import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  STRIPE_PLATFORM_PORT,
  PAYMENT_PLATFORM_ENVIRONMENT,
  BILLING_CONFIG_PORT,
  type StripePlatformPort,
  type PaymentPlatformEnvironment,
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
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection } from "../shared.js";
import { stripeConnectError } from "./stripe-connect-error.js";
import { paymentConnectReturn, type PaymentConnectReturn } from "./payment-connect-return.js";

@Injectable()
export class CreateStripeConnectOnboardingLinkUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
    @Inject(MERCHANT_REPOSITORY)
    private readonly merchants: MerchantRepository,
    @Inject(BILLING_CONFIG_PORT)
    private readonly billingConfig: BillingConfigPort,
  ) {}

  async execute(input: {
    merchantId: string;
    email: string;
    returnTo?: PaymentConnectReturn;
  }): Promise<{
    url: string;
    expiresAt?: string;
    connection: PaymentConnectionSnapshot;
  }> {
    const returnTo = paymentConnectReturn(input.returnTo);
    const profile = await this.merchants.getProfile(input.merchantId);
    if (!profile) throw new NotFoundException("merchant_not_found");

    let connection = await this.repository.getConnection(
      input.merchantId,
      "stripe",
    );
    let accountId = connection?.externalAccountId;
    if (!accountId) {
      const created = await this.stripe.createConnectAccount({
        merchantId: input.merchantId,
        merchantName: profile.name,
        email: input.email,
      }).catch(error => { throw stripeConnectError(error); });
      accountId = created.accountId;
      await this.repository.saveConnection({
        merchantId: input.merchantId,
        provider: "stripe",
        environment: this.environment.stripe,
        status: "pending",
        externalAccountId: accountId,
      });
      await this.merchants.setStripeConnectAccountId(
        input.merchantId,
        accountId,
      );
      connection = await requiredConnection(
        this.repository,
        input.merchantId,
        "stripe",
      );
    }

    const consoleUrl = this.billingConfig.consoleUrl().replace(/\/+$/, "");
    // The dashboard is a hash-routed SPA — return the buyer to the payment
    // connections tab with a flag (not a nonexistent /settings/... path).
    // refresh_url is hit if the link expires; send them back to retry.
    const link = await this.stripe.createConnectOnboardingLink({
      accountId,
      refreshUrl: `${consoleUrl}/?stripe_refresh=1#${returnTo}`,
      returnUrl: `${consoleUrl}/?stripe_connected=1#${returnTo}`,
    }).catch(error => { throw stripeConnectError(error); });
    return {
      ...link,
      connection: await requiredConnection(
        this.repository,
        input.merchantId,
        "stripe",
      ),
    };
  }
}

