import { ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  STRIPE_PLATFORM_PORT,
  PAYMENT_PLATFORM_ENVIRONMENT,
  type StripePlatformPort,
  type PaymentPlatformEnvironment,
} from "../../../domain/ports/payment-platform-provider.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { PaymentConnectionSnapshot } from "../../../domain/payment-platform.types.js";
import { requiredConnection, providerGatewayError, providerErrorCode } from "../shared.js";

@Injectable()
export class SyncStripeConnectUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(STRIPE_PLATFORM_PORT)
    private readonly stripe: StripePlatformPort,
    @Inject(PAYMENT_PLATFORM_ENVIRONMENT)
    private readonly environment: PaymentPlatformEnvironment,
  ) {}

  async execute(merchantId: string): Promise<PaymentConnectionSnapshot> {
    const connection = await requiredConnection(
      this.repository,
      merchantId,
      "stripe",
    );
    if (!connection.externalAccountId) {
      throw new ConflictException("stripe_connect_account_missing");
    }
    try {
      const status = await this.stripe.retrieveConnectAccount(
        connection.externalAccountId,
      );
      const active =
        status.chargesEnabled &&
        status.payoutsEnabled &&
        status.detailsSubmitted &&
        status.requirements.length === 0;
      // Distinguish "under review" from "restricted": if the merchant already
      // submitted all details and nothing is currently/past due, Stripe is
      // still enabling charges/payouts on its side → show pending, not
      // restricted (which reads as the merchant still owing information).
      const underReview =
        !active && status.detailsSubmitted && status.requirements.length === 0;
      await this.repository.saveConnection({
        merchantId,
        provider: "stripe",
        environment: this.environment.stripe,
        status: active ? "active" : underReview ? "pending" : "restricted",
        externalAccountId: status.accountId,
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        requirements: status.requirements,
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      await this.repository.saveConnection({
        merchantId,
        provider: "stripe",
        environment: connection.environment,
        status: "degraded",
        externalAccountId: connection.externalAccountId,
        errorCode: providerErrorCode(error),
      });
      throw providerGatewayError("stripe", error);
    }
    return requiredConnection(this.repository, merchantId, "stripe");
  }
}

