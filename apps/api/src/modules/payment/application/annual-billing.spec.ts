import { GetBillingSubscriptionUseCase } from "./payment-platform/billing/get-billing-subscription.use-case.js";
import assert from "node:assert/strict";
import test from "node:test";
import { billingOffer, BILLING_PLANS } from "@zyon/shared-types";
import { quoteBilling, annualBillingConfig } from "../infrastructure/billing-offers.js";
import { nextBillingPeriod } from "../domain/services/billing-period.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { HandleAsaasBillingWebhookUseCase } from "./payment-platform/billing/handle-asaas-billing-webhook.use-case.js";
import { ChangeSubscriptionPlanUseCase } from "./payment-platform/billing/change-subscription-plan.use-case.js";
import { StripePlatformAdapter } from "../infrastructure/stripe-platform.adapter.js";
import { AsaasBillingProvider } from "../infrastructure/asaas-billing.provider.js";
import { BillingEntityMapper } from "../../public-api/billing/application/mappers/billing-entity.mapper.js";

test("annual quote uses integer cents and only discounts the subscription", () => {
  assert.deepEqual(billingOffer(44900, "annual", 15), { cycle: "annual", amountCents: 457980, equivalentMonthlyCents: 38165, discountPercent: 15, savingsCents: 80820 });
  assert.deepEqual(billingOffer(74900, "annual", 15), { cycle: "annual", amountCents: 763980, equivalentMonthlyCents: 63665, discountPercent: 15, savingsCents: 134820 });
  assert.equal(billingOffer(44900, "monthly", 15).amountCents, 44900);
  assert.equal(BILLING_PLANS.growth.transactionFeeCents, 149);
  assert.equal(BILLING_PLANS.growth.features.customDomain, true);
  assert.equal("sessionsPerMonth" in BILLING_PLANS.growth.limits, false);
  assert.equal("aiConversationsPerMonth" in BILLING_PLANS.starter.limits, false);
});

test("billing usage exposes purchases and operational resources, never sessions or AI conversations", () => {
  const usage = BillingEntityMapper.toUsageResponse({
    periodStart: "2026-09-01T00:00:00.000Z",
    ordersPerMonth: 12,
    commerceConnections: 1,
    webhookEndpoints: 2,
    teamMembers: 3,
    crossSellPromotions: 4,
    activeCoupons: 5,
  }, BILLING_PLANS.growth.limits);

  assert.equal(usage.orders_per_month, 12);
  assert.equal(usage.commerce_connections, 1);
  assert.equal("sessions_per_month" in usage, false);
  assert.equal("ai_conversations_per_month" in usage, false);
  assert.equal("sessionsPerMonth" in usage.limits, false);
  assert.equal("aiConversationsPerMonth" in usage.limits, false);
});

test("annual is opt-in and invalid env never breaks monthly billing", () => {
  assert.equal(annualBillingConfig({}).enabled, false);
  for (const discount of ["NaN", "100", "-1", "15.5", ""]) {
    const env = { BILLING_ANNUAL_ENABLED: "true", BILLING_ANNUAL_DISCOUNT_PERCENT: discount };
    assert.equal(annualBillingConfig(env).enabled, false);
    assert.throws(() => quoteBilling("growth", "annual", env));
    assert.equal(quoteBilling("growth", "monthly", env).amountCents, 44900);
  }
  assert.equal(quoteBilling("growth", "annual", { BILLING_ANNUAL_ENABLED: "true" }).amountCents, 457980);
  assert.throws(() => quoteBilling("starter", "annual", { BILLING_ANNUAL_ENABLED: "true" }));
});

test("calendar periods handle leap years and month ends", () => {
  assert.equal(nextBillingPeriod(new Date("2028-02-29T12:00:00Z"), "annual").toISOString(), "2029-02-28T12:00:00.000Z");
  assert.equal(nextBillingPeriod(new Date("2026-01-31T12:00:00Z"), "monthly").toISOString(), "2026-02-28T12:00:00.000Z");
});

test("annual paid webhook requires exact charge and due date, is idempotent across event ids, and retains contract on renewal", async () => {
  const repo = new InMemoryPaymentPlatformRepository();
  await repo.saveBilling({ merchantId: "annual", provider: "asaas", asaasSubscriptionId: "sub_annual", status: "trialing", planKey: "starter",
    billingCycle: "annual", billingAmountCents: 457980, billingDiscountPercent: 15, pendingUpgradePlanKey: "growth", pendingUpgradeAmountCents: 457980 });
  const useCase = new HandleAsaasBillingWebhookUseCase(repo);
  const payment = { subscriptionId: "sub_annual", paymentId: "pay_1", paymentValueCents: 457980, paymentDueAt: "2026-10-01T00:00:00Z", occurredAt: "2026-10-01T12:00:00Z", event: "PAYMENT_CONFIRMED" };
  assert.equal((await useCase.execute({ ...payment, eventId: "underpaid", paymentValueCents: 44900 })).outcome, "ignored");
  assert.equal((await useCase.execute({ ...payment, eventId: "undated", paymentDueAt: undefined })).outcome, "ignored");
  assert.equal((await useCase.execute({ ...payment, eventId: "first" })).outcome, "processed");
  assert.equal((await repo.getBilling("annual"))?.currentPeriodEnd, "2027-10-01T00:00:00.000Z");
  assert.equal((await useCase.execute({ ...payment, eventId: "first" })).outcome, "duplicate");
  assert.equal((await useCase.execute({ ...payment, eventId: "received", event: "PAYMENT_RECEIVED", occurredAt: "2026-10-03T12:00:00Z" })).outcome, "ignored");
  assert.equal((await useCase.execute({ ...payment, eventId: "old_due", paymentId: "pay_old", paymentDueAt: "2026-09-01T00:00:00Z" })).outcome, "ignored");
  assert.equal((await useCase.execute({ ...payment, eventId: "old_overdue", event: "PAYMENT_OVERDUE" })).outcome, "ignored");
  // No env lookup at renewal: the saved amount and discount remain authoritative.
  assert.equal((await useCase.execute({ ...payment, eventId: "renewal", paymentId: "pay_2", paymentDueAt: "2027-10-01T00:00:00Z", occurredAt: "2027-10-01T12:00:00Z" })).outcome, "processed");
  const snapshot = await repo.getBilling("annual");
  assert.equal(snapshot?.currentPeriodEnd, "2028-10-01T00:00:00.000Z");
  assert.equal(snapshot?.billingDiscountPercent, 15);
  const response = BillingEntityMapper.toSubscriptionResponse(await new GetBillingSubscriptionUseCase(repo).execute("annual"));
  assert.equal(response.billing_cycle, "annual");
  assert.equal(response.billing_amount_cents, 457980);
  assert.equal(response.limits.ordersPerMonth, 500);
});

test("monthly to annual transition preserves access until its confirmed renewal", async () => {
  const previous = process.env.BILLING_ANNUAL_ENABLED;
  process.env.BILLING_ANNUAL_ENABLED = "true";
  try {
    const repo = new InMemoryPaymentPlatformRepository();
    await repo.saveBilling({ merchantId: "transition", provider: "asaas", asaasSubscriptionId: "sub_change", status: "active", planKey: "growth",
      billingCycle: "monthly", billingAmountCents: 44900, currentPeriodEnd: "2030-10-01T12:00:00.000Z" });
    const calls: any[] = [];
    const change = new ChangeSubscriptionPlanUseCase(repo, { async updateSubscription(input: unknown) { calls.push(input); } } as any);
    await change.execute({ merchantId: "transition", targetPlanKey: "scale", billingCycle: "annual" });
    const pending = await repo.getBilling("transition");
    assert.equal(pending?.planKey, "growth"); assert.equal(pending?.billingCycle, "monthly");
    assert.equal(pending?.pendingBillingAmountCents, 763980);
    assert.equal(calls[0].nextDueDate, "2030-10-01");
    await assert.rejects(() => change.execute({ merchantId: "transition", targetPlanKey: "scale", billingCycle: "annual" }));
    await new HandleAsaasBillingWebhookUseCase(repo).execute({ event: "PAYMENT_CONFIRMED", eventId: "change_paid", subscriptionId: "sub_change",
      paymentId: "new_charge", paymentValueCents: 763980, paymentDueAt: "2030-10-01T00:00:00Z", occurredAt: "2030-10-01T12:00:00Z" });
    const active = await repo.getBilling("transition");
    assert.equal(active?.planKey, "scale"); assert.equal(active?.billingCycle, "annual");
    assert.equal(active?.currentPeriodEnd, "2031-10-01T00:00:00.000Z");
    assert.equal(active?.pendingPlanKey, undefined);
  } finally { if (previous === undefined) delete process.env.BILLING_ANNUAL_ENABLED; else process.env.BILLING_ANNUAL_ENABLED = previous; }
});

test("Stripe validates price amount, currency and interval before opening checkout", async () => {
  const adapter = new StripePlatformAdapter("test-key");
  let opened = 0;
  const price = { active: true, currency: "brl", unit_amount: 457980, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } };
  Object.assign(adapter, { stripe: { prices: { retrieve: async () => price }, checkout: { sessions: { list: async () => ({ data: [] }), create: async (input: any) => {
    opened++; assert.equal(input.allow_promotion_codes, false); return { id: "cs_1", url: "https://checkout.example.test" };
  } } } } });
  const input = { merchantId: "m", customerId: "cus", priceId: "annual_price", offer: billingOffer(44900, "annual", 15), successUrl: "https://example.test/success", cancelUrl: "https://example.test/cancel" };
  await adapter.createSubscriptionCheckout(input); assert.equal(opened, 1);
  for (const [key, value] of [["unit_amount", 44900], ["currency", "usd"], ["active", false]] as const) {
    const saved = (price as any)[key]; (price as any)[key] = value;
    await assert.rejects(() => adapter.createSubscriptionCheckout(input)); (price as any)[key] = saved;
  }
  price.recurring.interval = "month";
  await assert.rejects(() => adapter.createSubscriptionCheckout(input)); assert.equal(opened, 1);
});

test("Asaas sends YEARLY with the full annual amount and refuses generated invoices during a change", async () => {
  const bodies: any[] = [];
  const provider = new AsaasBillingProvider("https://sandbox.example.test/v3", "test", (async (_url: string, init: RequestInit) => {
    if (init.method === "POST") { bodies.push(JSON.parse(String(init.body))); return Response.json({ id: "sub_1" }); }
    if (!init.method) return Response.json({ data: [{ id: "pending_1" }], totalCount: 1 });
    throw new Error("Should not mutate existing invoices");
  }) as any);
  await provider.createSubscription({ customerId: "cus", planKey: "growth", valueBrl: 4579.8, billingCycle: "annual", creditCardToken: "test_token" });
  assert.equal(bodies[0].cycle, "YEARLY"); assert.equal(bodies[0].value, 4579.8);
  await assert.rejects(() => provider.updateSubscription({ subscriptionId: "sub_1", valueBrl: 4579.8, billingCycle: "annual", nextDueDate: "2030-10-01" }));
});

test("Stripe schedules annual and monthly changes for renewal without proration", async () => {
  for (const cycle of ["annual", "monthly"] as const) {
    const offer = billingOffer(44900, cycle, 15);
    const adapter = new StripePlatformAdapter("test-key");
    const phaseStart = 1900000000, phaseEnd = 1902592000;
    const mutations: any[] = [];
    const subscription = { id: "sub_1", metadata: { merchant_id: "m" }, status: "active", cancel_at_period_end: false,
      items: { data: [{ quantity: 1, current_period_end: phaseEnd, price: { id: "old_price" } }] }, schedule: null };
    const schedule = { id: "sched_1", current_phase: { start_date: phaseStart, end_date: phaseEnd },
      phases: [{ start_date: phaseStart, discounts: [{ discount: "discount_1" }], default_tax_rates: [] }] };
    Object.assign(adapter, { stripe: {
      prices: { retrieve: async () => ({ active: true, currency: "brl", unit_amount: offer.amountCents, recurring: { interval: cycle === "annual" ? "year" : "month", interval_count: 1, usage_type: "licensed" } }) },
      subscriptions: { retrieve: async () => subscription },
      subscriptionSchedules: {
        create: async (input: any) => { assert.equal(input.metadata.zyon_billing_change, "true"); return schedule; },
        update: async (_id: string, input: any) => { mutations.push(input); return {}; },
      },
    } });
    const result = await adapter.scheduleBillingChange({ merchantId: "m", subscriptionId: "sub_1", priceId: "new_price", offer });
    assert.equal(result.effectiveAt, new Date(phaseEnd * 1000).toISOString());
    assert.equal(mutations[0].proration_behavior, "none");
    assert.equal(mutations[0].phases[0].end_date, phaseEnd);
    assert.equal(mutations[0].phases[0].items[0].price, "old_price");
    assert.deepEqual(mutations[0].phases[0].discounts, [{ discount: "discount_1" }]);
    assert.equal(mutations[0].phases[1].items[0].price, "new_price");
    assert.equal(mutations[0].phases[1].duration.interval, cycle === "annual" ? "year" : "month");
    subscription.metadata.merchant_id = "another";
    await assert.rejects(() => adapter.scheduleBillingChange({ merchantId: "m", subscriptionId: "sub_1", priceId: "new_price", offer }));
    assert.equal(mutations.length, 1);
  }
});

test("selecting annual expires an older monthly checkout owned by the same merchant", async () => {
  const adapter = new StripePlatformAdapter("test-key");
  const expired: string[] = [];
  Object.assign(adapter, { stripe: {
    prices: { retrieve: async () => ({ active: true, currency: "brl", unit_amount: 457980, recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } }) },
    checkout: { sessions: {
      list: async () => ({ data: [{ id: "cs_old", mode: "subscription", metadata: { merchant_id: "m", price_id: "monthly" } }, { id: "cs_foreign", mode: "subscription", metadata: { merchant_id: "other", price_id: "monthly" } }] }),
      expire: async (id: string) => { expired.push(id); },
      create: async () => ({ id: "cs_new", url: "https://checkout.example.test" }),
    } },
  } });
  await adapter.createSubscriptionCheckout({ merchantId: "m", customerId: "cus", priceId: "annual", offer: billingOffer(44900, "annual", 15), successUrl: "https://example.test", cancelUrl: "https://example.test" });
  assert.deepEqual(expired, ["cs_old"]);
});
