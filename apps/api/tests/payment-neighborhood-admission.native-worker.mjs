import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { assertNativePrismaUrl, inspectNativePrismaClient } from "./native-prisma-admission-guards.mjs";

const [url, runId] = process.argv.slice(2);
assert.equal(process.argv.slice(2).length, 2);
const parsed = assertNativePrismaUrl(url);
assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_neighborhood_payment_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const scope = { merchantId: "synthetic-neighborhood-merchant", sessionId: "synthetic-normal-checkout" };
const address = { zip: "01310100", city: "Sao Paulo", state: "SP", neighborhood: "Centro", street: "Synthetic", number: "1", complement: null };
const origin = { merchantId: scope.merchantId, zip: "01310000", city: "São Paulo", state: "SP" };
let passed = 0, waiters = 0, active = "marker";
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const review = error => {
  assert.equal(error?.getStatus?.(), 409);
  assert.ok(["origin_address_configuration_required", "neighborhood_quote_review_required", "neighborhood_destination_outside_origin_city"].includes(error.getResponse()?.code));
  return true;
};
const event = id => ({ event_id: `evt_${id}`, event_type: "payment.status.changed", schema_version: 1, merchant_id: scope.merchantId,
  occurred_at: new Date(0).toISOString(), correlation_id: id, causation_id: id, producer: "checkout", payload: { synthetic: true } });
const plan = intent => ({ merchantId: scope.merchantId, paymentIntentId: intent.id, provider: "synthetic", currency: "BRL",
  plannedGrossCents: 10400, plannedPlatformFeeCents: 0, plannedMerchantNetCents: 10400, plannedProviderFeeCents: 0,
  occurredAt: new Date(0), entries: [{ entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", plannedAmountCents: 10400 }] });
const state = async () => ({ payments: await prisma.paymentIntent.findMany({ orderBy: { id: "asc" } }),
  outbox: await prisma.outboxMessage.findMany({ orderBy: { eventId: "asc" } }),
  settlements: await prisma.paymentSettlement.findMany({ orderBy: { id: "asc" } }),
  allocations: await prisma.paymentSettlementEntry.findMany({ orderBy: { id: "asc" } }),
  session: await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } }) });
let PaymentIntentEntity, repository, quoteManualDelivery, toCheckoutShippingQuote;
async function seed(chat = false) {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  // Entirely owned disposable schema. TRUNCATE does not disable append-only
  // ledger triggers or mutate a production financial record.
  await prisma.$executeRaw`TRUNCATE payment_settlement_entries,payment_settlements,payment_intents,outbox_messages,shipping_quotes,
    checkout_sessions,own_delivery_configs,merchant_rules,merchants CASCADE`;
  await prisma.merchant.create({ data: { id: scope.merchantId, name: "Synthetic", storeSettings: { company: { address: {
    zip: origin.zip, city: origin.city, state: origin.state } } } } });
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,allow_free_shipping,allow_shipping_discount,
    allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,
    max_partial_shipping_discount,offer_expiration_minutes,blocked_regions,brand_voice,origin_zip,updated_at)
    VALUES ('synthetic-rules',${scope.merchantId},20,99,false,false,false,false,true,true,0,0,0,30,ARRAY[]::text[],'consultative',${origin.zip},CURRENT_TIMESTAMP)`;
  const config = await prisma.ownDeliveryConfig.create({ data: { id: "synthetic-config", merchantId: scope.merchantId, enabled: true,
    mode: "neighborhood", neighborhoods: [{ name: "Centro", priceCents: 900 }], estimatedValue: 1, estimatedUnit: "days" } });
  const results = quoteManualDelivery(config, { cartTotalCents: 10000, neighborhood: address.neighborhood,
    origin, destinationCity: address.city, destinationState: address.state });
  assert.equal(results.length, 1); assert.equal(results[0].price, 900);
  const option = results[0], selected = chat ? toCheckoutShippingQuote({ label: option.label, carrierKey: option.carrier_key,
    priceInCents: 900, realCostInCents: 900, isFree: false, etaDays: 1, destinationZip: address.zip })
    : { customerPrice: 9, realCost: null, carrier: option.carrier_key, method: option.label, deliveryDays: 1, destinationZip: address.zip };
  await prisma.checkoutSession.create({ data: { id: "synthetic-checkout-row", ...scope, globalUserId: "synthetic-buyer", conversationId: "synthetic-conversation",
    createdAt: new Date(), updatedAt: new Date(),
    cart: { currency: "BRL", total: 100, currentDiscount: 5, items: [{ sku: "SYNTHETIC", name: "Saved merchandise", price: 100, quantity: 1 }] },
    customer: { address_verified: true, address }, shipping: selected } });
  await prisma.shippingQuote.create({ data: { id: "synthetic-quote", ...scope, destinationZip: address.zip, quoteKey: "synthetic-key",
    results, selectedCarrierKey: chat ? null : option.carrier_key, expiresAt: new Date("2100-01-01") } });
  const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: "synthetic-neighborhood-key", amountCents: 10400, currency: "BRL", method: "pix" });
  intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 10400, currency: "BRL", method: "pix" });
  return intent;
}
async function mutate(kind, tx = prisma) {
  if (kind === "city" || kind === "state" || kind === "unverified") {
    await tx.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer: { address_verified: kind !== "unverified",
      address: { ...address, ...(kind === "city" ? { city: "Santo Andre" } : {}), ...(kind === "state" ? { state: "RJ" } : {}) } } } });
  } else if (kind === "tariff") await tx.ownDeliveryConfig.update({ where: { merchantId: scope.merchantId }, data: { neighborhoods: [{ name: "Centro", priceCents: 901 }] } });
  else if (kind === "disabled") await tx.ownDeliveryConfig.update({ where: { merchantId: scope.merchantId }, data: { enabled: false } });
  else if (kind === "origin") await tx.merchant.update({ where: { id: scope.merchantId }, data: { storeSettings: { company: { address: { ...origin, city: "Campinas" } } } } });
  else assert.fail("unknown_synthetic_mutation");
}
async function ready(intent) { await repository.saveIntent({ intent }); assert.equal(intent.snapshot().version, 1); }
async function assertRefused(intent, mode = "outbox") {
  const before = await state(), version = intent.snapshot().version;
  await assert.rejects(mode === "settlement" ? repository.saveIntentWithSettlementPlan({ intent, settlementPlan: plan(intent) })
    : repository.saveIntentWithOutbox({ intent }, event(intent.id)), review);
  assert.deepEqual(await state(), before); assert.equal(intent.snapshot().version, version);
}
async function configRace(intent) {
  let unlock, acquired;
  const started = new Promise(resolve => { acquired = resolve; }), release = new Promise(resolve => { unlock = resolve; });
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`;
    acquired(); await release; await mutate("tariff", tx);
  }, { timeout: 15000 });
  const blockResult = blocker.then(() => null, error => error);
  await Promise.race([started, blockResult.then(error => { throw error ?? new Error("synthetic_config_blocker_ended_early"); })]);
  const before = await state();
  const outcome = repository.saveIntentWithOutbox({ intent }, event(intent.id)).then(() => ({ ok: true }), error => ({ ok: false, error }));
  let observation;
  try {
    const deadline = Date.now() + 3500; let observed = false;
    while (Date.now() < deadline) {
      const [{ count }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_stat_activity
        WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM own_delivery_configs%'`;
      if (count > 0) { observed = true; waiters++; break; } await pause(25);
    }
    assert.ok(observed, "real_neighborhood_config_wait_required");
  } catch (error) { observation = error; } finally { unlock(); }
  const blockError = await blockResult, result = await outcome;
  if (blockError) throw blockError; if (observation) throw observation;
  assert.equal(result.ok, false); review(result.error); assert.deepEqual(await state(), before);
}
try {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  ({ PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts"));
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  ({ quoteManualDelivery } = await import("../src/modules/shipping/domain/services/manual-delivery-quote.ts"));
  ({ toCheckoutShippingQuote } = await import("../src/modules/shipping/domain/services/checkout-shipping-quote.mapper.ts"));
  repository = new PrismaPaymentRepository(prisma); // Real repo, no capture callback/provider/auth override.
  for (const chat of [false, true]) for (const phase of ["new", "first-send"]) {
    await check(`${phase} ${chat ? "chat" : "HTTP-key"} same-city normal payment preserves merchandise and D`, async () => {
      const intent = await seed(chat), before = (await state()).session;
      if (phase === "first-send") { await ready(intent); assert.equal(intent.claimCreation("first-lease", new Date()), "create"); }
      await repository.saveIntentWithOutbox({ intent }, event(intent.id));
      const after = await state(); assert.equal(after.payments.length, 1); assert.equal(after.outbox.length, 1);
      assert.deepEqual(after.session, before); assert.equal(after.payments[0].amountCents, 10400);
      assert.equal(after.payments[0].creation.state, phase === "new" ? "ready" : "in_flight");
    });
    for (const kind of ["city", "state", "tariff", "disabled", "origin", "unverified"]) await check(`${phase} ${chat ? "chat" : "HTTP-key"} ${kind} refuses atomically`, async () => {
      const intent = await seed(chat); if (phase === "first-send") await ready(intent);
      await mutate(kind); if (phase === "first-send") assert.equal(intent.claimCreation("first-lease", new Date()), "create");
      await assertRefused(intent);
    });
  }
  for (const phase of ["new", "first-send"]) {
    await check(`${phase} outside-city refusal cannot append a settlement allocation`, async () => {
      const intent = await seed(true); if (phase === "first-send") await ready(intent);
      await mutate("city"); if (phase === "first-send") intent.claimCreation("first-lease", new Date());
      await assertRefused(intent, "settlement");
    });
    await check(`${phase} real configuration lock wait sees changed tariff before journal or lease commit`, async () => {
      const intent = await seed(true); if (phase === "first-send") { await ready(intent); intent.claimCreation("first-lease", new Date()); }
      await configRace(intent);
    });
  }
  await check("same-city admission records an actual append-only planned settlement without a provider call", async () => {
    const intent = await seed(); const before = (await state()).session;
    await repository.saveIntentWithSettlementPlan({ intent, settlementPlan: plan(intent) });
    const after = await state(); assert.equal(after.payments.length, 1); assert.equal(after.settlements.length, 1); assert.equal(after.allocations.length, 1);
    assert.equal(after.settlements[0].plannedGrossCents, 10400); assert.deepEqual(after.session, before);
  });
  for (const phase of ["uncertain", "provider-known", "approved"]) await check(`${phase} reconciliation is not repriced or reblocked by changed neighborhood config`, async () => {
    let intent = await seed(true); await ready(intent);
    assert.equal(intent.claimCreation("first-lease", new Date(0)), "create"); await repository.saveIntent({ intent });
    if (phase === "uncertain") intent.markCreationUncertain("first-lease", "synthetic_unknown");
    else { intent.completeCreation("first-lease"); intent.markRequiresAction({ providerPaymentId: "synthetic-provider-reference" }); }
    await repository.saveIntent({ intent });
    await mutate("city"); await mutate("disabled");
    const frozen = intent.snapshot().creation.input, before = (await state()).session;
    // Native read/rehydration, not a manually forged recovery entity.
    [intent] = await repository.listForSession(scope.merchantId, scope.sessionId);
    if (phase === "uncertain") assert.equal(intent.claimCreation("recovery-lease", new Date(100000)), "recover");
    if (phase === "approved") intent.markApproved({ providerPaymentId: "synthetic-provider-reference", approvedAmountCents: 10400 });
    await repository.saveIntentWithOutbox({ intent }, event(intent.id));
    const after = await state(); assert.equal(after.payments.length, 1); assert.equal(after.outbox.length, 1);
    assert.equal(after.payments[0].amountCents, 10400); assert.deepEqual(after.payments[0].creation.input, frozen); assert.deepEqual(after.session, before);
    if (phase === "uncertain") assert.equal(after.payments[0].creation.state, "in_flight");
    if (phase === "approved") assert.equal(after.payments[0].status, "approved");
  });
  console.log(JSON.stringify({ status: "passed", checks: passed, realConfigWaitersObserved: waiters, realProviderCalls: 0,
    realPrismaTransactions: true, normalCheckout: true, publicHttpProof: false, signedWebhookProof: false, fullJourneyProof: false }));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", test: active, errorName: error?.name ?? "unknown", code: typeof error?.code === "string" ? error.code : undefined }));
  throw error;
} finally { await prisma.$disconnect(); }
