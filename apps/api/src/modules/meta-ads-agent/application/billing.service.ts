import { randomUUID } from "node:crypto";
import type { MetaAdsCheckout, MetaAdsOffer, MetaAdsSubscription } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsRepository, type CommerceContextPort, type AddonBillingPort, type ProviderBillingEvent, type Clock, type IdFactory, type MetaAdsRecord } from "../domain/types.js";
import { isEligible, requireEntitlement, requireIdentifier } from "../domain/offer.js";
import { creditWallet } from "./credits.service.js";

interface CheckoutIntent { contractId: string; kind: "subscription" | "extra_images"; offer: MetaAdsOffer; }
interface CheckoutInput { kind: "subscription" | "extra_images"; idempotencyKey: string; offerVersion: string; }
function publicSubscription(value: MetaAdsSubscription | null): MetaAdsSubscription | null {
  if (!value) return null;
  return { id: value.id, offer: value.offer, status: value.status, provider: value.provider, currentPeriodStart: value.currentPeriodStart, currentPeriodEnd: value.currentPeriodEnd, cancelAtPeriodEnd: value.cancelAtPeriodEnd, acceptedAt: value.acceptedAt };
}

export class BillingService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan" | "getProfile">,
    private readonly gateway: AddonBillingPort, private readonly offer: () => MetaAdsOffer, private readonly clock: Clock = () => new Date(), private readonly id: IdFactory = randomUUID) {}

  async describe(merchantId: string) {
    const state = await this.repo.read(merchantId);
    return { eligible: isEligible(await this.commerce.getPlan(merchantId)), unit: "store" as const, mediaSpendIncluded: false,
      offer: this.offer(), subscription: publicSubscription(state.subscription), wallet: creditWallet(state, this.clock()) };
  }

  async requireAccess(merchantId: string) {
    return requireEntitlement(await this.commerce.getPlan(merchantId), await this.repo.read(merchantId), this.clock());
  }

  async checkout(merchantId: string, input: CheckoutInput): Promise<MetaAdsCheckout> {
    requireIdentifier(input.idempotencyKey);
    if (!["subscription", "extra_images"].includes(input.kind)) throw new MetaAdsError("addon_checkout_kind_invalid");
    const plan = await this.commerce.getPlan(merchantId);
    if (!isEligible(plan)) throw new MetaAdsError("addon_not_entitled", 403);
    const intentKey = `checkout-intent:${input.idempotencyKey}`; const readyKey = `checkout-ready:${input.idempotencyKey}`;
    const current = this.offer();
    const existing = await this.repo.getRecord<MetaAdsCheckout>(merchantId, readyKey);
    if (existing) {
      if (existing.payload.kind !== input.kind || existing.payload.offerVersion !== input.offerVersion) throw new MetaAdsError("addon_checkout_conflict", 409);
      return existing.payload;
    }
    if (!current.commercialReady) throw new MetaAdsError("addon_commercial_not_ready", 503);
    if (input.kind === "subscription") {
      if (current.version !== input.offerVersion) throw new MetaAdsError("addon_offer_changed", 409);
      const quoted = await this.gateway.quote();
      if (quoted.amountCents !== current.monthlyPriceCents || quoted.currency.toUpperCase() !== current.currency || quoted.cadence !== current.cadence) throw new MetaAdsError("addon_provider_price_mismatch", 503);
    }
    const profile = await this.commerce.getProfile(merchantId);
    const intent = await this.repo.mutate(merchantId, [intentKey, readyKey], (state, records) => {
      if (records.has(intentKey)) throw new MetaAdsError("addon_checkout_pending", 409);
      let accepted: MetaAdsOffer; let contractId: string;
      if (input.kind === "extra_images") {
        const subscription = requireEntitlement(plan, state, this.clock());
        accepted = subscription.offer; contractId = subscription.id;
        if (accepted.version !== input.offerVersion) throw new MetaAdsError("addon_offer_changed", 409);
      } else {
        if (state.subscription && (state.subscription.status === "checkout_pending" || new Date(state.subscription.currentPeriodEnd ?? 0).getTime() > this.clock().getTime())) throw new MetaAdsError("addon_subscription_exists", 409);
        accepted = structuredClone(current); contractId = this.id();
        state.subscription = { id: contractId, offer: accepted, provider: "stripe", status: "checkout_pending", acceptedAt: this.clock().toISOString(),
          currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, checkoutId: null, providerSubscriptionId: null, providerCustomerId: null };
      }
      const payload: CheckoutIntent = { contractId, kind: input.kind, offer: accepted };
      return { result: payload, records: [{ key: intentKey, kind: "checkout", payload, createdAt: this.clock().toISOString() }] };
    });
    // Provider idempotency is merchant scoped; an interrupted checkout is never charged again blindly.
    const result = await this.gateway.createCheckout({ merchantId, ...intent, profile, idempotencyKey: `meta-ads:${merchantId}:${input.idempotencyKey}` });
    const expectedAmount = intent.kind === "subscription" ? intent.offer.monthlyPriceCents : intent.offer.extraImagePriceCents;
    if (result.amountCents !== expectedAmount || result.currency !== intent.offer.currency || result.offerVersion !== intent.offer.version || result.kind !== intent.kind) throw new MetaAdsError("addon_provider_price_mismatch", 503);
    return this.repo.mutate(merchantId, [readyKey], (state, records) => {
      if (records.has(readyKey)) return { result: records.get(readyKey)!.payload as MetaAdsCheckout };
      if (state.subscription?.id !== intent.contractId) throw new MetaAdsError("addon_contract_mismatch", 409);
      if (intent.kind === "subscription") state.subscription.checkoutId = result.id;
      return { result, records: [
        { key: readyKey, kind: "checkout", payload: result, createdAt: this.clock().toISOString() },
        { key: `checkout-id:${result.id}`, kind: "checkout", payload: intent, createdAt: this.clock().toISOString() },
      ] };
    });
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = await this.gateway.verifiedEvent(rawBody, signature);
    if (event) await this.applyVerifiedEvent(event);
  }

  /** Only the signed provider adapter may supply this event in runtime composition. */
  async applyVerifiedEvent(event: ProviderBillingEvent): Promise<void> {
    const eventKey = `billing-event:${event.eventId}`; const paymentKey = `billing-payment:${event.paymentId}`;
    const periodKey = `billing-period:${event.contractId}:${event.periodStart}:${event.periodEnd}`;
    const extrasKey = `billing-extra:${event.checkoutId}`;
    await this.repo.mutate(event.merchantId, [eventKey, paymentKey, periodKey, extrasKey, `checkout-id:${event.checkoutId}`], (state, existing) => {
      if (existing.has(eventKey)) return { result: undefined };
      const subscription = state.subscription;
      if (!subscription || subscription.id !== event.contractId || (event.kind !== "extra_images_paid" && subscription.providerSubscriptionId && event.subscriptionId !== subscription.providerSubscriptionId)) throw new MetaAdsError("addon_contract_mismatch", 409);
      const records: MetaAdsRecord[] = [{ key: eventKey, kind: "billing_event", payload: { kind: event.kind, paymentId: event.paymentId, contractId: event.contractId }, createdAt: this.clock().toISOString() }];
      if (event.kind === "subscription_ended") {
        subscription.status = "ended"; subscription.cancelAtPeriodEnd = true;
        return { result: undefined, records };
      }
      if (!event.eventId || !event.paymentId || event.currency.toUpperCase() !== subscription.offer.currency) throw new MetaAdsError("addon_payment_mismatch", 409);
      if (existing.has(paymentKey)) return { result: undefined, records };
      if (event.kind === "extra_images_paid") {
        const checkout = existing.get(`checkout-id:${event.checkoutId}`)?.payload as CheckoutIntent | undefined;
        if (!checkout || checkout.kind !== "extra_images" || checkout.contractId !== subscription.id || event.amountCents !== checkout.offer.extraImagePriceCents) throw new MetaAdsError("addon_payment_mismatch", 409);
        if (!existing.has(extrasKey)) {
          state.credits.extraAvailable += checkout.offer.extraImageCredits;
          records.push({ key: extrasKey, kind: "billing_event", payload: { contractId: subscription.id, credits: checkout.offer.extraImageCredits }, createdAt: this.clock().toISOString() });
        }
      } else if (event.kind === "subscription_paid") {
        const start = new Date(event.periodStart ?? ""); const end = new Date(event.periodEnd ?? "");
        const days = (end.getTime() - start.getTime()) / 86400000;
        if (event.amountCents !== subscription.offer.monthlyPriceCents || !event.subscriptionId || !Number.isFinite(days) || days < 27 || days > 32) throw new MetaAdsError("addon_payment_mismatch", 409);
        if (!existing.has(periodKey) && start.getTime() >= new Date(subscription.currentPeriodStart ?? 0).getTime()) {
          subscription.providerSubscriptionId = event.subscriptionId; subscription.providerCustomerId = event.customerId;
          subscription.currentPeriodStart = start.toISOString(); subscription.currentPeriodEnd = end.toISOString();
          subscription.status = subscription.cancelAtPeriodEnd ? "cancel_at_period_end" : "active";
          state.credits.monthlyAvailable = subscription.offer.monthlyImageCredits;
          state.credits.periodKey = periodKey; state.credits.periodEndsAt = end.toISOString();
          records.push({ key: periodKey, kind: "billing_period", payload: { contractId: subscription.id, start: start.toISOString(), end: end.toISOString() }, createdAt: this.clock().toISOString() });
        }
      } else throw new MetaAdsError("addon_payment_kind_invalid", 400);
      records.push({ key: paymentKey, kind: "billing_event", payload: { contractId: subscription.id, kind: event.kind }, createdAt: this.clock().toISOString() });
      return { result: undefined, records };
    });
  }

  async cancel(merchantId: string): Promise<MetaAdsSubscription> {
    const snapshot = (await this.repo.read(merchantId)).subscription;
    if (!snapshot) throw new MetaAdsError("addon_contract_missing", 404);
    if (snapshot.cancelAtPeriodEnd || snapshot.status === "ended") return publicSubscription(snapshot)!;
    if (!snapshot.providerSubscriptionId) throw new MetaAdsError("addon_payment_pending", 409);
    await this.gateway.cancelRenewal(snapshot.providerSubscriptionId);
    return this.repo.mutate(merchantId, [], state => {
      if (state.subscription?.id !== snapshot.id) throw new MetaAdsError("addon_contract_mismatch", 409);
      state.subscription.cancelAtPeriodEnd = true;
      if (state.subscription.status !== "ended") state.subscription.status = "cancel_at_period_end";
      return { result: publicSubscription(state.subscription)! };
    });
  }

  async ensureEligibility(merchantId: string): Promise<void> {
    if (isEligible(await this.commerce.getPlan(merchantId))) return;
    const subscription = (await this.repo.read(merchantId)).subscription;
    if (subscription?.providerSubscriptionId && !subscription.cancelAtPeriodEnd) await this.cancel(merchantId);
  }

  async history(merchantId: string) {
    const state = await this.repo.read(merchantId);
    return { subscription: publicSubscription(state.subscription), campaigns: Object.values(state.campaigns), proposals: Object.values(state.proposals),
      executions: Object.values(state.executions), generations: Object.values(state.generations), media: Object.values(state.media), metrics: Object.values(state.metrics), recommendations: Object.values(state.recommendations) };
  }
}
