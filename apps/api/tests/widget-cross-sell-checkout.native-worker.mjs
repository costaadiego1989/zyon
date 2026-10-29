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
  assert.equal(process.env[key], undefined, "native_widget_checkout_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
const scope = { merchantId: "synthetic-merchant", sessionId: "synthetic-checkout" };
const request = { suggestionId: "synthetic-suggestion", variantId: "target", quantity: 1 };
const contact = { fullName: "Synthetic Buyer", email: "buyer@example.test", cpf: "12345678901", phone: "11987654321" };
const address = { zip: "01310100", street: "Synthetic Street", number: "10", complement: "",
  neighborhood: "Synthetic District", city: "Synthetic City", state: "SP" };
let passed = 0, waiters = 0, active = "marker";
const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const row = async () => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: scope } });
const counts = async () => ({ outbox: await prisma.outboxMessage.count(), events: await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_accepted" } }),
  accepted: await prisma.crossSellSuggestion.count({ where: { ...scope, status: "accepted" } }) });
async function reset() {
  await prisma.$executeRaw`DELETE FROM own_delivery_configs`;
  await prisma.$executeRaw`DELETE FROM payment_intents`;
  await prisma.$executeRaw`DELETE FROM checkout_events`;
  await prisma.$executeRaw`DELETE FROM outbox_messages`;
  await prisma.$executeRaw`DELETE FROM coupon_redemptions`;
  await prisma.$executeRaw`DELETE FROM cross_sell_suggestions`;
  await prisma.$executeRaw`DELETE FROM product_media`;
  await prisma.$executeRaw`DELETE FROM product_promotions`;
  await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=20,allow_free_shipping=false,
    allow_stack_discount_and_free_shipping=false,free_shipping_min_cart_value=0,max_shipping_subsidy=0,blocked_regions=ARRAY[]::text[]`;
  await prisma.$executeRaw`DELETE FROM product_stock WHERE id='synthetic-extra-stock'`;
  await prisma.$executeRaw`UPDATE checkout_sessions SET version=4, strategy_context_version=0,shipping=NULL,shipping_options=NULL,
    customer=NULL,global_user_id='synthetic-buyer',payment_method=NULL,
    cart='{"currency":"BRL","total":100,"items":[{"sku":"TRIGGER","name":"Synthetic","price":100,"quantity":1}]}'::jsonb`;
  await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2000 WHERE variant_id='target'`;
  await prisma.$executeRaw`UPDATE product_stock SET quantity=100,reserved=0`;
  await prisma.$executeRaw`UPDATE products SET metadata='{}'::jsonb`;
  await prisma.$executeRaw`UPDATE product_variants SET weight_grams=NULL,height_cm=NULL,width_cm=NULL,length_cm=NULL`;
  await prisma.$executeRaw`INSERT INTO cross_sell_suggestions(id,merchant_id,session_id,promo_id,ranked_items,agent_copy,computed_discount,status,suggested_at)
    VALUES ('synthetic-suggestion',${scope.merchantId},${scope.sessionId},'promo',ARRAY['TARGET'],'Synthetic',10,'pending',CURRENT_TIMESTAMP)`;
}
async function resetAddress() {
  await reset();
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer: contact } });
}
async function resetEmailOtp() {
  await reset();
  const [{ deadline }] = await prisma.$queryRaw`SELECT clock_timestamp() + interval '10 minutes' AS deadline`;
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer: {
    ...contact, email_verified: false, phone_verified: false, recognized_buyer: false, isReturning: false,
    otp_code: "123456", otp_expires_at: deadline.toISOString(), phone_otp_code: "654321",
    address, address_verified: true,
  } } });
}
async function resetManualShipping() {
  await reset();
  // Canonical server-owned locality is now required for neighborhood coverage.
  // These configured synthetic addresses do not claim geocoder verification.
  await prisma.merchant.update({ where: { id: scope.merchantId }, data: {
    storeSettings: { company: { address: { zip: "01310000", city: address.city, state: address.state } } },
  } });
  await prisma.merchantRule.update({ where: { merchantId: scope.merchantId }, data: { originZip: "01310000" } });
  await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer: { ...contact, address, address_verified: true } } });
  await prisma.$executeRaw`INSERT INTO own_delivery_configs(id,merchant_id,enabled,mode,flat_price_cents)
    VALUES ('synthetic-manual',${scope.merchantId},true,'flat',900)`;
}
async function withBlockedManualQuote(adapter, mutate, operation) {
  let unlock, locked;
  const acquired = new Promise(resolve => { locked = resolve; }), release = new Promise(resolve => { unlock = resolve; });
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR UPDATE`;
    locked(); await release; await mutate(tx);
  }, { timeout: 15_000 });
  const blockerSettled = blocker.then(() => null, error => error);
  await Promise.race([acquired, blockerSettled.then(error => { throw error ?? new Error("manual_blocker_ended_before_lock"); })]);
  const settled = (operation ? operation() : adapter.quoteManualShipping(scope, { expectedVersion: 5 }))
    .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  let waitError;
  try {
    const deadline = Date.now() + 8000; let found = false;
    while (Date.now() < deadline) {
      const [{ count }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_stat_activity
        WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM own_delivery_configs%'`;
      if (count > 0) { found = true; waiters++; break; } await pause(25);
    }
    assert.ok(found, "real_manual_config_lock_wait_required");
  } catch (error) { waitError = error; } finally { unlock(); }
  const blockError = await blockerSettled, result = await settled;
  if (blockError) throw blockError;
  if (waitError) throw waitError;
  return result;
}
async function withBlockedAccept(adapter, expectedQuote, mutate, acceptedProjection = false, operation) {
  let unlock, locked;
  const acquired = new Promise(resolve => { locked = resolve; }), release = new Promise(resolve => { unlock = resolve; });
  const blocker = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${scope.merchantId} FOR UPDATE`;
    locked(); await release; await mutate(tx);
  }, { timeout: 15_000 });
  const blockerSettled = blocker.then(() => null, error => error);
  await Promise.race([acquired, blockerSettled.then(error => { throw error ?? new Error("blocker_ended_before_lock"); })]);
  const acceptance = operation ? operation() : acceptedProjection ? adapter.readAccepted(scope) : adapter.accept(scope, { expectedQuote });
  const settled = acceptance.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
  let waitError;
  try {
    const deadline = Date.now() + 8000;
    let found = false;
    while (Date.now() < deadline) {
      const [{ count }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_stat_activity
        WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM merchants%'`;
      if (count > 0) { found = true; waiters++; break; } await pause(25);
    }
    assert.ok(found, "real_postgres_lock_wait_required");
  } catch (error) { waitError = error; } finally { unlock(); }
  const blockError = await blockerSettled; const result = await settled;
  if (blockError) throw blockError;
  if (waitError) throw waitError;
  assert.equal(result.ok, false, "stale_accept_must_refuse_after_wait");
}
try {
  const marker = await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, [{ run_id: runId }]);
  const { PrismaWidgetCrossSellCheckoutAdapter } = await import("../src/modules/cross-sell/infrastructure/repositories/prisma-widget-cross-sell-checkout.adapter.ts");
  const adapter = new PrismaWidgetCrossSellCheckoutAdapter(prisma);
  const { readAcceptedWidgetCheckoutInTransaction } = await import("../src/modules/cross-sell/infrastructure/repositories/widget-checkout-accepted-reader.ts");
  const { widgetCheckoutRevisionContextHash } = await import("../src/modules/cross-sell/infrastructure/repositories/widget-cross-sell-checkout-revision.ts");
  const { parseWidgetCheckoutPaymentAuthority } = await import("../src/modules/payment/domain/widget-checkout-payment-authority.schemas.ts");
  const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const readPaymentCheckout = options => prisma.$transaction(tx => readAcceptedWidgetCheckoutInTransaction(tx, scope, options),
    { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
  // Fixture proves reader/own-row fences, NOT real payment admission/provider IO.
  async function syntheticOwnPayment() {
    await resetManualShipping();
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope },
      data: { customer: { ...contact, email_verified: true, address, address_verified: true } } });
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const quoted = (await row()).shippingOptions;
    await adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: quoted.id, carrierKey: quoted.options[0].carrier_key });
    const current = await readPaymentCheckout();
    const basisHash = paymentCartFingerprint({ cart: current.projectedCart, shipping: current.selectedShipping });
    const amounts = { version: 1, currency: "BRL", cartFingerprint: basisHash, itemsSubtotalCents: 11800,
      discountCents: 0, shippingCents: 900, platformFeeCents: 149, totalCents: 12849 };
    const paymentId = "synthetic-own-payment";
    const authority = parseWidgetCheckoutPaymentAuthority({ version: 1, origin: "widget_checkout", paymentId,
      merchantId: scope.merchantId, checkoutSessionId: scope.sessionId, buyerId: current.stored.globalUserId,
      acceptanceEventId: current.receipt.eventId, checkoutVersion: current.stored.version, revisionEventId: current.receipt.revision.eventId,
      contextHash: widgetCheckoutRevisionContextHash(current.stored), basisHash, method: "pix", currency: "BRL", amountCents: 12849,
      admittedAt: current.quote.quotedAt, amountBreakdown: amounts, frozenProjection: { globalUserId: current.stored.globalUserId,
        cart: current.projectedCart, shipping: current.selectedShipping,
        customer: { ...contact, email_verified: true, address_verified: true, address } } });
    await prisma.paymentIntent.create({ data: { id: paymentId, ...scope, idempotencyKey: "synthetic-own-key", amountCents: 12849,
      currency: "BRL", method: "pix", status: "pending", version: 1, amountBreakdown: amounts, statusHistory: [],
      creation: { state: "ready", widgetCheckoutAuthority: authority,
        input: { ...scope, intentId: paymentId, amountCents: 12849, currency: "BRL", method: "pix" } } } });
    return { paymentId, authority };
  }
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { toCheckoutSession } = await import("../src/modules/checkout/infrastructure/prisma/checkout-session.mapper.ts");
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
  await prisma.$executeRaw`INSERT INTO merchants(id,name,updated_at) VALUES (${scope.merchantId},'Synthetic',CURRENT_TIMESTAMP),('foreign-merchant','Synthetic foreign',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,allow_free_shipping,allow_shipping_discount,
    allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,
    max_partial_shipping_discount,offer_expiration_minutes,blocked_regions,brand_voice,updated_at)
    VALUES ('rules',${scope.merchantId},20,99,false,false,false,false,true,true,0,0,0,30,ARRAY[]::text[],'consultative',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO checkout_settings VALUES ('settings',${scope.merchantId},'[]'::jsonb)`;
  await prisma.$executeRaw`INSERT INTO checkout_sessions(id,merchant_id,session_id,global_user_id,conversation_id,cart,created_at,updated_at)
    VALUES ('checkout-row',${scope.merchantId},${scope.sessionId},'synthetic-buyer','synthetic-conversation','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO products(id,merchant_id,name,type,metadata,updated_at) VALUES
    ('trigger-product',${scope.merchantId},'Synthetic trigger','physical','{}',CURRENT_TIMESTAMP),
    ('target-product',${scope.merchantId},'Synthetic target','physical','{}',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO product_variants(id,product_id,sku,updated_at) VALUES
    ('trigger','trigger-product','TRIGGER',CURRENT_TIMESTAMP),('target','target-product','TARGET',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents) VALUES ('trigger-price','trigger',10000),('target-price','target',2000)`;
  await prisma.$executeRaw`INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES ('trigger-stock','trigger',100,0),('target-stock','target',100,0)`;
  await prisma.$executeRaw`INSERT INTO cross_sell_promotions(id,merchant_id,name,trigger,recommended_skus,discount_percent,max_discount_percent,status,starts_at,updated_at)
    VALUES ('promo',${scope.merchantId},'Synthetic','{"sku_in_cart":["TRIGGER"]}',ARRAY['TARGET'],10,100,'active',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP)`;
  await reset();
  await check("real Prisma quote and atomic acceptance preserve base/provenance/outbox", async () => {
    const before = await row(), expectedQuote = await adapter.quote(scope, request);
    assert.equal(expectedQuote.totalCents, 11800); assert.deepEqual(await row(), before);
    const ack = await adapter.accept(scope, { expectedQuote });
    assert.equal(ack.persistenceVersion, 5); assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
    const saved = await row(); assert.equal(saved.cart.total, 120); assert.equal(saved.cart._widgetCrossSellAcceptance.quote.totalCents, 11800);
    assert.equal(saved.cart._widgetCrossSellAcceptance.eventId, ack.eventId);
  });
  await reset();
  await check("real concurrent acceptance commits exactly once", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    const results = await Promise.allSettled([adapter.accept(scope, { expectedQuote }), adapter.accept(scope, { expectedQuote })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 }); assert.equal((await row()).version, 5);
  });
  await reset();
  await check("real outbox error rolls back cart/suggestion/funnel", async () => {
    const expectedQuote = await adapter.quote(scope, request), before = await row();
    await prisma.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_widget_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_outbox_failure'; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER synthetic_widget_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_reject_widget_outbox()");
    try { await assert.rejects(adapter.accept(scope, { expectedQuote })); assert.deepEqual(await row(), before);
      assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 }); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER synthetic_widget_outbox_failure ON outbox_messages"); }
  });
  await reset();
  await check("waiting acceptance rereads canonical price after merchant lock", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`);
    assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 }); assert.equal((await row()).version, 4);
  });
  await reset();
  await check("waiting acceptance respects intervening checkout version", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE checkout_sessions SET version=version+1 WHERE merchant_id=${scope.merchantId}`);
    assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 }); assert.equal((await row()).version, 5);
  });
  await reset();
  await check("canonical paid options produce product-plus-addition discount", async () => {
    await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Tamanho","required":true,"selectionType":"single","items":[{"id":"large","name":"Grande","priceModifierInCents":500}]}]}'::jsonb WHERE id='target-product'`;
    await assert.rejects(adapter.quote(scope, request));
    const expectedQuote = await adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
    assert.equal(expectedQuote.target.maximumUnitPriceCents, 2250); await adapter.accept(scope, { expectedQuote });
    assert.equal((await row()).cart._widgetCrossSellAcceptance.quote.totalCents, 12250);
  });
  await reset();
  await check("canonical delivery data persists and paid shipping is invalidated", async () => {
    await prisma.$executeRaw`UPDATE product_variants SET weight_grams=500,height_cm=10,width_cm=15,length_cm=25 WHERE id='target'`;
    await prisma.$executeRaw`INSERT INTO product_media(id,variant_id,url) VALUES ('synthetic-media','target','https://example.test/synthetic.jpg')`;
    await prisma.$executeRaw`UPDATE checkout_sessions SET shipping='{"customerPrice":12,"carrier":"Synthetic"}'::jsonb,
      shipping_options='[{"customerPrice":12}]'::jsonb`;
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const saved = await row(), target = saved.cart.items.find(item => item.sku === "TARGET");
    assert.equal(target.weightGrams, 500); assert.equal(target.height_cm, 10);
    assert.equal(target.width_cm, 15); assert.equal(target.length_cm, 25); assert.equal(target.imageUrl, "https://example.test/synthetic.jpg");
    assert.equal(saved.shipping, null); assert.equal(saved.shippingOptions, null);
  });
  await reset();
  await check("warehouse over-reservation cannot inflate aggregate stock", async () => {
    await prisma.$executeRaw`UPDATE product_stock SET quantity=0,reserved=98 WHERE variant_id='target'`;
    await prisma.$executeRaw`INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES ('synthetic-extra-stock','target',100,0)`;
    await assert.rejects(adapter.quote(scope, { ...request, quantity: 3 }));
    assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 });
  });
  await reset();
  await check("waiting acceptance refuses a coupon reserved by the preceding transaction", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO coupon_redemptions(id,merchant_id,session_id,status)
      VALUES ('synthetic-coupon',${scope.merchantId},${scope.sessionId},'applied')`);
    assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 }); assert.equal((await row()).version, 4);
  });
  await reset();
  await check("simulated lost acknowledgement after real commit does not retry or duplicate", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    let attempts = 0;
    const lost = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      attempts++; await prisma.$transaction(work, options); throw new Error("synthetic_lost_commit_response");
    } });
    await assert.rejects(lost.accept(scope, { expectedQuote }), /synthetic_lost_commit_response/);
    assert.equal(attempts, 1); assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
    assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.accept(scope, { expectedQuote }));
    assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
  });
  await reset();
  await check("foreign quote scope rejects without writes", async () => {
    const expectedQuote = await adapter.quote(scope, request);
    await assert.rejects(adapter.accept({ ...scope, merchantId: "foreign-merchant" }, { expectedQuote }));
    assert.deepEqual(await counts(), { outbox: 0, events: 0, accepted: 0 });
  });
  await reset();
  await check("committed private receipt cannot leak base price or be erased by a generic save", async () => {
    const quote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote: quote });
    const saved = await row(), before = await counts(), repo = new PrismaCheckoutRepository(prisma);
    await assert.rejects(repo.getSession(scope.merchantId, scope.sessionId), /cross_sell_quote_review_required/);
    const { _widgetCrossSellAcceptance: receipt, ...publicBase } = saved.cart;
    assert.equal(receipt.quote.totalCents, quote.totalCents);
    const untrusted = toCheckoutSession({ ...saved, cart: publicBase });
    await assert.rejects(repo.saveSession(untrusted), /cross_sell_quote_review_required/);
    await assert.rejects(repo.saveSessionIfUnchanged(untrusted, untrusted), /cross_sell_quote_review_required/);
    assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
  });
  await reset();
  await check("real new-payment admission refuses private widget receipt before journal creation", async () => {
    const quote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote: quote });
    const saved = await row(), before = await counts();
    const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: "synthetic-widget-receipt", amountCents: quote.totalCents, currency: "BRL", method: "pix" });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: quote.totalCents, currency: "BRL", method: "pix" });
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent }), /cross_sell_quote_review_required/);
    assert.equal(await prisma.paymentIntent.count({ where: scope }), 0);
    assert.equal(intent.snapshot().version, 0); assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
  });
  await reset();
  await check("scope-only accepted reader projects effective prices without changing durable state", async () => {
    const expectedQuote = await adapter.quote(scope, request), ack = await adapter.accept(scope, { expectedQuote });
    const saved = await row(), before = await counts();
    const projected = await adapter.readAccepted(scope), target = projected.items.find(item => item.sku === "TARGET");
    assert.equal(projected.total, 118); assert.equal(target.price, 18); assert.equal(target.originalPrice, 20);
    assert.deepEqual(projected.discountBudget, { version: 1, originalSubtotalCents: 12000, promotionDiscountCents: 200 });
    assert.equal(JSON.stringify(projected).includes(ack.eventId), false); assert.equal(Object.hasOwn(projected, "_widgetCrossSellAcceptance"), false);
    projected.items[0].quantity = 99; assert.equal((await adapter.readAccepted(scope)).total, 118);
    assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
    await assert.rejects(adapter.readAccepted({ ...scope, merchantId: "foreign-merchant" }), /cross_sell_quote_review_required/);
  });
  await reset();
  await check("accepted paid options use canonical P+D once with stock for just one target", async () => {
    await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Tamanho","required":true,"selectionType":"single","items":[{"id":"large","name":"Grande","priceModifierInCents":500}]}]}'::jsonb WHERE id='target-product'`;
    await prisma.$executeRaw`UPDATE product_stock SET quantity=1,reserved=0 WHERE variant_id='target'`;
    const expectedQuote = await adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
    await adapter.accept(scope, { expectedQuote }); const saved = await row(), projected = await adapter.readAccepted(scope);
    const target = projected.items.find(item => item.sku === "TARGET");
    assert.equal(target.price, 22.5); assert.equal(target.originalPrice, 25); assert.equal(projected.total, 122.5);
    assert.deepEqual(target.selected_options, [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 5 }]);
    assert.deepEqual(await row(), saved);
  });
  await reset();
  await check("accepted reader refuses actual corrupted outbox evidence without repairing or rewriting", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.$executeRaw`UPDATE outbox_messages SET payload='{}'::jsonb`;
    const saved = await row(), before = await counts();
    await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
  });
  await reset();
  await check("accepted reader refuses a real stale version without changing the accepted benefit", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.$executeRaw`UPDATE checkout_sessions SET version=version+1`;
    const saved = await row(), before = await counts();
    await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
  });
  await reset();
  await check("accepted reader rechecks current price after an observed PostgreSQL lock wait", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const saved = await row(), before = await counts();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`, true);
    assert.deepEqual(await row(), saved); assert.deepEqual(await counts(), before);
  });
  await reset();
  await check("accepted reader preserves the canonical company ceiling and notice without margin", async () => {
    await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=1`;
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const projected = await adapter.readAccepted(scope);
    assert.equal(projected.total, 118.8); assert.equal(projected.discountBudget.promotionDiscountCents, 120);
    assert.equal(projected.commercialNotices[0].code, "discount_limit_reached");
  });
  await reset();
  await check("accepted reader uses the best canonical product promotion without double discount", async () => {
    await prisma.$executeRaw`INSERT INTO product_promotions(id,merchant_id,product_id,discount_type,discount_value,starts_at,ends_at)
      VALUES ('synthetic-product-promo',${scope.merchantId},'target-product','percent',20,CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day')`;
    const expectedQuote = await adapter.quote(scope, request); assert.equal(expectedQuote.target.source, "product");
    await adapter.accept(scope, { expectedQuote }); const projected = await adapter.readAccepted(scope);
    assert.equal(projected.items.find(item => item.sku === "TARGET").price, 16); assert.equal(projected.total, 116);
  });
  await reset();
  await check("accepted reader supports final committed PostgreSQL int version without overflow or write", async () => {
    await prisma.$executeRaw`UPDATE checkout_sessions SET version=2147483646`;
    const expectedQuote = await adapter.quote(scope, request), ack = await adapter.accept(scope, { expectedQuote });
    assert.equal(ack.persistenceVersion, 2147483647); const saved = await row();
    assert.equal((await adapter.readAccepted(scope)).total, 118);
    assert.deepEqual(await row(), saved);
  });
  await reset();
  await check("real customer revisions preserve canonical prices and survive PostgreSQL jsonb ordering", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const accepted = await row();
    const ack = await adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
    assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
    assert.equal((await adapter.readAccepted(scope)).total, 118);
    await adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, fullName: "Synthetic Second Name" } });
    const saved = await row(); assert.equal(saved.version, 7); assert.equal(saved.cart.total, 120);
    assert.deepEqual(saved.cart._widgetCrossSellAcceptance.quote, accepted.cart._widgetCrossSellAcceptance.quote);
    assert.equal(saved.cart._widgetCrossSellAcceptance.committedVersion, 5);
    assert.equal((await adapter.readAccepted(scope)).total, 118); assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
    const events = await prisma.checkoutEvent.findMany({ where: { ...scope, eventName: "cross_sell_checkout_customer_updated" } });
    assert.equal(events.length, 2); for (const value of Object.values(contact)) assert.equal(JSON.stringify(events).includes(value), false);
    const before = await row(); await assert.rejects(adapter.updateCustomer(scope, { expectedVersion: 6, customer: contact }));
    assert.deepEqual(await row(), before);
  });
  await reset();
  await check("unchanged verified contact preserves server proof and canonical benefit", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const customer = { ...contact, email_verified: true, phone_verified: true, address_verified: true,
      address: { city: "Synthetic" }, externalCustomerId: "synthetic-provider" };
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { customer } });
    await adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, email: " BUYER@EXAMPLE.TEST " } });
    assert.deepEqual((await row()).customer, customer); assert.equal((await row()).globalUserId, "synthetic-buyer");
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await reset();
  await check("email changes clear stale identity/proof/shipping inside the same accepted revision", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: {
      customer: { ...contact, email_verified: true, phone_verified: true, address_verified: true, recognized_buyer: true,
        otp_code: "synthetic-challenge", otp_expires_at: "2027-01-01T00:00:00Z", phone_otp_code: "synthetic-phone",
        address: { city: "Synthetic" }, externalCustomerId: "synthetic-provider", asaasCustomerId: "synthetic-asaas" },
      shipping: { customerPrice: 5 }, shippingOptions: [{ customerPrice: 5 }],
    } });
    await adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, email: "changed@example.test" } });
    const saved = await row(); assert.notEqual(saved.globalUserId, "synthetic-buyer");
    for (const field of ["email_verified", "phone_verified", "address_verified", "recognized_buyer", "isReturning"]) assert.equal(saved.customer[field], false);
    for (const field of ["otp_code", "otp_expires_at", "phone_otp_code", "address", "externalCustomerId", "asaasCustomerId"]) assert.equal(saved.customer[field], undefined);
    assert.equal(saved.shipping, null); assert.equal(saved.shippingOptions, null); assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await reset();
  await check("real concurrent customer writes commit only one expected-version revision", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const results = await Promise.allSettled([adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }),
      adapter.updateCustomer(scope, { expectedVersion: 5, customer: { ...contact, fullName: "Concurrent Other" } })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal((await row()).version, 6);
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_customer_updated" } }), 1);
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await reset();
  await check("real revision-event failure rolls back customer/identity/cart/version atomically", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const before = await row();
    await prisma.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_widget_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_name = 'cross_sell_checkout_customer_updated' THEN RAISE EXCEPTION 'synthetic_revision_failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER synthetic_widget_revision_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_reject_widget_revision()");
    try { await assert.rejects(adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact })); assert.deepEqual(await row(), before);
      assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_customer_updated" } }), 0);
      assert.equal((await adapter.readAccepted(scope)).total, 118); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER synthetic_widget_revision_failure ON checkout_events"); }
  });
  await reset();
  await check("simulated lost customer ACK after real COMMIT reconciles without retrying the write", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      await prisma.$transaction(work, options); throw new Error("synthetic_lost_customer_commit_ack");
    } });
    await assert.rejects(lostAck.updateCustomer(scope, { expectedVersion: 5, customer: contact }), /synthetic_lost_customer_commit_ack/);
    assert.equal((await row()).version, 6); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }));
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_customer_updated" } }), 1);
  });
  for (const corruption of ["event", "customer", "version"]) {
    await reset();
    await check(`accepted revision refuses actual corrupted ${corruption} without repairing state`, async () => {
      const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
      await adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
      if (corruption === "event") await prisma.$executeRaw`DELETE FROM checkout_events WHERE event_name='cross_sell_checkout_customer_updated'`;
      if (corruption === "customer") await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{email}','"foreign@example.test"'::jsonb)`;
      if (corruption === "version") await prisma.$executeRaw`UPDATE checkout_sessions SET version=version+1`;
      const before = await row(); await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/);
      await assert.rejects(adapter.updateCustomer(scope, { expectedVersion: before.version, customer: contact }), /cross_sell_quote_review_required/);
      assert.deepEqual(await row(), before);
    });
  }
  await reset();
  await check("waiting customer update rereads catalog price before any write", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`, false,
      () => adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_customer_updated" } }), 0);
  });
  await reset();
  await check("waiting customer update refuses an intervening real payment journal", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-payment',${scope.merchantId},${scope.sessionId},'synthetic-payment-key',11800,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_customer_updated" } }), 0);
  });
  await reset();
  await check("generic save/read/new-payment guards still refuse a revised private receipt", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact }); const saved = await row();
    assert.throws(() => toCheckoutSession(saved), /cross_sell_quote_review_required/);
    const repository = new PrismaCheckoutRepository(prisma);
    await assert.rejects(repository.getSession(scope.merchantId, scope.sessionId), /cross_sell_quote_review_required/);
    const { _widgetCrossSellAcceptance: _receipt, ...publicBase } = saved.cart;
    const untrusted = toCheckoutSession({ ...saved, cart: publicBase });
    await assert.rejects(repository.saveSession(untrusted), /cross_sell_quote_review_required/);
    await assert.rejects(repository.saveSessionIfUnchanged(untrusted, untrusted), /cross_sell_quote_review_required/);
    const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: "synthetic-revised-payment", amountCents: 11800, currency: "BRL", method: "pix" });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 11800, currency: "BRL", method: "pix" });
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent }), /cross_sell_quote_review_required/);
    assert.equal(await prisma.paymentIntent.count({ where: scope }), 0); assert.deepEqual(await row(), saved);
  });
  await reset();
  await check("contact revision preserves paid-option canonical P+D and counts target stock only once", async () => {
    await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Tamanho","required":true,"selectionType":"single","items":[{"id":"large","name":"Grande","priceModifierInCents":500}]}]}'::jsonb WHERE id='target-product'`;
    await prisma.$executeRaw`UPDATE product_stock SET quantity=1,reserved=0 WHERE variant_id='target'`;
    const expectedQuote = await adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
    await adapter.accept(scope, { expectedQuote }); await adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact });
    const saved = await row(), projected = await adapter.readAccepted(scope), target = projected.items.find(item => item.sku === "TARGET");
    assert.equal(projected.total, 122.5); assert.equal(target.price, 22.5); assert.equal(target.originalPrice, 25);
    assert.deepEqual(target.selected_options, [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 5 }]);
    assert.equal(saved.cart.total, 125); assert.deepEqual(await row(), saved);
  });
  await reset();
  await check("last PostgreSQL int contact revision remains readable and cannot overflow", async () => {
    await prisma.$executeRaw`UPDATE checkout_sessions SET version=2147483645`;
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await adapter.updateCustomer(scope, { expectedVersion: 2147483646, customer: contact });
    const saved = await row(); assert.equal(saved.version, 2147483647); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.updateCustomer(scope, { expectedVersion: 2147483647, customer: contact })); assert.deepEqual(await row(), saved);
  });
  await resetAddress();
  await check("explicit address revision atomically invalidates shipping and preserves identity and canonical benefit", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: {
      customer: { ...contact, email_verified: true, phone_verified: true, externalCustomerId: "synthetic-provider", deliveryAddressLabel: "old" },
      shipping: { customerPrice: 5 }, shippingOptions: [{ customerPrice: 5 }],
    } });
    const ack = await adapter.updateAddress(scope, { expectedVersion: 5, address: { ...address, zip: "01310-100", state: "sp" } });
    assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
    const saved = await row(); assert.deepEqual(saved.customer.address, address); assert.equal(saved.customer.address_verified, true);
    assert.equal(saved.customer.email_verified, true); assert.equal(saved.customer.phone_verified, true);
    assert.equal(saved.customer.externalCustomerId, "synthetic-provider"); assert.equal(saved.customer.deliveryAddressLabel, undefined);
    assert.equal(saved.globalUserId, "synthetic-buyer"); assert.equal(saved.shipping, null); assert.equal(saved.shippingOptions, null);
    assert.equal(saved.cart.total, 120); assert.equal(saved.cart._widgetCrossSellAcceptance.revision.operation, "address");
    assert.equal((await adapter.readAccepted(scope)).total, 118);
    const events = await prisma.checkoutEvent.findMany({ where: { ...scope, eventName: "cross_sell_checkout_address_updated" } });
    assert.equal(events.length, 1); assert.equal(events[0].metadata.operation, "address");
    for (const value of [address.street, address.zip, address.city, contact.email]) assert.equal(JSON.stringify(events).includes(value), false);
    assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
  });
  await resetAddress();
  await check("real address/contact/address revisions remain readable with exact latest event kind", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await adapter.updateAddress(scope, { expectedVersion: 5, address });
    await adapter.updateCustomer(scope, { expectedVersion: 6, customer: contact });
    await adapter.updateAddress(scope, { expectedVersion: 7, address: { ...address, number: "11" } });
    const saved = await row(); assert.equal(saved.version, 8); assert.equal(saved.customer.address.number, "11");
    assert.equal((await adapter.readAccepted(scope)).total, 118); assert.equal(await prisma.checkoutEvent.count({ where: scope }), 4);
  });
  await resetAddress();
  await check("real same-version address/contact concurrency commits one revision only", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const results = await Promise.allSettled([adapter.updateAddress(scope, { expectedVersion: 5, address }),
      adapter.updateCustomer(scope, { expectedVersion: 5, customer: contact })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await row()).version, 6); assert.equal(await prisma.checkoutEvent.count({ where: scope }), 2);
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await resetAddress();
  await check("real address-event failure rolls back address/shipping/context/revision together", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: scope }, data: { shipping: { customerPrice: 5 }, shippingOptions: [{ customerPrice: 5 }] } });
    const before = await row();
    await prisma.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_widget_address_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_name = 'cross_sell_checkout_address_updated' THEN RAISE EXCEPTION 'synthetic_address_revision_failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER synthetic_widget_address_revision_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_reject_widget_address_revision()");
    try { await assert.rejects(adapter.updateAddress(scope, { expectedVersion: 5, address })); assert.deepEqual(await row(), before);
      assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_address_updated" } }), 0); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER synthetic_widget_address_revision_failure ON checkout_events"); }
  });
  await resetAddress();
  await check("simulated lost address ACK after actual COMMIT reconciles without another revision", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      await prisma.$transaction(work, options); throw new Error("synthetic_lost_address_commit_ack");
    } });
    await assert.rejects(lostAck.updateAddress(scope, { expectedVersion: 5, address }), /synthetic_lost_address_commit_ack/);
    const saved = await row(); assert.equal(saved.version, 6); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.updateAddress(scope, { expectedVersion: 5, address })); assert.deepEqual(await row(), saved);
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_address_updated" } }), 1);
  });
  for (const corruption of ["event-kind", "revision-kind", "address", "shipping"]) {
    await resetAddress();
    await check(`address revision refuses actual corrupted ${corruption} without repair`, async () => {
      const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
      await adapter.updateAddress(scope, { expectedVersion: 5, address });
      if (corruption === "event-kind") await prisma.$executeRaw`UPDATE checkout_events SET event_name='cross_sell_checkout_customer_updated' WHERE event_name='cross_sell_checkout_address_updated'`;
      if (corruption === "revision-kind") await prisma.$executeRaw`UPDATE checkout_sessions SET cart=cart #- '{_widgetCrossSellAcceptance,revision,operation}'`;
      if (corruption === "address") await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{address,number}','"99"'::jsonb)`;
      if (corruption === "shipping") await prisma.$executeRaw`UPDATE checkout_sessions SET shipping_options='[{"customerPrice":0}]'::jsonb`;
      const saved = await row(); await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/);
      await assert.rejects(adapter.updateAddress(scope, { expectedVersion: 6, address })); assert.deepEqual(await row(), saved);
    });
  }
  await resetAddress();
  await check("waiting address update rereads current catalog after real PostgreSQL lock wait", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`, false,
      () => adapter.updateAddress(scope, { expectedVersion: 5, address }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_address_updated" } }), 0);
  });
  await resetAddress();
  await check("waiting address update refuses an intervening real payment journal", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-address-payment',${scope.merchantId},${scope.sessionId},'synthetic-address-payment-key',11800,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.updateAddress(scope, { expectedVersion: 5, address }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_address_updated" } }), 0);
  });
  await resetAddress();
  await check("address revision preserves paid options P+D and counts target stock once", async () => {
    await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Tamanho","required":true,"selectionType":"single","items":[{"id":"large","name":"Grande","priceModifierInCents":500}]}]}'::jsonb WHERE id='target-product'`;
    await prisma.$executeRaw`UPDATE product_stock SET quantity=1,reserved=0 WHERE variant_id='target'`;
    const expectedQuote = await adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] });
    await adapter.accept(scope, { expectedQuote }); await adapter.updateAddress(scope, { expectedVersion: 5, address });
    const saved = await row(), projected = await adapter.readAccepted(scope), target = projected.items.find(item => item.sku === "TARGET");
    assert.equal(projected.total, 122.5); assert.equal(target.price, 22.5); assert.equal(target.originalPrice, 25);
    assert.equal(saved.cart.total, 125); assert.deepEqual(await row(), saved);
  });
  await resetAddress();
  await check("last PostgreSQL int address revision remains readable without overflow", async () => {
    await prisma.$executeRaw`UPDATE checkout_sessions SET version=2147483645`;
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await adapter.updateAddress(scope, { expectedVersion: 2147483646, address });
    const saved = await row(); assert.equal(saved.version, 2147483647); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.updateAddress(scope, { expectedVersion: 2147483647, address })); assert.deepEqual(await row(), saved);
  });
  await resetAddress();
  await check("address revision retains generic mapper/save/new-payment guards", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await adapter.updateAddress(scope, { expectedVersion: 5, address }); const saved = await row();
    assert.throws(() => toCheckoutSession(saved), /cross_sell_quote_review_required/);
    const repository = new PrismaCheckoutRepository(prisma);
    await assert.rejects(repository.getSession(scope.merchantId, scope.sessionId), /cross_sell_quote_review_required/);
    const { _widgetCrossSellAcceptance: _receipt, ...publicBase } = saved.cart;
    const untrusted = toCheckoutSession({ ...saved, cart: publicBase });
    await assert.rejects(repository.saveSession(untrusted), /cross_sell_quote_review_required/);
    await assert.rejects(repository.saveSessionIfUnchanged(untrusted, untrusted), /cross_sell_quote_review_required/);
    const intent = PaymentIntentEntity.create({ ...scope, idempotencyKey: "synthetic-address-payment", amountCents: 11800, currency: "BRL", method: "pix" });
    intent.prepareCreation({ ...scope, intentId: intent.id, amountCents: 11800, currency: "BRL", method: "pix" });
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent }), /cross_sell_quote_review_required/);
    assert.equal(await prisma.paymentIntent.count({ where: scope }), 0); assert.deepEqual(await row(), saved);
  });
  await resetEmailOtp();
  await check("real email OTP consumes current challenge and preserves financial/address/identity context", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const before = await row(), ack = await adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }), saved = await row();
    assert.deepEqual(ack, { version: 1, ...scope, status: "updated", persistenceVersion: 6 });
    assert.equal(saved.version, 6); assert.equal(saved.strategyContextVersion, before.strategyContextVersion + 1);
    assert.deepEqual(saved.customer, { ...before.customer, email_verified: true, otp_code: "", otp_expires_at: "" });
    assert.equal(saved.globalUserId, before.globalUserId); assert.equal(saved.cart.total, 120);
    assert.equal(saved.cart._widgetCrossSellAcceptance.revision.operation, "email_otp");
    assert.deepEqual(saved.cart._widgetCrossSellAcceptance.quote, before.cart._widgetCrossSellAcceptance.quote);
    assert.equal((await adapter.readAccepted(scope)).total, 118);
    const events = await prisma.checkoutEvent.findMany({ where: { ...scope, eventName: "cross_sell_checkout_email_verified" } });
    assert.equal(events.length, 1); assert.equal(events[0].metadata.operation, "email_otp");
    for (const value of [contact.email, "123456", "654321", "otp_code", "otp_expires_at", address.street])
      assert.equal(JSON.stringify({ ack, events }).includes(value), false);
    assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
    await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 6, code: "123456" })); assert.deepEqual(await row(), saved);
  });
  await resetEmailOtp();
  await check("real competing email OTP consumption commits exactly once", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const outcomes = await Promise.allSettled([adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }),
      adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" })]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await row()).version, 6); assert.equal((await adapter.readAccepted(scope)).total, 118);
    assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_email_verified" } }), 1);
  });
  await resetEmailOtp();
  await check("real email OTP event failure rolls back challenge consumption and revision", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await prisma.$executeRawUnsafe("CREATE FUNCTION synthetic_reject_widget_email_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_name = 'cross_sell_checkout_email_verified' THEN RAISE EXCEPTION 'synthetic_email_revision_failure'; END IF; RETURN NEW; END $$");
    await prisma.$executeRawUnsafe("CREATE TRIGGER synthetic_widget_email_revision_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_reject_widget_email_revision()");
    try { await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" })); assert.deepEqual(await row(), before);
      assert.equal(await prisma.checkoutEvent.count({ where: { ...scope, eventName: "cross_sell_checkout_email_verified" } }), 0); }
    finally { await prisma.$executeRawUnsafe("DROP TRIGGER synthetic_widget_email_revision_failure ON checkout_events"); }
  });
  await resetEmailOtp();
  await check("simulated lost email OTP ACK after actual COMMIT cannot replay consumed challenge", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      await prisma.$transaction(work, options); throw new Error("synthetic_lost_email_commit_ack");
    } });
    await assert.rejects(lostAck.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }), /synthetic_lost_email_commit_ack/);
    const saved = await row(); assert.equal(saved.customer.email_verified, true); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" })); assert.deepEqual(await row(), saved);
  });
  for (const corruption of ["event-kind", "revision-kind", "code", "email"]) {
    await resetEmailOtp();
    await check(`email OTP revision refuses actual corrupted ${corruption} without repair`, async () => {
      const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
      await adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" });
      if (corruption === "event-kind") await prisma.$executeRaw`UPDATE checkout_events SET event_name='cross_sell_checkout_customer_updated' WHERE event_name='cross_sell_checkout_email_verified'`;
      if (corruption === "revision-kind") await prisma.$executeRaw`UPDATE checkout_sessions SET cart=cart #- '{_widgetCrossSellAcceptance,revision,operation}'`;
      if (corruption === "code") await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{otp_code}','"123456"'::jsonb)`;
      if (corruption === "email") await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{email}','"other@example.test"'::jsonb)`;
      const saved = await row(); await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/); assert.deepEqual(await row(), saved);
    });
  }
  await resetEmailOtp();
  await check("waiting email OTP uses current database clock and rejects challenge expiring during real lock wait", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote });
    await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{otp_expires_at}',to_jsonb((clock_timestamp() + interval '1 second')::text))`;
    const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$queryRaw`SELECT pg_sleep(1.1)::text`, false,
      () => adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_email_verified" } }), 0);
  });
  await resetEmailOtp();
  await check("waiting email OTP refuses an intervening real payment journal", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-email-payment',${scope.merchantId},${scope.sessionId},'synthetic-email-payment-key',11800,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.verifyEmailOtp(scope, { expectedVersion: 5, code: "123456" }));
    assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_email_verified" } }), 0);
  });
  await resetManualShipping();
  await check("manual flat quote atomically commits unselected options with accepted provenance through PostgreSQL jsonb", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); const before = await row();
    const ack = await adapter.quoteManualShipping(scope, { expectedVersion: 5 }), saved = await row();
    assert.equal(ack.persistenceVersion, 6); assert.equal(saved.version, 6); assert.equal(saved.shipping, null);
    assert.equal(saved.shippingOptions.origin, "widget_checkout_manual"); assert.equal(saved.shippingOptions.buyerId, "synthetic-buyer");
    assert.equal(saved.shippingOptions.options[0].price, 900); assert.equal(saved.shippingOptions.options[0].eta_days, 1);
    assert.equal(Date.parse(saved.shippingOptions.expiresAt) - Date.parse(saved.shippingOptions.issuedAt), 1_800_000);
    assert.deepEqual(saved.cart._widgetCrossSellAcceptance.quote, before.cart._widgetCrossSellAcceptance.quote);
    assert.equal(saved.cart._widgetCrossSellAcceptance.revision.operation, "manual_shipping_quote");
    assert.equal((await adapter.readAccepted(scope)).total, 118); assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
    const event = await prisma.checkoutEvent.findFirstOrThrow({ where: { ...scope, eventName: "cross_sell_checkout_manual_shipping_quoted" } });
    assert.ok(!JSON.stringify(event.metadata).includes(address.zip)); assert.ok(!JSON.stringify(saved.shippingOptions).includes(address.zip));
  });
  for (const covered of [true, false]) {
    await resetManualShipping();
    await check(`manual neighborhood quote uses owned exact district, coverage=${covered}`, async () => {
      await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='neighborhood', neighborhoods=${JSON.stringify([
        { name: "Cheaper other district", priceCents: 1 }, { name: covered ? "  SYNTHETIC DISTRICT  " : "Not covered", priceCents: 1375 }])}::jsonb`;
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      const saved = await row(); assert.equal(saved.shippingOptions.options.length, covered ? 1 : 0);
      if (covered) assert.equal(saved.shippingOptions.options[0].price, 1375);
      assert.equal(saved.shipping, null); assert.equal((await adapter.readAccepted(scope)).total, 118);
    });
  }
  for (const changedLocality of [{ city: "Another Synthetic City", state: "SP" }, { city: address.city, state: "RJ" }]) {
    await resetManualShipping();
    await check(`manual neighborhood homonym outside origin locality has no coverage ${changedLocality.state}/${changedLocality.city}`, async () => {
      await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='neighborhood', neighborhoods='[{"name":"Synthetic District","priceCents":1375}]'::jsonb`;
      await prisma.merchant.update({ where: { id: scope.merchantId }, data: {
        storeSettings: { company: { address: { zip: "01310000", ...changedLocality } } },
      } });
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
      await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      const saved = await row();
      assert.deepEqual(saved.shippingOptions.options, []);
      assert.equal(saved.shipping, null);
      assert.equal((await adapter.readAccepted(scope)).total, 118);
    });
  }
  for (const freeAbove of [11799, 11800, 11801]) {
    await resetManualShipping();
    await check(`manual free boundary ${freeAbove} quotes canonical discounted subtotal but never selects/grants subsidy`, async () => {
      await prisma.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=${freeAbove}`;
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      const saved = await row(); assert.equal(saved.shippingOptions.options[0].price, freeAbove <= 11800 ? 0 : 900);
      assert.equal(saved.shippingOptions.options[0].original_price, freeAbove <= 11800 ? 900 : undefined);
      assert.equal(saved.shipping, null); assert.equal((await adapter.readAccepted(scope)).total, 118);
    });
  }
  for (const change of ["price", "disabled", "deleted"]) {
    await resetManualShipping();
    await check(`manual quotation rereads ${change} after an observed real configuration row-lock wait`, async () => {
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); const before = await row();
      const result = await withBlockedManualQuote(adapter, tx => change === "price"
        ? tx.$executeRaw`UPDATE own_delivery_configs SET flat_price_cents=1400`
        : change === "disabled" ? tx.$executeRaw`UPDATE own_delivery_configs SET enabled=false` : tx.$executeRaw`DELETE FROM own_delivery_configs`);
      assert.equal(result.ok, change === "price");
      if (result.ok) { assert.equal((await row()).shippingOptions.options[0].price, 1400); assert.equal((await adapter.readAccepted(scope)).total, 118); }
      else { assert.deepEqual(await row(), before); assert.equal(await prisma.checkoutEvent.count({ where: { eventName: "cross_sell_checkout_manual_shipping_quoted" } }), 0); }
    });
  }
  await resetManualShipping();
  await check("same-version actual manual quote and address change serialize to one winner", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    const result = await Promise.allSettled([adapter.quoteManualShipping(scope, { expectedVersion: 5 }),
      adapter.updateAddress(scope, { expectedVersion: 5, address: { ...address, number: "99" } })]);
    assert.equal(result.filter(item => item.status === "fulfilled").length, 1); assert.equal((await row()).version, 6);
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await resetManualShipping();
  await check("real manual quote event-trigger failure rolls back options/session/context/revision", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); const before = await row();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_manual_event_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_name='cross_sell_checkout_manual_shipping_quoted' THEN RAISE EXCEPTION 'synthetic_manual_event_failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_manual_event_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_manual_event_failure()`);
    try { await assert.rejects(adapter.quoteManualShipping(scope, { expectedVersion: 5 })); assert.deepEqual(await row(), before); }
    finally { await prisma.$executeRawUnsafe(`DROP TRIGGER synthetic_manual_event_failure ON checkout_events`); await prisma.$executeRawUnsafe(`DROP FUNCTION synthetic_manual_event_failure()`); }
  });
  await resetManualShipping();
  await check("manual lost ACK after actual COMMIT has read-only reconciliation, no retry/replay", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); let transactions = 0;
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      transactions++; await prisma.$transaction(work, options); throw new Error("synthetic_lost_manual_commit_ack");
    } });
    await assert.rejects(lostAck.quoteManualShipping(scope, { expectedVersion: 5 }), /synthetic_lost_manual_commit_ack/);
    const saved = await row(); assert.equal(transactions, 1); assert.equal(saved.version, 6); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.quoteManualShipping(scope, { expectedVersion: 5 })); assert.deepEqual(await row(), saved);
  });
  for (const corruption of ["options", "event-kind", "revision-kind"]) {
    await resetManualShipping();
    await check(`manual quote refuses actual corrupted ${corruption} without repair`, async () => {
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      if (corruption === "options") await prisma.$executeRaw`UPDATE checkout_sessions SET shipping_options=jsonb_set(shipping_options,'{options,0,price}','1'::jsonb)`;
      if (corruption === "event-kind") await prisma.$executeRaw`UPDATE checkout_events SET event_name='cross_sell_checkout_customer_updated' WHERE event_name='cross_sell_checkout_manual_shipping_quoted'`;
      if (corruption === "revision-kind") await prisma.$executeRaw`UPDATE checkout_sessions SET cart=cart #- '{_widgetCrossSellAcceptance,revision,operation}'`;
      const saved = await row(); await assert.rejects(adapter.readAccepted(scope), /cross_sell_quote_review_required/); assert.deepEqual(await row(), saved);
    });
  }
  await resetManualShipping();
  await check("waiting manual quote refuses intervening real payment journal before shipping mutation", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-manual-payment',${scope.merchantId},${scope.sessionId},'synthetic-manual-payment-key',11800,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.quoteManualShipping(scope, { expectedVersion: 5 }));
    assert.deepEqual(await row(), before);
  });
  await resetManualShipping();
  await check("waiting manual quote rejects stale accepted goods after current catalog price changes", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const before = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`, false,
      () => adapter.quoteManualShipping(scope, { expectedVersion: 5 }));
    assert.deepEqual(await row(), before);
  });
  await resetManualShipping();
  await check("manual quote preserves accepted P+D, never invents delivery cost, and address revision removes quote", async () => {
    await prisma.$executeRaw`UPDATE products SET metadata='{"optionGroups":[{"id":"size","name":"Tamanho","required":true,"selectionType":"single","items":[{"id":"large","name":"Grande","priceModifierInCents":500}]}]}'::jsonb WHERE id='target-product'`;
    await prisma.$executeRaw`UPDATE product_stock SET quantity=1 WHERE variant_id='target'`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, { ...request, selectedOptionItemIds: ["large"] }) });
    await adapter.quoteManualShipping(scope, { expectedVersion: 5 }); const saved = await row();
    assert.equal((await adapter.readAccepted(scope)).total, 122.5); assert.equal(saved.cart.total, 125); assert.equal(saved.shipping, null);
    assert.equal(JSON.stringify(saved.shippingOptions).includes("realCost"), false);
    await adapter.updateAddress(scope, { expectedVersion: 6, address: { ...address, number: "99" } });
    assert.equal((await row()).shippingOptions, null); assert.equal((await adapter.readAccepted(scope)).total, 122.5);
  });
  const manualSelection = async () => {
    const saved = await row(); return { expectedVersion: saved.version, quoteId: saved.shippingOptions.id, carrierKey: saved.shippingOptions.options[0].carrier_key };
  };
  await resetManualShipping();
  await check("manual fixed selection atomically commits current quote and reads sanitized shipping without fabricated realCost", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const ack = await adapter.selectManualShipping(scope, await manualSelection()), saved = await row();
    assert.equal(ack.persistenceVersion, 7); assert.equal(saved.cart._widgetCrossSellAcceptance.revision.operation, "manual_shipping_select");
    assert.deepEqual(await adapter.readAcceptedShipping(scope), { customerPrice: 9, carrier: "own_delivery_flat", method: "Entrega própria",
      deliveryDays: 1, destinationZip: address.zip, region: "SP" });
    assert.equal(saved.shipping.realCost, undefined); assert.equal((await adapter.readAccepted(scope)).total, 118);
    assert.deepEqual(await counts(), { outbox: 1, events: 1, accepted: 1 });
  });
  await resetManualShipping();
  await check("manual neighborhood selection cannot select cheaper unrelated district", async () => {
    await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='neighborhood', neighborhoods='[{"name":"Synthetic District","priceCents":1375},{"name":"Other","priceCents":1}]'::jsonb`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const selection = await manualSelection();
    await assert.rejects(adapter.selectManualShipping(scope, { ...selection, carrierKey: "own_delivery_neighborhood_other" }));
    await adapter.selectManualShipping(scope, selection); assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 13.75);
  });
  await resetManualShipping();
  await check("manual neighborhood read refuses changed origin locality without rewriting selected money", async () => {
    await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='neighborhood', neighborhoods='[{"name":"Synthetic District","priceCents":1375}]'::jsonb`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    await adapter.selectManualShipping(scope, await manualSelection());
    const selected = await row(), previousCounts = await counts();
    await prisma.merchant.update({ where: { id: scope.merchantId }, data: {
      storeSettings: { company: { address: { zip: "01310000", city: "Another Synthetic City", state: "SP" } } },
    } });
    await assert.rejects(adapter.readAcceptedShipping(scope), /cross_sell_quote_review_required/);
    assert.deepEqual(await row(), selected);
    assert.deepEqual(await counts(), previousCounts);
  });
  await resetManualShipping();
  await check("manual no-coverage cannot be selected as flat or carrier", async () => {
    await prisma.$executeRaw`UPDATE own_delivery_configs SET mode='neighborhood', neighborhoods='[{"name":"Other","priceCents":1}]'::jsonb`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const saved = await row();
    for (const carrierKey of ["own_delivery_flat", "own_delivery_neighborhood_other", "PAC"])
      await assert.rejects(adapter.selectManualShipping(scope, { expectedVersion: 6, quoteId: saved.shippingOptions.id, carrierKey }));
    assert.deepEqual(await row(), saved); assert.equal(await adapter.readAcceptedShipping(scope), null);
  });
  await resetManualShipping();
  await check("manual configured waiver is authorized against current shipping flags/subsidy and product promotions exactly once", async () => {
    await prisma.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=11800`;
    await prisma.$executeRaw`UPDATE merchant_rules SET allow_free_shipping=true,allow_stack_discount_and_free_shipping=true,
      max_shipping_subsidy=9,free_shipping_min_cart_value=118`;
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    await adapter.selectManualShipping(scope, await manualSelection());
    assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 0); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await prisma.$executeRaw`UPDATE merchant_rules SET allow_stack_discount_and_free_shipping=false`;
    await assert.rejects(adapter.readAcceptedShipping(scope), /cross_sell_quote_review_required/);
  });
  for (const condition of ["free-disabled", "stack-disabled", "subsidy", "minimum", "blocked-region"]) {
    await resetManualShipping();
    await check(`manual waiver refuses actual current ${condition} with no paid fallback`, async () => {
      await prisma.$executeRaw`UPDATE own_delivery_configs SET free_above_cents=11800`;
      await prisma.$executeRaw`UPDATE merchant_rules SET allow_free_shipping=true,allow_stack_discount_and_free_shipping=true,
        max_shipping_subsidy=9,free_shipping_min_cart_value=118`;
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      if (condition === "free-disabled") await prisma.$executeRaw`UPDATE merchant_rules SET allow_free_shipping=false`;
      if (condition === "stack-disabled") await prisma.$executeRaw`UPDATE merchant_rules SET allow_stack_discount_and_free_shipping=false`;
      if (condition === "subsidy") await prisma.$executeRaw`UPDATE merchant_rules SET max_shipping_subsidy=8.99`;
      if (condition === "minimum") await prisma.$executeRaw`UPDATE merchant_rules SET free_shipping_min_cart_value=118.01`;
      if (condition === "blocked-region") await prisma.$executeRaw`UPDATE merchant_rules SET blocked_regions=ARRAY['SP']::text[]`;
      const saved = await row(); await assert.rejects(adapter.selectManualShipping(scope, await manualSelection())); assert.deepEqual(await row(), saved);
    });
  }
  for (const changed of ["price", "disabled"]) {
    await resetManualShipping();
    await check(`waiting manual selection refuses ${changed} after observed actual configuration lock`, async () => {
      await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
      const saved = await row(), selection = await manualSelection();
      const result = await withBlockedManualQuote(adapter, tx => changed === "price" ? tx.$executeRaw`UPDATE own_delivery_configs SET flat_price_cents=1400`
        : tx.$executeRaw`UPDATE own_delivery_configs SET enabled=false`, () => adapter.selectManualShipping(scope, selection));
      assert.equal(result.ok, false); assert.deepEqual(await row(), saved);
    });
  }
  await resetManualShipping();
  await check("same-version actual manual selection/address commands have one winner", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const selection = await manualSelection(), results = await Promise.allSettled([adapter.selectManualShipping(scope, selection),
      adapter.updateAddress(scope, { expectedVersion: 6, address: { ...address, number: "99" } })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal((await row()).version, 7);
    await adapter.updateAddress(scope, { expectedVersion: 7, address: { ...address, number: "100" } });
    assert.equal(await adapter.readAcceptedShipping(scope), null); assert.equal((await row()).shippingOptions, null);
  });
  await resetManualShipping();
  await check("manual selection event trigger failure rolls back selected price/context/revision", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const saved = await row(), selection = await manualSelection();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_manual_select_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_name='cross_sell_checkout_manual_shipping_selected' THEN RAISE EXCEPTION 'synthetic_manual_select_failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_manual_select_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_manual_select_failure()`);
    try { await assert.rejects(adapter.selectManualShipping(scope, selection)); assert.deepEqual(await row(), saved); }
    finally { await prisma.$executeRawUnsafe(`DROP TRIGGER synthetic_manual_select_failure ON checkout_events`); await prisma.$executeRawUnsafe(`DROP FUNCTION synthetic_manual_select_failure()`); }
  });
  await resetManualShipping();
  await check("manual selection lost ACK after actual COMMIT reconciles read-only and cannot replay", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const selection = await manualSelection(); let transactions = 0;
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      transactions++; await prisma.$transaction(work, options); throw new Error("synthetic_lost_manual_selection_ack");
    } });
    await assert.rejects(lostAck.selectManualShipping(scope, selection), /synthetic_lost_manual_selection_ack/); assert.equal(transactions, 1);
    const saved = await row(); assert.equal((await adapter.readAcceptedShipping(scope)).customerPrice, 9);
    await assert.rejects(adapter.selectManualShipping(scope, selection)); assert.deepEqual(await row(), saved);
  });
  await resetManualShipping();
  await check("manual canonical shipping read refuses actual current configuration change", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    await adapter.selectManualShipping(scope, await manualSelection());
    await prisma.$executeRaw`UPDATE own_delivery_configs SET estimated_value=2,estimated_unit='days'`;
    const saved = await row(); await assert.rejects(adapter.readAcceptedShipping(scope), /cross_sell_quote_review_required/); assert.deepEqual(await row(), saved);
  });
  await resetManualShipping();
  await check("waiting manual selection rejects intervening real payment journal", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); await adapter.quoteManualShipping(scope, { expectedVersion: 5 });
    const saved = await row(), selection = await manualSelection();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-manual-select-payment',${scope.merchantId},${scope.sessionId},'synthetic-manual-select-payment-key',12700,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.selectManualShipping(scope, selection));
    assert.deepEqual(await row(), saved);
  });
  const issueOtp = async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    return adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" });
  };
  await resetAddress();
  await check("OTP issuance atomically stores current challenge/version/event/private reference with no dispatch", async () => {
    const ack = await issueOtp(), saved = await row(), delivery = await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: ack.deliveryId } });
    assert.equal(saved.version, 6); assert.equal(ack.persistenceVersion, 6); assert.equal(delivery.status, "otp_pending"); assert.equal(delivery.attempts, 0);
    assert.match(saved.customer.otp_code, /^[1-9]\d{5}$/); assert.equal(Date.parse(saved.customer.otp_expires_at) - Date.parse(saved.customer.otp_issued_at), 600_000);
    assert.equal(saved.cart._widgetCrossSellAcceptance.revision.operation, "email_otp_issue"); assert.equal((await adapter.readAccepted(scope)).total, 118);
    for (const value of [contact.email, saved.customer.otp_code]) {
      assert.equal(JSON.stringify(ack).includes(value), false); assert.equal(JSON.stringify(delivery).includes(value), false);
    }
    assert.notEqual(saved.customer.email_verified, true);
  });
  await resetAddress();
  await check("OTP issue reuses unexpired reference without a new code/version/outbox", async () => {
    const first = await issueOtp(), saved = await row(), outboxes = await prisma.outboxMessage.count();
    assert.deepEqual(await adapter.requestEmailOtp(scope, { expectedVersion: 6, action: "issue" }), first);
    assert.deepEqual(await row(), saved); assert.equal(await prisma.outboxMessage.count(), outboxes);
  });
  await resetAddress();
  await check("concurrent OTP claims grant credentials only once after durable real commit", async () => {
    const issued = await issueOtp(), input = { expectedVersion: 6, deliveryId: issued.deliveryId };
    const results = await Promise.all([adapter.claimEmailOtpDelivery(scope, input), adapter.claimEmailOtpDelivery(scope, input)]);
    assert.equal(results.filter(value => value.kind === "claimed").length, 1); assert.equal(results.filter(value => value.kind === "settled").length, 1);
    const delivery = await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: issued.deliveryId } });
    assert.equal(delivery.status, "otp_sending"); assert.equal(delivery.attempts, 1); assert.equal((await row()).version, 6);
  });
  for (const outcome of ["sending", "sent", "unknown"]) {
    await resetAddress();
    await check(`current OTP possession verifies after initiated attempt (${outcome}), not pending or wrong code`, async () => {
      const issued = await issueOtp(), code = (await row()).customer.otp_code;
      await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 6, code }));
      const claim = await adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: issued.deliveryId }); assert.equal(claim.kind, "claimed");
      if (outcome !== "sending") await adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken,
        outcome: outcome === "sent" ? { status: "sent", providerMessageId: "synthetic-provider-id" } : { status: "unknown" } });
      await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 6, code: "000000" }));
      await adapter.verifyEmailOtp(scope, { expectedVersion: 6, code }); const saved = await row();
      assert.equal(saved.customer.email_verified, true); assert.equal(saved.customer.otp_delivery_id, undefined); assert.equal(saved.customer.otp_code, "");
      assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: claim.deliveryId } })).status, `otp_${outcome}`);
      assert.equal((await adapter.readAccepted(scope)).total, 118);
      if (outcome === "sending") await adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken,
        outcome: { status: "sent", providerMessageId: "synthetic-late-provider" } });
    });
  }
  await resetAddress();
  await check("explicit OTP resend cancels pending old reference and atomically replaces current challenge", async () => {
    const first = await issueOtp(), second = await adapter.requestEmailOtp(scope, { expectedVersion: 6, action: "resend" });
    assert.notEqual(second.deliveryId, first.deliveryId); assert.equal(second.persistenceVersion, 7);
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: first.deliveryId } })).status, "otp_cancelled");
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: second.deliveryId } })).status, "otp_pending");
    await assert.rejects(adapter.claimEmailOtpDelivery(scope, { expectedVersion: 7, deliveryId: first.deliveryId }));
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await resetAddress();
  await check("contact correction cancels only unsent OTP with scoped receipt revision", async () => {
    const issued = await issueOtp(); await adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, email: "other@example.test" } });
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: issued.deliveryId } })).status, "otp_cancelled");
    const saved = await row(); for (const key of ["otp_code", "otp_expires_at", "otp_delivery_id", "otp_delivery_email", "otp_issued_at"]) assert.equal(saved.customer[key], undefined);
    assert.equal((await adapter.readAccepted(scope)).total, 118);
  });
  await resetAddress();
  await check("old OTP send can complete after email/catalog changes without verifying the new identity", async () => {
    const issued = await issueOtp(), claim = await adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: issued.deliveryId });
    assert.equal(claim.kind, "claimed"); await adapter.updateCustomer(scope, { expectedVersion: 6, customer: { ...contact, email: "other@example.test" } });
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=3000 WHERE variant_id='target'`;
    await adapter.completeEmailOtpDelivery(scope, { deliveryId: claim.deliveryId, claimToken: claim.claimToken, outcome: { status: "sent", providerMessageId: "synthetic" } });
    const saved = await row(); assert.equal(saved.customer.email, "other@example.test"); assert.equal(saved.customer.email_verified, false);
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: issued.deliveryId } })).status, "otp_sent");
    await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 7, code: claim.code }));
  });
  await resetAddress();
  await check("OTP event trigger failure rolls back challenge/revision/session and private outbox", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); const saved = await row(), outboxes = await prisma.outboxMessage.count();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_otp_issue_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event_name='cross_sell_checkout_email_otp_issued' THEN RAISE EXCEPTION 'synthetic_otp_issue_failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_otp_issue_failure BEFORE INSERT ON checkout_events FOR EACH ROW EXECUTE FUNCTION synthetic_otp_issue_failure()`);
    try { await assert.rejects(adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }));
      assert.deepEqual(await row(), saved); assert.equal(await prisma.outboxMessage.count(), outboxes); }
    finally { await prisma.$executeRawUnsafe(`DROP TRIGGER synthetic_otp_issue_failure ON checkout_events`); await prisma.$executeRawUnsafe(`DROP FUNCTION synthetic_otp_issue_failure()`); }
  });
  await resetAddress();
  await check("concurrent same-version OTP issuance has one persisted challenge and technical reference", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) });
    const results = await Promise.allSettled([adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }),
      adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal((await row()).version, 6);
    assert.equal(await prisma.outboxMessage.count({ where: { eventType: "checkout.email_otp.delivery.requested" } }), 1);
  });
  await resetAddress();
  await check("OTP actual commit with lost issuance/claim ACK cannot mint or dispatch twice", async () => {
    await adapter.accept(scope, { expectedQuote: await adapter.quote(scope, request) }); let transactions = 0;
    const lostAck = new PrismaWidgetCrossSellCheckoutAdapter({ async $transaction(work, options) {
      transactions++; await prisma.$transaction(work, options); throw new Error("synthetic_otp_lost_ack");
    } });
    await assert.rejects(lostAck.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }), /synthetic_otp_lost_ack/);
    const saved = await row(); assert.equal(transactions, 1); assert.equal((await adapter.readAccepted(scope)).total, 118);
    await assert.rejects(adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }));
    const reference = { expectedVersion: 6, deliveryId: saved.customer.otp_delivery_id };
    await assert.rejects(lostAck.claimEmailOtpDelivery(scope, reference), /synthetic_otp_lost_ack/); assert.equal(transactions, 2);
    const replay = await adapter.claimEmailOtpDelivery(scope, reference); assert.equal(replay.kind, "settled"); assert.equal(replay.status, "unknown");
    assert.equal((await prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: reference.deliveryId } })).attempts, 1);
  });
  await resetAddress();
  await check("waiting OTP issuance refuses intervening actual payment journal", async () => {
    const expectedQuote = await adapter.quote(scope, request); await adapter.accept(scope, { expectedQuote }); const saved = await row();
    await withBlockedAccept(adapter, expectedQuote, tx => tx.$executeRaw`INSERT INTO payment_intents(id,merchant_id,session_id,idempotency_key,amount_cents,currency,method,status,updated_at)
      VALUES ('synthetic-intervening-otp-issue-payment',${scope.merchantId},${scope.sessionId},'synthetic-otp-issue-payment-key',11800,'BRL','pix','pending',CURRENT_TIMESTAMP)`, false,
      () => adapter.requestEmailOtp(scope, { expectedVersion: 5, action: "issue" }));
    assert.deepEqual(await row(), saved); assert.equal(await prisma.outboxMessage.count({ where: { eventType: "checkout.email_otp.delivery.requested" } }), 0);
  });
  await resetAddress();
  await check("actual corruption of OTP journal refuses claim/verification without repair", async () => {
    const issued = await issueOtp(), code = (await row()).customer.otp_code;
    await prisma.$executeRaw`UPDATE outbox_messages SET payload=jsonb_set(payload,'{acceptanceEventId}','"foreign"'::jsonb) WHERE event_id=${issued.deliveryId}`;
    const saved = await row(); await assert.rejects(adapter.claimEmailOtpDelivery(scope, { expectedVersion: 6, deliveryId: issued.deliveryId }));
    await assert.rejects(adapter.verifyEmailOtp(scope, { expectedVersion: 6, code })); assert.deepEqual(await row(), saved);
  });
  await check("payment reader proves actual committed own journal without writes, while generic reader still refuses", async () => {
    const { paymentId } = await syntheticOwnPayment(), before = await row(), previousCounts = await counts();
    await assert.rejects(adapter.readAccepted(scope));
    const current = await readPaymentCheckout({ ownPaymentIntentId: paymentId });
    assert.equal(current.projectedCart.total, 118); assert.equal(current.selectedShipping.customerPrice, 9);
    assert.deepEqual(await row(), before); assert.deepEqual(await counts(), previousCounts);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: paymentId } })).version, 1);
  });
  await check("payment reader never excludes another active journal or a caller-invented own id", async () => {
    const { paymentId } = await syntheticOwnPayment();
    await assert.rejects(readPaymentCheckout({ ownPaymentIntentId: "synthetic-foreign" }));
    await prisma.paymentIntent.create({ data: { id: "synthetic-other-payment", ...scope, idempotencyKey: "other-key", amountCents: 12849,
      currency: "BRL", method: "pix", status: "pending", statusHistory: [] } });
    await assert.rejects(readPaymentCheckout({ ownPaymentIntentId: paymentId }));
    assert.equal(await prisma.paymentIntent.count(), 2);
  });
  for (const change of ["buyer", "version", "context", "config", "catalog", "provider", "started", "unknown", "sibling"]) {
    await check(`actual own journal cannot bypass changed current authority (${change})`, async () => {
      const { paymentId } = await syntheticOwnPayment();
      if (change === "buyer") await prisma.$executeRaw`UPDATE checkout_sessions SET global_user_id='synthetic-other-buyer'`;
      if (change === "version") await prisma.$executeRaw`UPDATE checkout_sessions SET version=version+1`;
      if (change === "context") await prisma.$executeRaw`UPDATE checkout_sessions SET customer=jsonb_set(customer,'{phone}','"11911111111"'::jsonb)`;
      if (change === "config") await prisma.$executeRaw`UPDATE own_delivery_configs SET flat_price_cents=901`;
      if (change === "catalog") await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=2001 WHERE variant_id='target'`;
      if (change === "provider") await prisma.$executeRaw`UPDATE payment_intents SET provider_payment_id='synthetic-provider' WHERE id=${paymentId}`;
      if (change === "started") await prisma.$executeRaw`UPDATE payment_intents SET creation=jsonb_set(creation,'{firstAttemptAt}',to_jsonb(clock_timestamp()::text)) WHERE id=${paymentId}`;
      if (change === "unknown") await prisma.$executeRaw`UPDATE payment_intents SET creation=jsonb_set(creation,'{state}','"uncertain"'::jsonb) WHERE id=${paymentId}`;
      if (change === "sibling") await prisma.$executeRaw`UPDATE payment_intents SET creation=creation-'widgetCheckoutAuthority' WHERE id=${paymentId}`;
      const before = await row(), previousCounts = await counts();
      await assert.rejects(readPaymentCheckout({ ownPaymentIntentId: paymentId }));
      assert.deepEqual(await row(), before); assert.deepEqual(await counts(), previousCounts);
    });
  }
  await check("waiting first-send reader sees actual intervening payment attempt under merchant fence", async () => {
    const { paymentId } = await syntheticOwnPayment(), saved = await row();
    await withBlockedAccept(adapter, undefined,
      tx => tx.$executeRaw`UPDATE payment_intents SET creation=jsonb_set(creation,'{state}','"in_flight"'::jsonb) WHERE id=${paymentId}`,
      false, () => readPaymentCheckout({ ownPaymentIntentId: paymentId }));
    assert.deepEqual(await row(), saved);
  });
  const { runWidgetCheckoutPaymentNativeCases } = await import("./widget-checkout-payment.native-cases.mjs");
  await runWidgetCheckoutPaymentNativeCases({ prisma, scope, adapter, resetManualShipping, request, contact, address, check, runId });
  const { runWidgetProviderRadiusNativeCases } = await import("./widget-provider-radius.native-cases.mjs");
  await runWidgetProviderRadiusNativeCases({ prisma, scope, adapter, resetManualShipping, request, contact, address, check, runId,
    observeWaiters: () => { waiters++; } });
  console.log(JSON.stringify({ status: "passed", passed, realLockWaiters: waiters, syntheticOnly: true, providerCalls: 0 }));
} catch (error) { console.error(JSON.stringify({ status: "failed", test: active, passed, realLockWaiters: waiters, error: String(error) })); throw error; }
finally { await prisma.$disconnect(); }
