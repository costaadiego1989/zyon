import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type {
  StripeConnectAccountStatus,
  StripePlatformPort,
  StripeBillingSubscription,
  StripeBillingInvoice,
} from "../domain/ports/payment-platform-provider.port.js";

export class StripePlatformAdapter implements StripePlatformPort {
  private stripe?: Stripe;

  constructor(private readonly secretKey: string | undefined) {}

  async retrieveBillingSubscription(subscriptionId: string): Promise<StripeBillingSubscription> {
    const subscription = await this.requireStripe().subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    const raw = subscription as Stripe.Subscription & { current_period_end?: number };
    const end = item?.current_period_end ?? raw.current_period_end;
    return {
      merchantId: subscription.metadata.merchant_id,
      customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      subscriptionId: subscription.id,
      priceId: item?.price.id,
      status: subscription.status === "canceled" || subscription.status === "incomplete_expired" ? "cancelled" : subscription.status,
      currentPeriodEnd: end ? new Date(end * 1000).toISOString() : undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
  }

  async listBillingInvoices(customerId: string): Promise<StripeBillingInvoice[]> {
    const invoices = await this.requireStripe().invoices.list({ customer: customerId, limit: 100 });
    return invoices.data.map(invoice => ({
      id: invoice.id,
      amountBrl: invoice.total / 100,
      periodStart: new Date(invoice.period_start * 1000).toISOString(),
      periodEnd: new Date(invoice.period_end * 1000).toISOString(),
      status: invoice.status ?? "draft",
      createdAt: new Date(invoice.created * 1000).toISOString(),
      invoiceUrl: invoice.hosted_invoice_url ?? undefined,
    }));
  }

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
    const openSessions = await this.requireStripe().checkout.sessions.list({ customer: input.customerId, status: "open", limit: 20 });
    const open = openSessions.data.find(session => session.mode === "subscription" && session.metadata?.price_id === input.priceId && session.url);
    if (open?.url) return { url: open.url, sessionId: open.id };
    const session = await this.requireStripe().checkout.sessions.create(
      {
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.merchantId,
        metadata: { merchant_id: input.merchantId, price_id: input.priceId },
        subscription_data: {
          metadata: { merchant_id: input.merchantId },
        },
      },
      {
        idempotencyKey: `billing-checkout:${input.merchantId}:${randomUUID()}`,
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
      configuration: process.env.STRIPE_BILLING_PORTAL_CONFIGURATION || undefined,
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
