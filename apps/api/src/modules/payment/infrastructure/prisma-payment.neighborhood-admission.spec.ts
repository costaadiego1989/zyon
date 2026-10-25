import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";
import { toCheckoutShippingQuote } from "../../shipping/domain/services/checkout-shipping-quote.mapper.js";
import type { PlannedPaymentSettlement } from "../domain/ports/payment-settlement-ledger.port.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";

const merchantId = "merchant", sessionId = "session";
type Phase = "new" | "first-send" | "uncertain" | "provider-known" | "approved";
function fixture(phase: Phase = "new", chat = false) {
  const option = { carrier_key: "own_delivery_neighborhood_centro", label: "Entrega própria - Centro", price: 900, eta_days: 1, is_free: false };
  const config = { id: "config", merchantId, enabled: true, mode: "neighborhood", flatPriceCents: null, freeAboveCents: null,
    neighborhoods: [{ name: "Centro", priceCents: 900 }], radiusZones: null, estimatedValue: 1, estimatedUnit: "days" };
  const selected = chat ? toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key, priceInCents: 900,
    realCostInCents: 900, isFree: false, etaDays: 1, destinationZip: "01310100" })
    : { customerPrice: 9, realCost: 9, carrier: option.carrier_key, method: option.label, deliveryDays: 1, destinationZip: "01310100" };
  const row = { merchantId, sessionId, cart: { currency: "BRL", total: 100, currentDiscount: 5,
    items: [{ sku: "SKU", name: "Canonical", price: 100, quantity: 1 }] },
    customer: { address_verified: true, address: { zip: "01310100", street: "Synthetic", number: "1", complement: null,
      neighborhood: "Centro", city: "Santo André", state: "SP" } }, shipping: selected };
  const quote = { id: "quote", merchantId, sessionId, destinationZip: "01310100", results: [option], selectedCarrierKey: chat ? null : option.carrier_key };
  const state = { row, config: config as Record<string, unknown> | null,
    merchant: { id: merchantId, storeSettings: { company: { address: { zip: "01310000", city: "São Paulo", state: "SP" } } } },
    rule: { merchantId, originZip: "01310000" }, quote: quote as typeof quote | null,
    reads: [] as string[], locks: [] as string[], writes: 0, settlementWrites: 0, outboxWrites: 0,
    normalHistory: false, prior: null as Record<string, unknown> | null };
  const intent = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "key", amountCents: 10400, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId, sessionId, intentId: intent.id, amountCents: 10400, currency: "BRL", method: "pix" });
  if (phase !== "new") {
    intent.persisted(1);
    if (phase === "uncertain") { intent.claimCreation("first", new Date(0)); intent.markCreationUncertain("first", "synthetic_uncertain"); }
    if (phase === "provider-known" || phase === "approved") intent.markRequiresAction({ providerPaymentId: "synthetic-provider-id" });
    if (phase === "approved") intent.markApproved({ providerPaymentId: "synthetic-provider-id", approvedAmountCents: 10400 });
    state.prior = structuredClone(intent.snapshot()) as unknown as Record<string, unknown>;
    if (phase === "first-send") intent.claimCreation("first", new Date(0));
    if (phase === "uncertain") assert.equal(intent.claimCreation("recovery", new Date(100_000)), "recover");
  }
  const tx = {
    async $queryRaw(sql: TemplateStringsArray) { state.locks.push(sql.join("?")); return []; },
    checkoutSession: { async findUnique() { state.reads.push("session"); return state.row; } },
    ownDeliveryConfig: { async findUnique(args: unknown) { state.reads.push("config"); assert.deepEqual(args, { where: { merchantId } }); return state.config; } },
    merchant: { async findUnique(args: { where: { id: string } }) { state.reads.push("origin-merchant"); assert.equal(args.where.id, merchantId); return state.merchant; } },
    merchantRule: { async findUnique(args: { where: { merchantId: string } }) { state.reads.push("origin-rule"); assert.equal(args.where.merchantId, merchantId); return state.rule; } },
    shippingQuote: { async findFirst(args: { where: { merchantId: string; sessionId: string }; orderBy: { createdAt: string } }) {
      state.reads.push("quote"); assert.deepEqual(args.where, { merchantId, sessionId }); assert.deepEqual(args.orderBy, { createdAt: "desc" }); return state.quote;
    } },
    crossStoreLineItem: { async findFirst() { return null; } },
    strategyIncentiveAssignment: { async findUnique() { return null; } },
    paymentSettlement: { async findUnique() { return null; }, async create() { state.settlementWrites++; throw new Error("unexpected_settlement_write"); } },
    outboxMessage: {
      async findFirst(args: unknown) {
        state.reads.push("normal-history");
        assert.deepEqual(args, { where: {
          merchantId, eventType: "cross-sell.offer.accepted", producer: "cross-sell",
          payload: { path: ["ack", "sessionId"], equals: sessionId },
          AND: [{ payload: { path: ["protocol"], equals: "normal_checkout_cross_sell_v1" } }],
        }, select: { eventId: true } });
        return state.normalHistory ? { eventId: "canonical-normal-acceptance" } : null;
      },
      async upsert() { state.outboxWrites++; throw new Error("unexpected_outbox_write"); },
    },
    paymentIntent: { async findUnique() { return state.prior; }, async findFirst() { return null; }, async findMany() { return []; },
      async create() { state.writes++; return {}; }, async updateMany() { state.writes++; return { count: 1 }; } },
  };
  const client = { async $transaction<T>(work: (value: typeof tx) => Promise<T>) { return work(tx); } };
  return { state, intent, repo: new PrismaPaymentRepository(client as unknown as PrismaClient) };
}
const review = (error: unknown) => {
  assert.ok(error instanceof Error && "getResponse" in error);
  const response = (error as Error & { getResponse(): unknown }).getResponse();
  assert.ok(response !== null && typeof response === "object" && "code" in response);
  assert.ok(["origin_address_configuration_required", "neighborhood_quote_review_required", "neighborhood_destination_outside_origin_city"].includes(String(response.code)));
  return true;
};
for (const phase of ["new", "first-send"] as const) for (const chat of [false, true]) {
  test(`${phase} ${chat ? "chat" : "HTTP"} selected neighborhood in another city refuses before journal/lease`, async () => {
    const f = fixture(phase, chat), before = structuredClone(f.state.row);
    await assert.rejects(f.repo.saveIntent({ intent: f.intent }), review);
    assert.equal(f.state.writes, 0); assert.deepEqual(f.state.row, before);
    assert.equal(f.intent.snapshot().version, phase === "new" ? 0 : 1);
    const index = (pattern: RegExp) => f.state.locks.findIndex(sql => pattern.test(sql));
    assert.ok(index(/merchants.*FOR UPDATE/) < index(/merchant_rules.*FOR (?:SHARE|UPDATE)/));
    assert.ok(index(/merchant_rules.*FOR (?:SHARE|UPDATE)/) < index(/own_delivery_configs.*FOR SHARE/));
    assert.ok(index(/own_delivery_configs.*FOR SHARE/) < index(/checkout_sessions.*FOR UPDATE/));
  });
  test(`${phase} ${chat ? "chat" : "HTTP"} same normalized city preserves merchandise and discount`, async () => {
    const f = fixture(phase, chat); f.state.row.customer.address.city = "  SAO   PAULO  ";
    const before = structuredClone(f.state.row); await f.repo.saveIntent({ intent: f.intent });
    assert.equal(f.state.writes, 1); assert.deepEqual(f.state.row, before);
    assert.equal(f.state.reads.filter(read => read === "normal-history").length, 1);
  });
}
for (const mutation of ["state", "origin-zip", "origin-city", "foreign-config", "unverified-address", "destination-zip", "missing-quote", "foreign-quote", "quote-price"] as const) {
  test(`chat canonical source ${mutation} refuses without a payment write`, async () => {
    const f = fixture("new", true); f.state.row.customer.address.city = "São Paulo";
    if (mutation === "state") f.state.row.customer.address.state = "RJ";
    if (mutation === "origin-zip") f.state.rule.originZip = "99999999";
    if (mutation === "origin-city") f.state.merchant.storeSettings.company.address.city = "Campinas";
    if (mutation === "foreign-config") f.state.config!.merchantId = "other";
    if (mutation === "unverified-address") f.state.row.customer.address_verified = false;
    if (mutation === "destination-zip") f.state.row.customer.address.zip = "99999999";
    if (mutation === "missing-quote") f.state.quote = null;
    if (mutation === "foreign-quote") f.state.quote!.merchantId = "other";
    if (mutation === "quote-price") f.state.quote!.results[0]!.price = 800;
    await assert.rejects(f.repo.saveIntent({ intent: f.intent }), review); assert.equal(f.state.writes, 0);
  });
}
for (const carrier of ["own_delivery_flat", "own_delivery_radius", "correios_pac"]) test(`${carrier} unrelated delivery admission is unchanged`, async () => {
  const f = fixture(); f.state.row.shipping.carrier = carrier; f.state.row.shipping.method = "Existing delivery";
  const before = structuredClone(f.state.row);
  await f.repo.saveIntent({ intent: f.intent }); assert.equal(f.state.writes, 1);
  assert.deepEqual(f.state.row, before);
  assert.equal(f.state.reads.filter(read => read === "normal-history").length, 1);
  assert.ok(!f.state.reads.some(read => ["config", "origin-merchant", "origin-rule", "quote"].includes(read)));
});
for (const phase of ["uncertain", "provider-known", "approved"] as const) test(`${phase} existing journal remains reconcilable after origin changes`, async () => {
  const f = fixture(phase, true); f.state.config = null; f.state.quote = null;
  await f.repo.saveIntent({ intent: f.intent }); assert.equal(f.state.writes, 1);
  assert.equal(f.state.reads.includes("normal-history"), false);
  assert.ok(!f.state.reads.some(read => ["config", "origin-merchant", "origin-rule", "quote"].includes(read)));
});
for (const carrier of ["own_delivery_flat", "own_delivery_radius"]) test(`chat ${carrier} exact owned quote remains a non-neighborhood selection`, async () => {
  const f = fixture("new", true), option = f.state.quote!.results[0]!;
  option.carrier_key = carrier; option.label = "Entrega própria";
  f.state.row.shipping = toCheckoutShippingQuote({ label: option.label, carrierKey: carrier, priceInCents: option.price,
    realCostInCents: option.price, isFree: false, etaDays: option.eta_days, destinationZip: "01310100" });
  const before = structuredClone(f.state.row);
  await f.repo.saveIntent({ intent: f.intent }); assert.equal(f.state.writes, 1);
  assert.deepEqual(f.state.row, before);
  assert.equal(f.state.reads.filter(read => read === "normal-history").length, 1);
});
for (const phase of ["new", "first-send"] as const) for (const mode of ["settlement", "outbox"] as const) {
  test(`${phase} ${mode} outside-city refusal precedes all transactional side effects`, async () => {
    const f = fixture(phase, true);
    const plan: PlannedPaymentSettlement = { merchantId, paymentIntentId: f.intent.id, provider: "synthetic", currency: "BRL",
      plannedGrossCents: 10400, plannedPlatformFeeCents: 0, plannedMerchantNetCents: 10400, plannedProviderFeeCents: 0,
      occurredAt: new Date(0), entries: [{ entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit",
        recipientType: "merchant", plannedAmountCents: 10400 }] };
    const event: DomainEventEnvelope = { event_id: "event", event_type: "payment.status.changed", schema_version: 1,
      merchant_id: merchantId, occurred_at: new Date(0).toISOString(), correlation_id: "correlation", causation_id: "causation", producer: "checkout", payload: {} };
    await assert.rejects(mode === "settlement" ? f.repo.saveIntentWithSettlementPlan({ intent: f.intent, settlementPlan: plan })
      : f.repo.saveIntentWithOutbox({ intent: f.intent }, event), review);
    assert.equal(f.state.writes, 0); assert.equal(f.state.settlementWrites, 0); assert.equal(f.state.outboxWrites, 0);
  });
}
test("unknown analytic shipping cost cannot block an otherwise canonical neighborhood payment", async () => {
  const f = fixture(); f.state.row.customer.address.city = "São Paulo";
  Reflect.set(f.state.row.shipping, "realCost", null);
  const before = structuredClone(f.state.row); await f.repo.saveIntent({ intent: f.intent });
  assert.equal(f.state.writes, 1); assert.deepEqual(f.state.row, before);
  assert.equal(f.state.reads.filter(read => read === "normal-history").length, 1);
});

for (const phase of ["new", "first-send"] as const) test(`${phase} canonical neighborhood with normal history still requires its financial issuer`, async () => {
  const f = fixture(phase); f.state.row.customer.address.city = "Sao Paulo"; f.state.normalHistory = true;
  const before = structuredClone(f.state.row);
  await assert.rejects(f.repo.saveIntent({ intent: f.intent }), /payment_normal_cross_sell_authority_conflict/);
  assert.equal(f.state.reads.filter(read => read === "normal-history").length, 1);
  assert.equal(f.state.writes, 0); assert.deepEqual(f.state.row, before);
  assert.equal(f.intent.snapshot().version, phase === "new" ? 0 : 1);
});
