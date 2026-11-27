import Stripe from "stripe";
import type { MetaAdsCheckout } from "@zyon/shared-types";
import { MetaAdsError, type AddonBillingPort, type BillingCheckoutRequest, type ProviderBillingEvent } from "../domain/types.js";
import { requireIdentifier, type MetaAdsEnvironment } from "../domain/offer.js";

const moduleName = "meta_ads_agent";
function remoteId(value: string | { id: string } | null | undefined): string | null { return typeof value === "string" ? value : value?.id ?? null; }
function date(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new MetaAdsError("addon_payment_not_confirmed", 409);
  return new Date(seconds * 1000).toISOString();
}
export class StripeAddonAdapter implements AddonBillingPort {
  private readonly stripe: Stripe | null;
  constructor(private readonly env: MetaAdsEnvironment, client?: Stripe) {
    const key = env.META_ADS_STRIPE_SECRET_KEY;
    if (key?.startsWith("sk_live_") && env.NODE_ENV !== "production") throw new MetaAdsError("addon_live_key_forbidden", 503);
    this.stripe = client ?? (key ? new Stripe(key, { apiVersion: "2026-04-22.dahlia", maxNetworkRetries: 0, timeout: 20000 }) : null);
  }
  private client(): Stripe { if (!this.stripe) throw new MetaAdsError("addon_billing_not_configured", 503); return this.stripe; }
  private monthly(price: Stripe.Price): number {
    if (price.currency !== "brl" || price.billing_scheme !== "per_unit" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed" || !Number.isSafeInteger(price.unit_amount) || price.unit_amount! <= 0 || price.custom_unit_amount) throw new MetaAdsError("addon_provider_price_mismatch", 503);
    return price.unit_amount!;
  }
  async quote() {
    if (!this.env.META_ADS_STRIPE_MONTHLY_PRICE_ID) throw new MetaAdsError("addon_billing_not_configured", 503);
    const price = await this.client().prices.retrieve(this.env.META_ADS_STRIPE_MONTHLY_PRICE_ID);
    if (!price.active) throw new MetaAdsError("addon_provider_price_mismatch", 503);
    return { amountCents: this.monthly(price), currency: "BRL", cadence: "monthly" };
  }
  private dashboard(): URL {
    try {
      const url = new URL(this.env.META_ADS_DASHBOARD_URL ?? "");
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error();
      return url;
    } catch { throw new MetaAdsError("addon_billing_return_url_invalid", 503); }
  }
  async createCheckout(input: BillingCheckoutRequest): Promise<MetaAdsCheckout> {
    requireIdentifier(input.merchantId); requireIdentifier(input.contractId);
    const monthly = input.kind === "subscription";
    if (monthly) {
      const quoted = await this.quote();
      if (quoted.amountCents !== input.offer.monthlyPriceCents || quoted.currency !== input.offer.currency || quoted.cadence !== input.offer.cadence) throw new MetaAdsError("addon_provider_price_mismatch", 503);
    }
    const amountCents = monthly ? input.offer.monthlyPriceCents : input.offer.extraImagePriceCents;
    const metadata = { zyon_module: moduleName, merchant_id: input.merchantId, contract_id: input.contractId, offer_version: input.offer.version, accepted_amount_cents: String(amountCents), kind: input.kind };
    const success = new URL(this.dashboard()); success.searchParams.set("tab", "meta-ads-agent"); success.searchParams.set("addon_checkout", "success");
    const cancel = new URL(success); cancel.searchParams.set("addon_checkout", "cancelled");
    const result = await this.client().checkout.sessions.create({ mode: monthly ? "subscription" : "payment", client_reference_id: input.merchantId,
      ...(input.profile.stripeCustomerId ? { customer: input.profile.stripeCustomerId } : { customer_email: input.profile.email }),
      metadata, ...(monthly ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
      line_items: monthly ? [{ price: this.env.META_ADS_STRIPE_MONTHLY_PRICE_ID!, quantity: 1 }] : [{ quantity: 1, price_data: { currency: "brl", unit_amount: amountCents, product_data: { name: `Zyon Anuncios com IA: ${input.offer.extraImageCredits} imagens` } } }],
      allow_promotion_codes: false, automatic_tax: { enabled: false }, success_url: success.href, cancel_url: cancel.href,
    }, { idempotencyKey: input.idempotencyKey });
    if (!result.url || new URL(result.url).hostname !== "checkout.stripe.com" || result.amount_total !== amountCents || result.currency !== "brl") throw new MetaAdsError("addon_provider_price_mismatch", 503);
    return { id: result.id, url: result.url, kind: input.kind, amountCents, currency: "BRL", offerVersion: input.offer.version };
  }
  async cancelRenewal(subscriptionId: string): Promise<void> {
    await this.client().subscriptions.update(subscriptionId, { cancel_at_period_end: true }, { idempotencyKey: `meta-ads-cancel:${subscriptionId}` });
  }
  private eventMetadata(metadata: Stripe.Metadata | null | undefined) {
    if (metadata?.zyon_module !== moduleName) return null;
    requireIdentifier(metadata.merchant_id); requireIdentifier(metadata.contract_id);
    if (!metadata.offer_version) throw new MetaAdsError("addon_contract_mismatch", 409);
    return { merchantId: metadata.merchant_id, contractId: metadata.contract_id };
  }
  async verifiedEvent(rawBody: Buffer, signature: string): Promise<ProviderBillingEvent | null> {
    if (!this.env.META_ADS_STRIPE_WEBHOOK_SECRET) throw new MetaAdsError("addon_billing_not_configured", 503);
    let event: Stripe.Event;
    try {
      if (!signature || rawBody.length > 1_000_000) throw new Error();
      event = this.client().webhooks.constructEvent(rawBody, signature, this.env.META_ADS_STRIPE_WEBHOOK_SECRET);
    } catch { throw new MetaAdsError("addon_webhook_signature_invalid", 400); }
    if (event.account) return null;
    const eventId = event.id; const occurredAt = date(event.created);
    const sourceId = () => {
      const value = (event.data.object as { id?: unknown }).id;
      if (typeof value !== "string" || !value) throw new MetaAdsError("addon_webhook_object_invalid", 400);
      return value;
    };
    if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) {
      const invoice = await this.client().invoices.retrieve(sourceId());
      if (invoice.status !== "paid") throw new MetaAdsError("addon_payment_not_confirmed", 409);
      const parent = invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const subscriptionId = remoteId(parent.parent?.subscription_details?.subscription ?? parent.subscription);
      if (!subscriptionId) return null;
      const subscription = await this.client().subscriptions.retrieve(subscriptionId);
      const metadata = this.eventMetadata(subscription.metadata); if (!metadata) return null;
      const item = subscription.items.data[0];
      if (subscription.items.data.length !== 1 || item.quantity !== 1 || this.monthly(item.price) !== Number(subscription.metadata.accepted_amount_cents) || remoteId(invoice.customer) !== remoteId(subscription.customer) || invoice.lines.data.length !== 1) throw new MetaAdsError("addon_payment_mismatch", 409);
      const period = invoice.lines.data[0].period;
      return { ...metadata, eventId, occurredAt, kind: "subscription_paid", checkoutId: null, subscriptionId, customerId: remoteId(subscription.customer), paymentId: invoice.id,
        amountCents: invoice.amount_paid, currency: invoice.currency.toUpperCase(), periodStart: date(period.start), periodEnd: date(period.end) };
    }
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const session = await this.client().checkout.sessions.retrieve(sourceId());
      const metadata = this.eventMetadata(session.metadata);
      if (!metadata || session.mode !== "payment" || session.metadata?.kind !== "extra_images") return null;
      const paymentId = remoteId(session.payment_intent);
      if (session.payment_status !== "paid" || !paymentId) throw new MetaAdsError("addon_payment_not_confirmed", 409);
      const payment = await this.client().paymentIntents.retrieve(paymentId);
      if (payment.status !== "succeeded" || payment.amount_received !== session.amount_total || payment.currency !== session.currency || payment.metadata.contract_id !== metadata.contractId || payment.metadata.merchant_id !== metadata.merchantId || payment.metadata.zyon_module !== moduleName) throw new MetaAdsError("addon_payment_mismatch", 409);
      return { ...metadata, eventId, occurredAt, kind: "extra_images_paid", checkoutId: session.id, subscriptionId: null, customerId: remoteId(session.customer), paymentId,
        amountCents: payment.amount_received, currency: payment.currency.toUpperCase(), periodStart: null, periodEnd: null };
    }
    if (event.type === "customer.subscription.deleted") {
      const subscription = await this.client().subscriptions.retrieve(event.data.object.id);
      const metadata = this.eventMetadata(subscription.metadata); if (!metadata) return null;
      if (subscription.status !== "canceled") throw new MetaAdsError("addon_payment_not_confirmed", 409);
      return { ...metadata, eventId, occurredAt, kind: "subscription_ended", checkoutId: null, subscriptionId: subscription.id, customerId: remoteId(subscription.customer), paymentId: eventId,
        amountCents: 0, currency: subscription.currency.toUpperCase(), periodStart: null, periodEnd: null };
    }
    return null;
  }
}
