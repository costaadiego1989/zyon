import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import type { BillingOffer } from "@zyon/shared-types";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { readStripeBillingPortalConfiguration } from "./stripe-env.js";
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
      billingCycle: item?.price.recurring?.interval === "year" ? "annual" : "monthly",
      billingAmountCents: item?.price.unit_amount == null ? undefined : item.price.unit_amount * (item.quantity ?? 1),
      billingDiscountPercent: /^\d{1,2}$/.test(item?.price.metadata?.billing_discount_percent ?? "") ? Number(item!.price.metadata.billing_discount_percent) : 0,
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
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000).toISOString() };
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
    offer?: BillingOffer;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    if (input.offer) await this.validateBillingPrice(input.priceId, input.offer);
    const openSessions = await this.requireStripe().checkout.sessions.list({ customer: input.customerId, status: "open", limit: 20 });
    const ownedSessions = openSessions.data.filter(session => session.mode === "subscription" && session.metadata?.merchant_id === input.merchantId);
    const open = ownedSessions.find(session => session.metadata?.price_id === input.priceId && session.url);
    for (const stale of ownedSessions.filter(session => session.id !== open?.id)) {
      await this.requireStripe().checkout.sessions.expire(stale.id);
    }
    if (open?.url) return { url: open.url, sessionId: open.id };
    const session = await this.requireStripe().checkout.sessions.create(
      {
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: input.offer?.cycle !== "annual",
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
      configuration: readStripeBillingPortalConfiguration(),
    });
    return { url: session.url };
  }

  private async validateBillingPrice(priceId: string, offer: BillingOffer): Promise<void> {
    const price = await this.requireStripe().prices.retrieve(priceId);
    if (!price.active || price.currency !== "brl" || price.unit_amount !== offer.amountCents ||
        price.recurring?.interval !== (offer.cycle === "annual" ? "year" : "month") ||
        price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed") {
      throw new ServiceUnavailableException("billing_price_configuration_mismatch");
    }
  }

  async scheduleBillingChange(input: { subscriptionId: string; priceId: string; offer: BillingOffer; merchantId: string }): Promise<{ effectiveAt: string }> {
    const stripe = this.requireStripe();
    await this.validateBillingPrice(input.priceId, input.offer);
    const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
    const item = subscription.items.data[0];
    if (subscription.metadata.merchant_id !== input.merchantId || subscription.status !== "active" ||
        subscription.cancel_at_period_end || subscription.items.data.length !== 1 ||
        !item?.current_period_end || item.quantity !== 1) throw new BadRequestException("billing_subscription_change_unavailable");
    const scheduleId = typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule?.id;
    let schedule = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : undefined;
    if (schedule && schedule.metadata?.zyon_billing_change !== "true") {
      throw new BadRequestException("billing_subscription_schedule_managed_externally");
    }
    schedule ??= await stripe.subscriptionSchedules.create(
      { from_subscription: subscription.id, metadata: { zyon_billing_change: "true", merchant_id: input.merchantId } },
      { idempotencyKey: "billing-schedule:" + subscription.id + ":" + item.current_period_end },
    );
    const phase = schedule.phases.find(p => p.start_date === schedule!.current_phase?.start_date);
    if (!phase || !schedule.current_phase) throw new BadRequestException("billing_subscription_period_unavailable");
    const currentPhase: Stripe.SubscriptionScheduleUpdateParams.Phase = {
      start_date: phase.start_date,
      end_date: item.current_period_end,
      items: [{ price: item.price.id, quantity: 1 }],
      proration_behavior: "none",
      discounts: phase.discounts.map(d => {
        if (typeof d.discount === "string") return { discount: d.discount };
        if (d.promotion_code) return { promotion_code: typeof d.promotion_code === "string" ? d.promotion_code : d.promotion_code.id };
        if (d.coupon) return { coupon: typeof d.coupon === "string" ? d.coupon : d.coupon.id };
        throw new BadRequestException("billing_subscription_discount_unavailable");
      }),
      default_tax_rates: phase.default_tax_rates?.map(t => t.id),
      collection_method: phase.collection_method ?? undefined,
      default_payment_method: typeof phase.default_payment_method === "string" ? phase.default_payment_method : phase.default_payment_method?.id,
    };
    await stripe.subscriptionSchedules.update(schedule.id, {
      metadata: { zyon_billing_change: "true", merchant_id: input.merchantId },
      end_behavior: "release", proration_behavior: "none",
      phases: [currentPhase, {
        items: [{ price: input.priceId, quantity: 1 }],
        duration: { interval: input.offer.cycle === "annual" ? "year" : "month", interval_count: 1 },
        proration_behavior: "none",
        metadata: { merchant_id: input.merchantId },
      }],
    });
    return { effectiveAt: new Date(item.current_period_end * 1000).toISOString() };
  }

  private requireStripe(): Stripe {
    if (!this.secretKey) throw new Error("stripe_not_configured");
    this.stripe ??= new Stripe(this.secretKey, {
      apiVersion: "2026-04-22.dahlia",
    });
    return this.stripe;
  }
}
