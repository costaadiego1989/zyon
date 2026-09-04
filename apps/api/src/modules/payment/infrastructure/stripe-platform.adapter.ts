import Stripe from "stripe";
import type {
  StripeConnectAccountStatus,
  StripePlatformPort,
} from "../domain/ports/payment-platform-provider.port.js";

export class StripePlatformAdapter implements StripePlatformPort {
  private stripe?: Stripe;

  constructor(private readonly secretKey: string | undefined) {}

  async createConnectAccount(input: {
    merchantId: string;
    merchantName: string;
    email: string;
  }): Promise<{ accountId: string }> {
    const account = await this.requireStripe().accounts.create(
      {
        type: "express",
        country: "BR",
        email: input.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: input.merchantName },
        metadata: { merchant_id: input.merchantId },
      },
      { idempotencyKey: `connect:${input.merchantId}` },
    );
    return { accountId: account.id };
  }

  async createConnectOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt?: string }> {
    const link = await this.requireStripe().accountLinks.create({
      account: input.accountId,
      refresh_url: input.refreshUrl,
      return_url: input.returnUrl,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
    });
    return { url: link.url };
  }

  async retrieveConnectAccount(
    accountId: string,
  ): Promise<StripeConnectAccountStatus> {
    const account = await this.requireStripe().accounts.retrieve(accountId);
    if (account.deleted) {
      throw new Error("stripe_connect_account_deleted");
    }
    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requirements: [
        ...(account.requirements?.currently_due ?? []),
        ...(account.requirements?.past_due ?? []),
      ],
    };
  }

  async createBillingCustomer(input: {
    merchantId: string;
    merchantName: string;
    email: string;
  }): Promise<{ customerId: string }> {
    const customer = await this.requireStripe().customers.create(
      {
        name: input.merchantName,
        email: input.email,
        metadata: { merchant_id: input.merchantId },
      },
      { idempotencyKey: `billing-customer:${input.merchantId}` },
    );
    return { customerId: customer.id };
  }

  async createSubscriptionCheckout(input: {
    merchantId: string;
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const session = await this.requireStripe().checkout.sessions.create(
      {
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.merchantId,
        metadata: { merchant_id: input.merchantId },
        subscription_data: {
          metadata: { merchant_id: input.merchantId },
        },
      },
      {
        idempotencyKey: `billing-checkout:${input.merchantId}:${input.priceId}`,
      },
    );
    if (!session.url) {
      throw new Error("stripe_billing_checkout_url_missing");
    }
    return { url: session.url, sessionId: session.id };
  }

  async createBillingPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.requireStripe().billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  private requireStripe(): Stripe {
    if (!this.secretKey) throw new Error("stripe_not_configured");
    this.stripe ??= new Stripe(this.secretKey, {
      apiVersion: "2026-04-22.dahlia",
    });
    return this.stripe;
  }
}
