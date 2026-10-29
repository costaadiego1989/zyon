import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { providerShippingEnvelopeSchema, type ProviderShippingResult } from "../../domain/contracts/widget-checkout-provider-shipping.schemas.js";
import { widgetCrossSellCheckoutReceiptSchema } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import { widgetCheckoutRevisionContextHash, widgetCheckoutRevisionMetadata } from "./widget-cross-sell-checkout-revision.js";
import { widgetCheckoutShippingHash } from "./widget-checkout-manual-shipping.js";
import { providerShippingFixture, scope, request, at, address } from "./widget-provider-shipping.fixture.js";

async function ready() {
  const f = providerShippingFixture();
  f.mutate(state => { state.session.customer = { fullName: "Synthetic Buyer", email: "buyer@example.test", cpf: "12345678901",
    phone: "11987654321", address, address_verified: true }; });
  await f.adapter.accept(scope, { expectedQuote: await f.adapter.quote(scope, request) }); f.calls.length = 0;
  return f;
}
const resultFor = (pending: { requestId: string; expiresAt: string }): ProviderShippingResult => ({
  requestId: pending.requestId, expiresAt: pending.expiresAt, mode: "radius",
  options: [{ carrier_key: "own_delivery_radius", label: "Entrega própria", price: 900, eta_days: 1 }],
  evidence: { kind: "cep_haversine", originZip: "01001000", destinationZip: address.zip, distanceKm: 5 },
});
const assertNoWrites = (calls: string[]) => assert.equal(calls.some(call => ["cart-write", "event-write", "outbox-write"].includes(call)), false);

test("RADIUS begin refuses a false actual post-write version before returning dispatch",async()=>{
  const f=await ready(),before=f.state();f.faults.postWriteVersion=true;
  await assert.rejects(f.repository.begin(scope,{expectedVersion:5}));assert.deepEqual(f.state(),before);
});

test("RADIUS begin reads actual canonical accepted transaction sources then commits pending/revision/event before dispatch", async () => {
  const f = await ready(), begun = await f.repository.begin(scope, { expectedVersion: 5 });
  assert.equal(begun.pending.state, "pending"); assert.equal(begun.pending.persistenceVersion, 6);
  assert.equal(begun.pending.sources.buyerId, "buyer"); assert.equal(begun.dispatch.mode, "radius");
  assert.equal(begun.dispatch.originZip, "01001000"); assert.equal(begun.dispatch.destinationZip, address.zip);
  assert.equal(begun.dispatch.requestId, begun.pending.requestId); assert.equal(begun.dispatch.metadataHash, begun.pending.sources.metadataHash);
  const state = f.state(), stored = providerShippingEnvelopeSchema.parse(state.session.shippingOptions);
  assert.deepEqual(stored, begun.pending); assert.equal(state.session.shipping, null); assert.equal(state.session.version, 6);
  const receipt = widgetCrossSellCheckoutReceiptSchema.parse(state.session.cart._widgetCrossSellAcceptance);
  assert.equal(receipt.revision?.operation, "provider_shipping_begin"); assert.equal(receipt.revision?.contextHash, widgetCheckoutRevisionContextHash(state.session));
  assert.equal(receipt.revision?.providerRequestId, begun.pending.requestId);
  assert.equal((state.events.at(-1) as { metadata: Record<string, unknown> }).metadata.provider_request_id, begun.pending.requestId);
  assert.equal((state.events.at(-1) as { eventName: string }).eventName, "cross_sell_checkout_provider_shipping_begun");
  assert.equal(JSON.stringify(begun).includes("realCost"), false); assert.equal(JSON.stringify(begun).includes("minimumMargin"), false);
  const configLock = f.calls.findIndex(call => call.includes("FROM own_delivery_configs")), sessionLock = f.calls.findIndex(call => call.includes("FROM checkout_sessions"));
  assert.ok(configLock >= 0 && configLock < sessionLock); assert.ok(f.calls.indexOf("manual-config-read") < f.calls.indexOf("cart-write"));
});

test("complete revalidates fresh same-TX sources and raw tariff, never config free threshold or shipping selection", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  f.clock.value = new Date(at.getTime() + 1000); f.calls.length = 0;
  const completed = await f.repository.complete(scope, pending.requestId, resultFor(pending));
  assert.equal(completed.state, "completed"); assert.equal(completed.persistenceVersion, 7);
  assert.equal(f.state().session.version, 7); assert.equal(f.state().session.shipping, null);
  if (completed.state === "completed") assert.equal(completed.result.options[0]!.price, 900);
  assert.equal(f.manual.value?.freeAboveCents, 10000); assert.ok(f.calls.includes("catalog-read"));
  assert.equal((f.state().events.at(-1) as { eventName: string }).eventName, "cross_sell_checkout_provider_shipping_completed");
});

test("unknown commits exact pending generation even after expiry, blocks automatic restart and late completion", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  f.clock.value = new Date(Date.parse(pending.expiresAt) + 1000);
  const unknown = await f.repository.markUnknown(scope, pending.requestId); assert.equal(unknown.state, "unknown");
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 7 }));
  await assert.rejects(f.repository.complete(scope, pending.requestId, resultFor(pending)));
  await assert.rejects(f.repository.markUnknown(scope, pending.requestId));
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("standing pending cannot be overwritten or redispatched, including expired pending", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  f.clock.value = new Date(Date.parse(pending.expiresAt) + 1000); const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 6 })); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const [name, change] of [
  ["price", (f: Awaited<ReturnType<typeof ready>>) => { f.rows[1]!.price.basePriceInCents++; }],
  ["package dimension", (f: Awaited<ReturnType<typeof ready>>) => { f.rows[1]!.weightGrams = 500; }],
  ["origin", (f: Awaited<ReturnType<typeof ready>>) => { f.origin.value.originZip = "02002000"; }],
  ["config tariff", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.radiusZones![0]!.priceCents++; }],
  ["config generation", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.updatedAt = new Date(at.getTime() + 1); }],
  ["payment", (f: Awaited<ReturnType<typeof ready>>) => { f.faults.payment = true; }],
] as const) test("current source drift refuses complete/unknown without deleting pending: " + name, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }); change(f);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.complete(scope, pending.requestId, resultFor(pending)));
  await assert.rejects(f.repository.markUnknown(scope, pending.requestId)); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const [name, change] of [
  ["missing origin", (f: Awaited<ReturnType<typeof ready>>) => { f.origin.value.originZip = null; }],
  ["foreign origin", (f: Awaited<ReturnType<typeof ready>>) => { f.origin.value.merchantId = "foreign"; }],
  ["missing config", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value = null; }],
  ["disabled config", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.enabled = false; }],
  ["wrong config tenant", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.merchantId = "foreign"; }],
  ["non-radius config", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.mode = "flat"; f.manual.value!.flatPriceCents = 900; }],
  ["invalid config generation", (f: Awaited<ReturnType<typeof ready>>) => { f.manual.value!.updatedAt = new Date(NaN); }],
] as const) test("begin refuses missing canonical source, with no fallback: " + name, async () => {
  const f = await ready(); change(f); const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 5 })); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const property of ["price", "eta_days", "carrier_key", "label"] as const) test("complete cannot persist a provider tariff inconsistent with current radius config: " + property, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }), result = resultFor(pending);
  const option = result.options[0]!; if (property === "price" || property === "eta_days") option[property] = 0; else option[property] = "forged";
  const before = f.state(); f.calls.length = 0; await assert.rejects(f.repository.complete(scope, pending.requestId, result));
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("expiry exact boundary refuses complete while valid unknown remains recorded", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }); f.clock.value = new Date(pending.expiresAt);
  const before = f.state(); await assert.rejects(f.repository.complete(scope, pending.requestId, resultFor(pending))); assert.deepEqual(f.state(), before);
});

test("request UUID and provider mode are exact; carrier refuses without any account lookup", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }), before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.complete(scope, "b5537938-7496-4ea4-94b4-ec872a418337", resultFor(pending)));
  await assert.rejects(f.repository.complete(scope, pending.requestId, { ...resultFor(pending), mode: "carrier", evidence: {
    kind: "merchant_carrier_account", provider: "melhor-envio", accountFingerprint: "a".repeat(64), metadataHash: "b".repeat(64), environment: "test" } }));
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const stage of ["checkoutCas", "event", "commitUnknown"] as const) test("begin failure never manufactures dispatch success: " + stage, async () => {
  const f = await ready(), before = f.state(); f.faults[stage] = true;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 5 }));
  if (stage === "commitUnknown") assert.equal(providerShippingEnvelopeSchema.parse(f.state().session.shippingOptions).state, "pending");
  else assert.deepEqual(f.state(), before);
});

test("two serialized begin callers cannot create two generations at the same version", async () => {
  const f = await ready(); const results = await Promise.allSettled([f.repository.begin(scope, { expectedVersion: 5 }), f.repository.begin(scope, { expectedVersion: 5 })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state().session.version, 6); assert.equal(f.state().events.length, 2);
});

for (const unknownFirst of [true, false]) test("complete/unknown generation race preserves exactly one terminal transition: " + unknownFirst, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  const unknown = () => f.repository.markUnknown(scope, pending.requestId), complete = () => f.repository.complete(scope, pending.requestId, resultFor(pending));
  const results = await Promise.allSettled(unknownFirst ? [unknown(), complete()] : [complete(), unknown()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(f.state().session.version, 7); assert.equal(f.state().events.length, 3);
});

test("strict input detaches before first await; body hashes/prices/buyer grants never enter transactions", async () => {
  const f = await ready(); f.calls.length = 0;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 5, price: 0 } as { expectedVersion: number }));
  assert.equal(f.calls.length, 0);
  const command = { expectedVersion: 5 }, pending = f.repository.begin(scope, command); command.expectedVersion = 0;
  assert.equal((await pending).pending.persistenceVersion, 6);
});

test("completed generation permits only a new explicit begin; old completion cannot attach to new pending", async () => {
  const f = await ready(), first = await f.repository.begin(scope, { expectedVersion: 5 });
  await f.repository.complete(scope, first.pending.requestId, resultFor(first.pending));
  const second = await f.repository.begin(scope, { expectedVersion: 7 }); assert.notEqual(second.pending.requestId, first.pending.requestId);
  const before = f.state(); await assert.rejects(f.repository.complete(scope, first.pending.requestId, resultFor(first.pending))); assert.deepEqual(f.state(), before);
});

test("unknown cost and margin do not become authority in canonical RADIUS persistence", async () => {
  const f = await ready(); Reflect.set(f.rows[1]!.price, "costInCents", NaN);
  Reflect.set(f.origin.value, "minimumMarginPercent", new Prisma.Decimal(NaN));
  assert.equal((await f.repository.begin(scope, { expectedVersion: 5 })).pending.state, "pending");
});

for (const field of ["basisHash", "configHash", "metadataHash"] as const) test("matching stored JSON/revision cannot authorize forged canonical source " + field, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  f.mutate(state => {
    const envelope = providerShippingEnvelopeSchema.parse(state.session.shippingOptions); envelope.sources[field] = "a".repeat(64);
    state.session.shippingOptions = envelope;
    const receipt = widgetCrossSellCheckoutReceiptSchema.parse(state.session.cart._widgetCrossSellAcceptance);
    receipt.revision!.contextHash = widgetCheckoutRevisionContextHash(state.session);
    receipt.revision!.providerSnapshotHash = widgetCheckoutShippingHash(envelope);
    state.session.cart._widgetCrossSellAcceptance = receipt;
    const event = state.events.find(row => (row as { id: string }).id === receipt.revision!.eventId) as { metadata: unknown };
    event.metadata = widgetCheckoutRevisionMetadata(receipt);
  });
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.complete(scope, pending.requestId, resultFor(pending)));
  await assert.rejects(f.repository.markUnknown(scope, pending.requestId)); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const terminal of ["complete", "unknown"] as const) for (const stage of ["checkoutCas", "event", "commitUnknown"] as const)
test("terminal transition preserves atomicity and never hides uncertain acknowledgement: " + terminal + "/" + stage, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }), before = f.state();
  f.faults[stage] = true;
  await assert.rejects(terminal === "complete" ? f.repository.complete(scope, pending.requestId, resultFor(pending)) : f.repository.markUnknown(scope, pending.requestId));
  if (stage === "commitUnknown") {
    const committed = providerShippingEnvelopeSchema.parse(f.state().session.shippingOptions);
    assert.equal(committed.state, terminal === "complete" ? "completed" : "unknown"); assert.equal(f.state().session.version, 7);
    f.faults[stage] = false; const stored = f.state();
    await assert.rejects(terminal === "complete" ? f.repository.complete(scope, pending.requestId, resultFor(pending)) : f.repository.markUnknown(scope, pending.requestId));
    assert.deepEqual(f.state(), stored);
  } else assert.deepEqual(f.state(), before);
});

test("provider result detaches before transaction awaits rather than storing caller-mutated tariff", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 }), result = resultFor(pending);
  const completion = f.repository.complete(scope, pending.requestId, result); result.options[0]!.price = 0;
  const completed = await completion; assert.equal(completed.state, "completed");
  if (completed.state === "completed") assert.equal(completed.result.options[0]!.price, 900);
});

for (const terminal of ["pending", "unknown"] as const) for (const command of ["customer", "address", "verify_otp", "request_otp", "claim_otp", "manual_quote", "manual_select"] as const)
test("existing command preserves outstanding provider generation without mutation: " + terminal + "/" + command, async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  if (terminal === "unknown") await f.repository.markUnknown(scope, pending.requestId);
  const version = terminal === "pending" ? 6 : 7, before = f.state(); f.calls.length = 0;
  const calls = {
    customer: () => f.adapter.updateCustomer(scope, { expectedVersion: version, customer: { fullName: "Synthetic Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" } }),
    address: () => f.adapter.updateAddress(scope, { expectedVersion: version, address }),
    verify_otp: () => f.adapter.verifyEmailOtp(scope, { expectedVersion: version, code: "123456" }),
    request_otp: () => f.adapter.requestEmailOtp(scope, { expectedVersion: version, action: "issue" }),
    claim_otp: () => f.adapter.claimEmailOtpDelivery(scope, { expectedVersion: version, deliveryId: "a5537938-7496-4ea4-94b4-ec872a418337" }),
    manual_quote: () => f.adapter.quoteManualShipping(scope, { expectedVersion: version }),
    manual_select: () => f.adapter.selectManualShipping(scope, { expectedVersion: version, quoteId: "a5537938-7496-4ea4-94b4-ec872a418337", carrierKey: "own_delivery_radius" }),
  };
  await assert.rejects(calls[command](), /cross_sell_quote_review_required/);
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
  assert.equal((await f.adapter.readAccepted(scope)).total, 118); assert.deepEqual(f.state(), before);
});

test("provider revision request ID is mandatory only for the three provider operations, without PII in event metadata", async () => {
  const f = await ready(), { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  await f.repository.complete(scope, pending.requestId, resultFor(pending));
  const first = f.state(), completedReceipt = widgetCrossSellCheckoutReceiptSchema.parse(first.session.cart._widgetCrossSellAcceptance);
  assert.equal(completedReceipt.revision?.providerRequestId, pending.requestId);
  const missing = structuredClone(completedReceipt); Reflect.deleteProperty(missing.revision!, "providerRequestId");
  assert.equal(widgetCrossSellCheckoutReceiptSchema.safeParse(missing).success, false);
  const missingHash = structuredClone(completedReceipt); Reflect.deleteProperty(missingHash.revision!, "providerSnapshotHash");
  assert.equal(widgetCrossSellCheckoutReceiptSchema.safeParse(missingHash).success, false);
  const wrong = { ...completedReceipt, revision: { ...completedReceipt.revision!, operation: "address" } };
  assert.equal(widgetCrossSellCheckoutReceiptSchema.safeParse(wrong).success, false);
  const again = await f.repository.begin(scope, { expectedVersion: 7 });
  const events = f.state().events.slice(1) as Array<{ metadata: Record<string, unknown> }>;
  assert.deepEqual(events.map(event => event.metadata.provider_request_id), [pending.requestId, pending.requestId, again.pending.requestId]);
  for (const event of events) for (const key of Object.keys(event.metadata)) assert.equal(["zip", "address", "customer", "config"].includes(key), false);
});

test("completed generation survives permitted customer edit and a new explicit begin proves its historical completion", async () => {
  const f = await ready(), first = await f.repository.begin(scope, { expectedVersion: 5 });
  await f.repository.complete(scope, first.pending.requestId, resultFor(first.pending));
  await f.adapter.updateCustomer(scope, { expectedVersion: 7, customer: { fullName: "Updated Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" } });
  assert.equal(providerShippingEnvelopeSchema.parse(f.state().session.shippingOptions).state, "completed");
  const next = await f.repository.begin(scope, { expectedVersion: 8 });
  assert.equal(next.pending.persistenceVersion, 9); assert.notEqual(next.pending.requestId, first.pending.requestId);
  assert.ok(f.calls.includes("history-event-read"));
  assert.ok(f.calls.some(call => call.includes("provider_request_id") && call.includes("FOR SHARE")));
});

async function selectionReady(waiver = false) {
  const f = await ready(); if (!waiver) f.manual.value!.freeAboveCents = null;
  const { pending } = await f.repository.begin(scope, { expectedVersion: 5 });
  await f.repository.complete(scope, pending.requestId, resultFor(pending));
  f.calls.length = 0;
  return { ...f, pending, selection: { expectedVersion: 7, quoteId: pending.requestId, carrierKey: "own_delivery_radius" } };
}

test("existing manual-selection command canonically selects completed paid RADIUS and same-TX payment reader rebuilds it", async () => {
  const f = await selectionReady();
  const acknowledgement = await f.adapter.selectManualShipping(scope, f.selection); assert.equal(acknowledgement.persistenceVersion, 8);
  const selected = await f.adapter.readAcceptedShipping(scope);
  assert.deepEqual(selected, { customerPrice: 9, carrier: "own_delivery_radius", method: "Entrega própria", deliveryDays: 1,
    destinationZip: address.zip, region: "SP" });
  const current = await f.readPaymentCheckout(); assert.deepEqual(current.selectedShipping, selected); assert.equal(current.projectedCart.total, 118);
  assert.equal(current.stored.version, 8); assert.equal(current.receipt.revision?.operation, "manual_shipping_select");
  assert.equal(current.receipt.revision?.providerRequestId, undefined);
  assert.deepEqual((f.state().session.shipping as { _widgetManualSelection: unknown })._widgetManualSelection,
    { quoteId: f.pending.requestId, carrierKey: "own_delivery_radius" });
});

test("RADIUS configured waiver is selected only through actual free/stacking/subsidy policy, not raw tariff or cost", async () => {
  const f = await selectionReady(true); Object.assign(f.shippingRules, { allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 9 });
  await f.adapter.selectManualShipping(scope, f.selection); assert.equal((await f.adapter.readAcceptedShipping(scope))?.customerPrice, 0);
  const current = await f.readPaymentCheckout(); assert.equal(current.selectedShipping?.customerPrice, 0);
  const stored = providerShippingEnvelopeSchema.parse(f.state().session.shippingOptions); if (stored.state !== "completed") throw Error("fixture_completed");
  assert.equal(stored.result.options[0]!.price, 900); assert.equal(JSON.stringify(f.state().session.shipping).includes("realCost"), false);
});

for (const [name, policy] of [
  ["free disabled", { allowFreeShipping: false, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 9 }],
  ["stack disabled", { allowFreeShipping: true, allowStackDiscountAndFreeShipping: false, maxShippingSubsidy: 9 }],
  ["subsidy below tariff", { allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 8.99 }],
  ["minimum", { allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 9, freeShippingMinCartValue: 119 }],
  ["region", { allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, maxShippingSubsidy: 9, blockedRegions: ["SP"] }],
] as const) test("RADIUS quote cannot grant a waiver that current merchant policy refuses: " + name, async () => {
  const f = await selectionReady(true); Object.assign(f.shippingRules, policy); const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.selectManualShipping(scope, f.selection)); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const [name, change] of [
  ["config", (f: Awaited<ReturnType<typeof selectionReady>>) => { f.manual.value!.freeAboveCents = 10000; }],
  ["origin", (f: Awaited<ReturnType<typeof selectionReady>>) => { f.origin.value.originZip = "02002000"; }],
  ["package", (f: Awaited<ReturnType<typeof selectionReady>>) => { f.rows[1]!.lengthCm = 10; }],
  ["price", (f: Awaited<ReturnType<typeof selectionReady>>) => { f.rows[1]!.price.basePriceInCents++; }],
  ["company ceiling", (f: Awaited<ReturnType<typeof selectionReady>>) => { f.ceiling.value = 1; }],
] as const) test("RADIUS selection rereads current canonical source before choosing tariff: " + name, async () => {
  const f = await selectionReady(); change(f); const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.selectManualShipping(scope, f.selection)); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("selected RADIUS remains valid across a proved later contact-only revision, never through stale expectedVersion", async () => {
  const f = await selectionReady(); await f.adapter.selectManualShipping(scope, f.selection);
  await f.adapter.updateCustomer(scope, { expectedVersion: 8, customer: { fullName: "Updated Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" } });
  assert.equal((await f.adapter.readAcceptedShipping(scope))?.customerPrice, 9); assert.equal((await f.readPaymentCheckout()).stored.version, 9);
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.selectManualShipping(scope, f.selection)); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("RADIUS selection honors shorter result expiry at fresh DB clock, not only pending envelope TTL", async () => {
  const f = await ready(); f.manual.value!.freeAboveCents = null;
  const { pending } = await f.repository.begin(scope, { expectedVersion: 5 }), result = resultFor(pending);
  result.expiresAt = new Date(at.getTime() + 1000).toISOString(); await f.repository.complete(scope, pending.requestId, result);
  f.clock.value = new Date(at.getTime() + 1000); const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.selectManualShipping(scope, { expectedVersion: 7, quoteId: pending.requestId, carrierKey: "own_delivery_radius" }));
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("RADIUS selection requires exact request and carrier option identifiers", async () => {
  const f = await selectionReady(), before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.selectManualShipping(scope, { ...f.selection, quoteId: "a5537938-7496-4ea4-94b4-ec872a418337" }));
  await assert.rejects(f.adapter.selectManualShipping(scope, { ...f.selection, carrierKey: "forged" }));
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

test("selected RADIUS is reconstructed against fresh current config in reads/payment without repairing old shipping", async () => {
  const f = await selectionReady(); await f.adapter.selectManualShipping(scope, f.selection); f.manual.value!.radiusZones![0]!.priceCents++;
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.adapter.readAcceptedShipping(scope)); await assert.rejects(f.readPaymentCheckout());
  assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});

for (const tamper of ["missing", "ambiguous", "hash", "version", "timestamp", "scope", "request", "envelope"] as const)
test("new begin refuses corrupted historical completion rather than trusting matching stored snapshot: " + tamper, async () => {
  const f = await ready(), first = await f.repository.begin(scope, { expectedVersion: 5 });
  await f.repository.complete(scope, first.pending.requestId, resultFor(first.pending));
  await f.adapter.updateCustomer(scope, { expectedVersion: 7, customer: { fullName: "Updated Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" } });
  f.mutate(state => {
    const event = state.events.find(raw => (raw as { eventName: string }).eventName === "cross_sell_checkout_provider_shipping_completed") as {
      id: string; sessionId: string; occurredAt: Date; metadata: Record<string, unknown>;
    };
    if (tamper === "missing") state.events = state.events.filter(raw => raw !== event);
    if (tamper === "ambiguous") state.events.push({ ...structuredClone(event), id: "ambiguous" });
    if (tamper === "hash") event.metadata.provider_snapshot_hash = "f".repeat(64);
    if (tamper === "version") event.metadata.checkout_version = 100;
    if (tamper === "timestamp") event.occurredAt = new Date(1);
    if (tamper === "scope") event.sessionId = "foreign";
    if (tamper === "request") event.metadata.provider_request_id = "a5537938-7496-4ea4-94b4-ec872a418337";
    if (tamper === "envelope") {
      const envelope = providerShippingEnvelopeSchema.parse(state.session.shippingOptions); if (envelope.state !== "completed") throw Error("fixture_state");
      envelope.result.options[0]!.price = 0; state.session.shippingOptions = envelope;
      const receipt = widgetCrossSellCheckoutReceiptSchema.parse(state.session.cart._widgetCrossSellAcceptance);
      receipt.revision!.contextHash = widgetCheckoutRevisionContextHash(state.session); state.session.cart._widgetCrossSellAcceptance = receipt;
      const latest = state.events.find(raw => (raw as { id: string }).id === receipt.revision!.eventId) as { metadata: unknown };
      latest.metadata = widgetCheckoutRevisionMetadata(receipt);
    }
  });
  const before = f.state(); f.calls.length = 0;
  await assert.rejects(f.repository.begin(scope, { expectedVersion: 8 })); assert.deepEqual(f.state(), before); assertNoWrites(f.calls);
});
