import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";
const legacyBasisOnly = process.argv[4] === "--legacy-basis-only";
const [url, runId] = process.argv.slice(2); assert.equal(process.argv.length, legacyBasisOnly ? 5 : 4);
const parsed = assertNativePrismaUrl(url); assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_coupon_admission_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
const { ResumePaymentCreationService } = await import("../src/modules/payment/application/resume-payment-creation.service.ts");
const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
const { PrismaBoundCouponRedemption } = await import("../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts");
const { CouponsOnOrderCompletedHandler } = await import("../src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts");
const { RedeemCouponUseCase } = await import("../src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts");
const { PrismaCouponTransactionRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
const { InMemoryDomainEventBus } = await import("../src/shared/events/in-memory-domain-event-bus.ts");
const { captureStorefrontCouponForPayment } = await import("../src/modules/coupons/infrastructure/repositories/prisma-storefront-coupon-admission.ts");
const { PaymentCreationRejectedError } = await import("../src/modules/payment/domain/payment-creation-rejected.error.ts");
const { CouponRedemptionEntity } = await import("../src/modules/coupons/domain/entities/coupon-redemption.entity.ts");
const { toCouponEntity } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon.converters.ts");
const { createCouponEventEnvelope } = await import("../src/modules/coupons/domain/events/coupon-domain-event.ts");
const { lockStorefrontCart } = await import("../src/shared/persistence/storefront-cart-lock.ts");
const { readStorefrontCheckoutBindingOwners } = await import("../src/modules/storefront/infrastructure/repositories/storefront-checkout-binding-fence.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 20_000, maxWait: 15_000 } });
const merchantId = "synthetic-admission-merchant", cartId = "synthetic-admission-cart", buyerId = "synthetic-buyer";
const cart = () => ({ currency: "BRL", source: "storefront", cart_ref: cartId, total: 100, currentDiscount: 10,
  commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Synthetic", couponCode: "SAVE10" },
  items: [{ sku: "SYNTHETIC", variantId: "synthetic-variant", product_id: "synthetic-product", variant: JSON.stringify(["synthetic-variant", []]),
    name: "Synthetic item", quantity: 1, price: 100 }] });
const shipping = () => ({ customerPrice: 5, realCost: 5, region: "SP" });
const scope = sessionId => ({ merchantId, checkoutSessionId: sessionId, cartId, buyerId });
const payments = new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment);
const intent = (sessionId = "checkout_1", suffix = "", paymentProvider = "asaas") => {
  const value = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "synthetic-" + sessionId + suffix,
    amountCents: 9599, currency: "BRL", method: "pix", amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000,
      discountCents: 1000, shippingCents: 500, platformFeeCents: 99, totalCents: 9599, cartFingerprint: paymentCartFingerprint({ cart: cart(), shipping: shipping() }) } });
  value.prepareCreation({ intentId: value.id, merchantId, sessionId, amountCents: 9599, currency: "BRL", method: "pix", provider: paymentProvider });
  return value;
};
const plan = value => ({ merchantId, paymentIntentId: value.id, provider: value.snapshot().creation.input.provider, currency: "BRL", providerReference: "synthetic-" + value.id,
  plannedGrossCents: 9599, plannedPlatformFeeCents: 99, plannedMerchantNetCents: 9500, plannedProviderFeeCents: 0, occurredAt: new Date(0),
  entries: [{ entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 99 },
    { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", recipientReference: merchantId, plannedAmountCents: 9500 }] });
const admit = (value, repository = payments) => repository.saveIntentWithSettlementPlan({ intent: value, settlementPlan: plan(value), storefrontCouponScope: scope(value.snapshot().sessionId) });
const seed = async (count = 1) => {
  await prisma.$executeRaw`TRUNCATE synthetic_bound_faults,payment_settlement_entries,payment_settlements,outbox_messages,payment_intents,completed_orders,checkout_sessions,
    coupon_redemptions,coupons,storefront_carts,merchant_rules,merchants CASCADE`;
  await prisma.merchant.create({ data: { id: merchantId, name: "Synthetic only" } });
  await prisma.merchantRule.create({ data: { merchantId, maxDiscountPercent: 15, minimumMarginPercent: 99, allowFreeShipping: false,
    allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false, couponBoxEnabled: true,
    freeShippingMinCartValue: 0, maxShippingSubsidy: 0, maxPartialShippingDiscount: 0, offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "neutral" } });
  for (let index = 1; index <= count; index++) await prisma.checkoutSession.create({ data: { merchantId, sessionId: "checkout_" + index,
    globalUserId: buyerId, conversationId: "synthetic-conversation-" + index, cart: cart(), shipping: shipping(),
    customer: { email: "buyer@example.invalid", email_verified: true }, createdAt: new Date(0), updatedAt: new Date(0) } });
  await prisma.storefrontCart.create({ data: { merchantId, sessionId: cartId, couponCode: "SAVE10", discount: 1000, total: 10000,
    expiresAt: new Date(Date.now() + 3600000), items: [{ variantId: "synthetic-variant", productId: "synthetic-product", sku: "SYNTHETIC",
      name: "Synthetic item", quantity: 1, unitPriceCents: 10000 }] } });
  await prisma.coupon.create({ data: { id: "synthetic-coupon", merchantId, code: "SAVE10", discountType: "percent", discountValue: 10,
    maxUsages: 100, startsAt: new Date(0) } });
  await prisma.couponRedemption.create({ data: { id: "synthetic-reservation", merchantId, sessionId: cartId, couponId: "synthetic-coupon",
    discountApplied: 10, source: "manual", status: "applied" } });
};
const state = async () => ({ checkouts: await prisma.checkoutSession.findMany({ orderBy: { sessionId: "asc" } }), payments: await prisma.paymentIntent.findMany({ orderBy: { id: "asc" } }),
  carts: await prisma.storefrontCart.findMany({ orderBy: { sessionId: "asc" } }),
  settlements: await prisma.paymentSettlement.findMany({ orderBy: { id: "asc" } }), redemptions: await prisma.couponRedemption.findMany(), coupons: await prisma.coupon.findMany(),
  outbox: await prisma.outboxMessage.findMany({ orderBy: { eventId: "asc" } }) });
const provider = () => { const calls = []; return { calls, async createPayment(input) {
  calls.push(structuredClone(input)); for (const key of ["couponAuthority", "coupon_authority", "_storefrontCouponBinding"]) assert.equal(Object.hasOwn(input, key), false);
  return { providerPaymentId: "synthetic-provider-" + input.intentId, buyerFacingPayload: { qrCodeCopyPaste: "synthetic-qr" } };
}, async recoverPayment() { throw new Error("unexpected_provider_recovery"); } }; };
let checks = 0, active = "marker", maxWaiters = 0;
const check = async (name, work) => { active = name; await work(); checks++; console.log(JSON.stringify({ test: name, status: "passed" })); };
const conflict = error => error?.message === "checkout_coupon_binding_conflict";
const rejectedPayment = async () => {
  const value = intent("checkout_1", "-definitive", "mercadopago"); await admit(value);
  let calls = 0;
  await assert.rejects(new ResumePaymentCreationService(payments, { async createPayment() {
    calls++; throw new PaymentCreationRejectedError("mercadopago_pix_key_required");
  } }).execute(value), error => error.message === "mercadopago_pix_key_required");
  assert.equal(calls, 1);
  const persisted = await payments.getIntentById(merchantId, value.id), snapshot = persisted.snapshot();
  assert.equal(snapshot.status, "failed"); assert.equal(snapshot.creation.state, "complete");
  assert.equal(snapshot.creation.reason, "mercadopago_pix_key_required"); assert.equal(snapshot.creation.leaseToken, undefined);
  return persisted;
};
const releaseReceipts = s => s.outbox.filter(event => event.eventType === "checkout.cart.updated" && event.payload.coupon_release);
try {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  if (legacyBasisOnly) {
    const { runStorefrontCouponSourceBasisNative } = await import("./storefront-coupon-source-basis.native-cases.mjs");
    await runStorefrontCouponSourceBasisNative({ prisma, runId, seed, check, merchantId, cartId, buyerId });
    console.log(JSON.stringify({ nativeCouponSourceBasisPassed: checks, phase: "legacy-basis-only", prismaClients: 1,
      actualPrismaRepositories: true, provider: "FAKE_NO_NETWORK", defaultAdmissionSuiteExecuted: false,
      actualBrowserJourney: false, productionAccess: false }));
  } else {
  await check("real admission binds original reservation, acknowledges entity, first-sends public provider input and consumes exact paid order", async () => {
    await seed(); const value = intent(); const before = value.snapshot(); assert.equal(before.creation.couponAuthority, undefined);
    await admit(value); const captured = value.snapshot().creation.couponAuthority; assert.ok(captured); assert.equal(captured.redemptionId, "synthetic-reservation");
    const rows = await prisma.checkoutSession.findMany(); assert.equal(rows[0].version, 1); assert.equal(rows[0].cart._storefrontCouponBinding.bindingId, captured.bindingId);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: value.id } })).creation.couponAuthority.bindingId, captured.bindingId);
    const fake = provider(); await new ResumePaymentCreationService(payments, fake).execute(value); assert.equal(fake.calls.length, 1);
    value.markApproved({ providerPaymentId: value.snapshot().providerPaymentId, approvedAmountCents: 9599 }); await payments.saveIntent({ intent: value });
    const repo = new PrismaCheckoutRepository(prisma), reader = new PrismaPaymentApprovalReader(prisma);
    const complete = new CompleteOrderUseCase(repo, repo, repo, undefined, undefined, undefined, undefined, repo,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reader);
    const request = { merchant_id: merchantId, session_id: "checkout_1", external_order_id: value.snapshot().providerPaymentId, order_total: 95, currency: "BRL" };
    await complete.executePaymentApproval(request, value.id);
    const event = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, eventType: "order.completed" } });
    assert.deepEqual(event.payload.coupon_authority, { ...captured, orderId: request.external_order_id });
    const bus = new InMemoryDomainEventBus();
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(new PrismaCouponTransactionRepository(prisma)), repo, new PrismaBoundCouponRedemption(prisma)).onModuleInit();
    const delivery = { eventId: event.eventId, eventType: event.eventType, merchantId, payload: event.payload };
    await bus.publish(delivery); await bus.publish(delivery);
    const s = await state(); assert.equal(s.redemptions[0].sessionId, cartId); assert.equal(s.redemptions[0].status, "redeemed"); assert.equal(s.coupons[0].usagesCount, 1);
    assert.equal(s.outbox.filter(e => e.eventType === "coupon.redeemed").length, 1); assert.equal(s.settlements.length, 1);
    assert.equal(Object.hasOwn((await repo.getSession(merchantId, "checkout_1")).cart, "_storefrontCouponBinding"), false);
  });
  await check("settlement SQL failure rolls back binding/version, payment and ledger and does not acknowledge entity", async () => {
    await seed(); await prisma.$executeRaw`INSERT INTO synthetic_bound_faults(kind) VALUES('settlement')`;
    const value = intent(), before = await state(), entity = value.snapshot(); await assert.rejects(admit(value));
    assert.deepEqual(await state(), before); assert.deepEqual(value.snapshot(), entity);
  });
  await check("unbound storefront coupon cannot enter a legacy journal without private authenticated scope", async () => {
    await seed(); const value = intent(), before = await state();
    await assert.rejects(payments.saveIntentWithSettlementPlan({ intent: value, settlementPlan: plan(value) }), conflict);
    assert.deepEqual(await state(), before); assert.equal(value.snapshot().creation.couponAuthority, undefined);
  });
  for (const initiallyBound of [false, true]) await check(`first-send without journal authority cannot issue or fall back (bound=${initiallyBound})`, async () => {
    await seed(); const value = intent();
    if (initiallyBound) {
      await admit(value); const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: value.id } });
      const creation = { ...row.creation }; delete creation.couponAuthority;
      await prisma.paymentIntent.update({ where: { id: value.id }, data: { creation } });
    } else {
      // Deliberately seed a legacy ready journal ONLY for this negative case.
      // It is not presented as an issuer or as a successful admission.
      const s = value.snapshot();
      await prisma.paymentIntent.create({ data: { id: s.id, merchantId, sessionId: s.sessionId, idempotencyKey: s.idempotencyKey,
        version: 1, amountCents: s.amountCents, currency: s.currency, method: s.method, status: s.status,
        amountBreakdown: s.amountBreakdown, creation: s.creation, statusHistory: s.statusHistory } });
    }
    const legacy = await payments.getByIdempotency(merchantId, "checkout_1", value.snapshot().idempotencyKey), fake = provider(), before = await state();
    await assert.rejects(new ResumePaymentCreationService(payments, fake).execute(legacy), conflict);
    assert.equal(fake.calls.length, 0); assert.deepEqual(await state(), before);
  });
  await check("lost admission commit ACK retains durable owner/journal; lookup recovers authority without a second issuance", async () => {
    await seed(); let commits = 0; const fault = new Error("synthetic-admission-ack-lost");
    const unknown = new PrismaPaymentRepository(new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return async (...args) => { const result = await target.$transaction(...args); commits++; throw fault; };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } }), captureStorefrontCouponForPayment);
    const value = intent(); await assert.rejects(admit(value, unknown), error => error === fault); assert.equal(commits, 1);
    assert.equal(value.snapshot().creation.couponAuthority, undefined); assert.equal(value.snapshot().version, 0);
    const recovered = await payments.getByIdempotency(merchantId, "checkout_1", value.snapshot().idempotencyKey);
    assert.ok(recovered.snapshot().creation.couponAuthority); const fake = provider(); await new ResumePaymentCreationService(payments, fake).execute(recovered);
    assert.equal(fake.calls.length, 1); assert.equal(await prisma.paymentIntent.count(), 1); assert.equal(await prisma.paymentSettlement.count(), 1);
  });
  await check("twenty distinct checkout IDs contend for one cart and only one financial owner commits", async () => {
    await seed(20); let acquired, release;
    const locked = new Promise(resolve => { acquired = resolve; }), gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`; acquired(); await gate; });
    let tasks = [];
    try {
      await locked; tasks = Array.from({ length: 20 }, (_, index) => admit(intent("checkout_" + (index + 1))).then(() => "committed", error => error.message));
      const deadline = Date.now() + 9000;
      do { maxWaiters = Number((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=${`aacp_write_native_${runId}`}
        AND wait_event_type='Lock' AND state='active' AND query LIKE '%FROM merchants%'`)[0].n);
        if (maxWaiters === 20) break; await pause(20); } while (Date.now() < deadline);
      assert.equal(maxWaiters, 20); release(); await holder;
      const results = await Promise.all(tasks); assert.equal(results.filter(v => v === "committed").length, 1);
      assert.equal(results.filter(v => v === "checkout_coupon_binding_conflict").length, 19);
      assert.equal(await prisma.paymentIntent.count(), 1); assert.equal(await prisma.paymentSettlement.count(), 1);
      const checkouts = await prisma.checkoutSession.findMany(); assert.equal(checkouts.filter(row => row.cart._storefrontCouponBinding).length, 1);
    } finally { release(); await Promise.allSettled([holder, ...tasks]); }
  });
  await check("coupon removal between ready admission and first-send denies dispatch without replacing authority", async () => {
    await seed(); const value = intent(); await admit(value);
    await prisma.storefrontCart.update({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } }, data: { couponCode: null, discount: 0 } });
    const before = await state(), fake = provider(); await assert.rejects(new ResumePaymentCreationService(payments, fake).execute(value), conflict);
    assert.equal(fake.calls.length, 0); assert.deepEqual(await state(), before);
  });
  await check("definitive rejection releases atomically; real reserve reuses reservation and normal refresh/reopen keeps fresh coupon before new UUID admission", async () => {
    await seed(); const old = await rejectedPayment(), oldAuthority = old.snapshot().creation.couponAuthority;
    const repo = new PrismaCheckoutRepository(prisma);
    const released = await repo.reopenForBuyerEdit(merchantId, "checkout_1", "payment");
    assert.equal(released.cart.currentDiscount, 0);
    const first = await state(); assert.equal(first.checkouts[0].cart._storefrontCouponBinding.state, "released");
    assert.equal(first.carts[0].couponCode, null); assert.equal(first.carts[0].discount, 0);
    assert.equal(first.redemptions[0].status, "cancelled"); assert.equal(releaseReceipts(first).length, 1);
    // This is explicit upstream harness composition, NOT a claim that a browser
    // or LLM applied a coupon. The reservation repository, shared fences and
    // normal checkout mutation below are the actual production implementations.
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      await lockStorefrontCart(tx, merchantId, cartId);
      assert.deepEqual(await readStorefrontCheckoutBindingOwners(tx, merchantId, cartId), []);
      const coupon = toCouponEntity(await tx.coupon.findUniqueOrThrow({ where: { id: "synthetic-coupon" } })).snapshot();
      const redemption = CouponRedemptionEntity.create({ coupon_id: coupon.id, merchant_id: merchantId,
        session_id: cartId, buyer_global_user_id: null, discount_applied: 10, source: "manual" });
      const result = await new PrismaCouponTransactionRepository(tx, true).reserve({ coupon, redemption,
        event: createCouponEventEnvelope({ merchantId, eventType: "coupon.applied", payload: { session_id: cartId, coupon_id: coupon.id } }) });
      assert.deepEqual(result, { status: "reserved", redemption_id: oldAuthority.redemptionId });
      const source = await tx.storefrontCart.updateMany({ where: { merchantId, sessionId: cartId, couponCode: null, discount: 0 },
        data: { couponCode: "SAVE10", discount: 1000 } }); assert.equal(source.count, 1);
    });
    const expected = await repo.getSession(merchantId, "checkout_1");
    const refreshed = await repo.commitCommercialMutation({ expected, next: { ...expected, cart: cart(), shipping: shipping() } });
    assert.equal(refreshed.cart.currentDiscount, 10);
    for (let reopen = 0; reopen < 2; reopen++) {
      const reopened = await repo.reopenForBuyerEdit(merchantId, "checkout_1", "payment");
      assert.equal(reopened.cart.currentDiscount, 10); assert.equal(reopened.cart.commercialNudge.couponCode, "SAVE10");
    }
    const fresh = intent("checkout_1", "-reapplied"); await admit(fresh);
    const authority = fresh.snapshot().creation.couponAuthority;
    assert.equal(authority.redemptionId, oldAuthority.redemptionId); assert.notEqual(authority.bindingId, oldAuthority.bindingId);
    const now = await state(); assert.equal(now.redemptions[0].status, "applied"); assert.equal(now.coupons[0].usagesCount, 0);
    assert.equal(releaseReceipts(now).length, 1); assert.equal(now.carts[0].discount, 1000);
    assert.deepEqual((await payments.getIntentById(merchantId, old.id)).snapshot().creation.couponAuthority, oldAuthority);
    // Negative stale source only: never represent this synthetic old event as
    // an approved payment/order. The actual exact consumer must reject it.
    const eventId = "synthetic-stale-old-generation";
    await prisma.outboxMessage.create({ data: { eventId, merchantId, eventType: "order.completed", schemaVersion: 1,
      producer: "checkout", occurredAt: new Date(), correlationId: "synthetic-old-generation", causationId: old.id,
      payload: { session_id: "checkout_1", external_order_id: "synthetic-never-approved", payment_intent_id: old.id,
        coupon_authority: { ...oldAuthority, orderId: "synthetic-never-approved" } } } });
    const beforeStale = await state();
    await assert.rejects(new PrismaBoundCouponRedemption(prisma).redeem({ merchantId, eventId }), conflict);
    assert.deepEqual(await state(), beforeStale);
  });
  for (const fault of ["source_cas", "binding", "commit"]) await check(`release ${fault} failure rolls back source, reservation, tombstone and receipt`, async () => {
    await seed(); await rejectedPayment();
    await prisma.$executeRaw`INSERT INTO synthetic_bound_faults(kind) VALUES(${fault})`;
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, "checkout_1", "payment"));
    assert.deepEqual(await state(), before);
  });
  await check("uncertain provider creation cannot release coupon or write source cart", async () => {
    await seed(); const value = intent(); await admit(value);
    await assert.rejects(new ResumePaymentCreationService(payments, { async createPayment() { throw new Error("synthetic_provider_unknown"); } }).execute(value),
      error => error.message === "payment_creation_uncertain");
    const journal = await payments.getIntentById(merchantId, value.id); assert.equal(journal.snapshot().creation.state, "uncertain");
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, "checkout_1", "payment"));
    assert.deepEqual(await state(), before);
  });
  await check("approved payment cannot release coupon or write source cart", async () => {
    await seed(); const value = intent(); await admit(value); await new ResumePaymentCreationService(payments, provider()).execute(value);
    value.markApproved({ providerPaymentId: value.snapshot().providerPaymentId, approvedAmountCents: 9599 }); await payments.saveIntent({ intent: value });
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, "checkout_1", "payment"));
    assert.deepEqual(await state(), before);
  });
  console.log(JSON.stringify({ nativeCouponAdmissionPassed: checks, distinctCheckoutContenders: 20, maxMerchantWaiters: maxWaiters,
    issuer: "REAL_REPOSITORY_TRANSACTION", provider: "FAKE_NO_NETWORK", actualBrowserJourney: false, productionAccess: false }));
  }
} catch (error) { console.error(JSON.stringify({ failed: active, message: error.message, code: error.code })); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
