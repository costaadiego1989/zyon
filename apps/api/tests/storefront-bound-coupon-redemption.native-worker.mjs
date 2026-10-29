import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { inspectNativePrismaClient, assertNativePrismaUrl } from "./native-prisma-admission-guards.mjs";

const [url, runId] = process.argv.slice(2); assert.equal(process.argv.length, 4);
const parsed = assertNativePrismaUrl(url); assert.match(runId, /^[a-f0-9-]{36}$/);
assert.equal(parsed.searchParams.get("application_name"), `aacp_write_native_${runId}`);
for (const key of ["DATABASE_URL", "DIRECT_URL", "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "PRISMA_QUERY_ENGINE_LIBRARY", "READY_PROD_TEST_PRISMA_CLIENT"])
  assert.equal(process.env[key], undefined, "native_bound_redemption_environment_not_clean");
inspectNativePrismaClient(fileURLToPath(new URL("../", import.meta.url)));
const { PrismaClient } = await import("@prisma/client");
const { PrismaBoundCouponRedemption } = await import("../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts");
const { PrismaCouponTransactionRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
const { CouponsOnOrderCompletedHandler } = await import("../src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts");
const { RedeemCouponUseCase } = await import("../src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts");
const { InMemoryDomainEventBus } = await import("../src/shared/events/in-memory-domain-event-bus.ts");
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [], transactionOptions: { timeout: 20_000, maxWait: 15_000 } });
const service = new PrismaBoundCouponRedemption(prisma), merchantId = "synthetic-bound-merchant", sessionId = "synthetic-bound-checkout", cartId = "synthetic-bound-cart", eventId = "synthetic-order-event";
const identity = () => ({ version: 1, bindingId: "11111111-1111-4111-8111-111111111111", merchantId, checkoutSessionId: sessionId, cartId,
  buyerId: "synthetic-buyer", reservationBuyerId: null, redemptionId: "synthetic-redemption", couponId: "synthetic-coupon", discountCents: 137, basisHash: "ab".repeat(32) });
const authority = () => ({ ...identity(), orderId: "synthetic-provider-order" });
const sourcePayload = () => ({ session_id: sessionId, external_order_id: authority().orderId, payment_intent_id: "synthetic-payment", coupon_authority: authority() });
const receiptId = () => "evt_bound_coupon_" + createHash("sha256").update(JSON.stringify([merchantId, identity().bindingId, identity().redemptionId, authority().orderId])).digest("hex");
const checkoutWhere = { merchantId_sessionId: { merchantId, sessionId } };
const checkout = () => prisma.checkoutSession.findUniqueOrThrow({ where: checkoutWhere });
const command = () => service.redeem({ merchantId, eventId });
const conflict = error => error?.message === "checkout_coupon_binding_conflict";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const seed = async () => {
  await prisma.$executeRaw`TRUNCATE synthetic_bound_faults,outbox_messages,payment_intents,completed_orders,checkout_sessions,coupon_redemptions,coupons,merchants CASCADE`;
  await prisma.merchant.create({ data: { id: merchantId, name: "Synthetic only" } });
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: identity().buyerId, conversationId: "synthetic-conversation",
    cart: { source: "storefront", cart_ref: cartId, currentDiscount: 1.37, total: 10, currency: "BRL", items: [], _storefrontCouponBinding: { ...identity(), state: "active" } },
    createdAt: new Date(0), updatedAt: new Date(0) } });
  await prisma.coupon.create({ data: { id: identity().couponId, merchantId, code: "SYNTHETIC", discountType: "fixed", discountValue: 1.37,
    maxUsages: 100, startsAt: new Date(0) } });
  await prisma.couponRedemption.create({ data: { id: identity().redemptionId, merchantId, couponId: identity().couponId, sessionId: cartId,
    discountApplied: 1.37, source: "manual", status: "applied" } });
  await prisma.paymentIntent.create({ data: { id: "synthetic-payment", merchantId, sessionId, idempotencyKey: "synthetic-key", amountCents: 1000,
    approvedAmountCents: 1000, currency: "BRL", method: "pix", status: "approved", providerPaymentId: authority().orderId,
    creation: { state: "complete", couponAuthority: identity(), input: { intentId: "synthetic-payment", merchantId, sessionId,
      amountCents: 1000, currency: "BRL", method: "pix" } } } });
  await prisma.completedOrder.create({ data: { id: "synthetic-completed-order", merchantId, sessionId, externalOrderId: authority().orderId, orderTotal: 10, currency: "BRL", completedAt: new Date() } });
  await prisma.outboxMessage.create({ data: { eventId, eventType: "order.completed", schemaVersion: 1, merchantId, occurredAt: new Date(),
    correlationId: "synthetic-correlation", causationId: "synthetic-parent", producer: "checkout", payload: sourcePayload() } });
};
const state = async () => ({ checkout: await checkout(), coupons: await prisma.coupon.findMany({ orderBy: { id: "asc" } }),
  payments: await prisma.paymentIntent.findMany({ orderBy: { id: "asc" } }),
  redemptions: await prisma.couponRedemption.findMany({ orderBy: { id: "asc" } }),
  outbox: await prisma.outboxMessage.findMany({ orderBy: { eventId: "asc" } }) });
const verify = async () => {
  const s = await state(); assert.equal(s.checkout.cart._storefrontCouponBinding.state, "redeemed");
  assert.equal(s.checkout.cart._storefrontCouponBinding.orderId, authority().orderId); assert.equal(s.checkout.version, 1);
  assert.equal(s.redemptions.find(r => r.id === identity().redemptionId).status, "redeemed"); assert.equal(s.coupons[0].usagesCount, 1);
  const receipt = s.outbox.find(row => row.eventId === receiptId()); assert.ok(receipt);
  assert.deepEqual(receipt.payload, { session_id: sessionId, coupon_id: identity().couponId, order_id: authority().orderId,
    discount_applied: 1.37, buyer_global_user_id: "" });
  assert.equal(JSON.stringify(receipt.payload).includes("bindingId"), false); return s;
};
const waitForMerchantWaiters = async expected => {
  const deadline = Date.now() + 9000; let count = 0;
  do {
    count = Number((await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE application_name=${`aacp_write_native_${runId}`} AND wait_event_type='Lock' AND state='active'
        AND query LIKE '%FROM merchants%'`)[0].n);
    if (count === expected) return count; await pause(20);
  } while (Date.now() < deadline);
  assert.equal(count, expected, "exact_merchant_waiters_not_observed");
};
let checks = 0, approvalReadChecks = 0, publicationChecks = 0, active = "owned synthetic marker", maxWaiters = 0;
const check = async (name, work) => { active = name; await work(); checks++; console.log(JSON.stringify({ test: name, status: "passed" })); };
try {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  assert.deepEqual(await prisma.$queryRaw`SELECT to_regclass('public.storefront_carts')::text AS cart`, [{ cart: null }]);
  const approvals = new PrismaPaymentApprovalReader(prisma);
  const readApproval = () => approvals.find(merchantId, sessionId, "synthetic-payment");
  await check("real approval reader exposes only detached canonical authority and no raw provider journal", async () => {
    await seed(); const before = await state(); const result = await readApproval();
    assert.deepEqual(result.couponAuthority, identity());
    for (const key of ["creation", "input", "method", "leaseToken"]) assert.equal(Object.hasOwn(result, key), false);
    result.couponAuthority.cartId = "mutated-consumer-copy";
    assert.deepEqual((await readApproval()).couponAuthority, identity()); assert.deepEqual(await state(), before);
  });
  await check("real legacy approval has no synthetic authority or private optional key", async () => {
    await seed(); const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    const creation = { ...row.creation }; delete creation.couponAuthority;
    await prisma.paymentIntent.update({ where: { id: row.id }, data: { creation } });
    const before = await state(); const result = await readApproval(); assert.equal(Object.hasOwn(result, "couponAuthority"), false);
    assert.equal(Object.hasOwn(result, "creation"), false); assert.deepEqual(await state(), before);
  });
  await check("approval reader never falls back to legacy when authority is present but null", async () => {
    await seed(); const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: row.id }, data: { creation: { ...row.creation, couponAuthority: null } } });
    const before = await state(); await assert.rejects(readApproval(), /^Error: payment_coupon_authority_conflict$/); assert.deepEqual(await state(), before);
  });
  await check("approval reader checks frozen journal input identity against payment row", async () => {
    await seed(); const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: row.id }, data: { creation: { ...row.creation,
      input: { ...row.creation.input, intentId: "foreign-payment" } } } });
    const before = await state(); await assert.rejects(readApproval(), /^Error: payment_coupon_authority_conflict$/); assert.deepEqual(await state(), before);
  });
  await check("approval query is scoped by merchant and checkout, even with known payment ID", async () => {
    await seed(); const before = await state();
    assert.equal(await approvals.find("foreign-merchant", sessionId, "synthetic-payment"), null);
    assert.equal(await approvals.find(merchantId, "foreign-checkout", "synthetic-payment"), null);
    assert.deepEqual(await state(), before);
  });
  await check("matching unrecognized method cannot pass the real approval projection", async () => {
    await seed(); const row = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: row.id }, data: { method: "unknown", creation: { ...row.creation,
      input: { ...row.creation.input, method: "unknown" } } } });
    const before = await state(); await assert.rejects(readApproval(), /^Error: payment_coupon_authority_conflict$/); assert.deepEqual(await state(), before);
  });
  approvalReadChecks = checks;
  // Runtime publisher/consumer with REAL Prisma transactions. Binding and the
  // payment journal are still seeded: this does not certify their issuer.
  const seedPublication = async () => {
    await seed(); await prisma.outboxMessage.deleteMany({}); await prisma.completedOrder.deleteMany({});
    const stored = await checkout();
    await prisma.checkoutSession.update({ where: checkoutWhere, data: { cart: { ...stored.cart, total: 11.37,
      items: [{ sku: "SYNTHETIC", name: "Synthetic item", quantity: 1, price: 11.37 }] } } });
    const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { amountCents: 1099, approvedAmountCents: 1099, digitalContent: [],
      creation: { ...payment.creation, input: { ...payment.creation.input, amountCents: 1099 } },
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137, shippingCents: 0, platformFeeCents: 99, totalCents: 1099 } } });
  };
  const request = () => ({ merchant_id: merchantId, session_id: sessionId, external_order_id: authority().orderId, order_total: 10, currency: "BRL" });
  const publisher = (client = prisma, reader = approvals) => {
    const repository = new PrismaCheckoutRepository(client);
    return new CompleteOrderUseCase(repository, repository, repository, undefined, undefined, undefined, undefined,
      repository, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reader);
  };
  const source = async () => prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, eventType: "order.completed" } });
  const dispatched = row => ({ eventId: row.eventId, eventType: row.eventType, merchantId: row.merchantId,
    correlationId: row.correlationId, causationId: row.causationId, schemaVersion: row.schemaVersion, payload: row.payload });
  const consumer = (commandPort = service) => {
    const bus = new InMemoryDomainEventBus(), repository = new PrismaCheckoutRepository(prisma);
    new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(new PrismaCouponTransactionRepository(prisma)), repository, commandPort).onModuleInit();
    return bus;
  };
  const verifyPublication = async () => {
    const s = await state();
    assert.equal(s.redemptions[0].sessionId, cartId); assert.equal(s.redemptions[0].status, "redeemed");
    assert.equal(s.redemptions[0].orderId, authority().orderId); assert.equal(s.coupons[0].usagesCount, 1);
    assert.equal(s.checkout.cart._storefrontCouponBinding.state, "redeemed");
    assert.equal(s.outbox.filter(row => row.eventType === "order.completed").length, 1);
    assert.equal(s.outbox.filter(row => row.eventType === "coupon.redeemed").length, 1);
    assert.deepEqual((await source()).payload.coupon_authority, authority());
    assert.equal(Number((await prisma.completedOrder.findFirstOrThrow({ where: { merchantId, sessionId } })).orderTotal), 10);
    const projection = await new PrismaCheckoutRepository(prisma).getSession(merchantId, sessionId);
    assert.equal(Object.hasOwn(projection.cart, "_storefrontCouponBinding"), false);
    return s;
  };
  await check("runtime approved publisher and exact consumer redeem original cart reservation with merchant fee preserved", async () => {
    await seedPublication(); const useCase = publisher();
    assert.equal((await useCase.executePaymentApproval(request(), "synthetic-payment")).idempotent, false);
    const event = await source(); assert.deepEqual(event.payload.coupon_authority, authority());
    const bus = consumer(); await bus.publish(dispatched(event)); const before = await verifyPublication();
    assert.equal((await useCase.executePaymentApproval(request(), "synthetic-payment")).idempotent, true);
    await bus.publish(dispatched(event)); assert.deepEqual(await state(), before);
  });
  await check("bound canonical checkout refuses a legacy approval lacking frozen authority before order writes", async () => {
    await seedPublication(); const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    const creation = { ...payment.creation }; delete creation.couponAuthority;
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { creation } });
    const before = await state(); await assert.rejects(publisher().executePaymentApproval(request(), payment.id), conflict);
    assert.equal(await prisma.completedOrder.count({}), 0); assert.deepEqual(await state(), before);
  });
  await check("public completion cannot turn a private bound checkout into legacy event with forged body metadata", async () => {
    await seedPublication(); const before = await state();
    await assert.rejects(publisher().execute({ ...request(), coupon_authority: authority(), paymentIntentId: "synthetic-payment" }), conflict);
    assert.equal(await prisma.completedOrder.count({}), 0); assert.deepEqual(await state(), before);
  });
  await check("publication transaction rereads canonical journal rather than trusting an older approval projection", async () => {
    await seedPublication();
    const reader = { async find(...refs) { const result = await approvals.find(...refs);
      const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
      await prisma.paymentIntent.update({ where: { id: payment.id }, data: { creation: { ...payment.creation,
        couponAuthority: { ...identity(), bindingId: "22222222-2222-4222-8222-222222222222" } } } });
      return result; } };
    await assert.rejects(publisher(prisma, reader).executePaymentApproval(request(), "synthetic-payment"), conflict);
    assert.equal(await prisma.completedOrder.count({}), 0); assert.equal(await prisma.outboxMessage.count({}), 0);
    assert.equal((await prisma.couponRedemption.findUniqueOrThrow({ where: { id: identity().redemptionId } })).status, "applied");
  });
  for (const fault of ["publication", "commit"]) await check(`${fault} failure rolls back runtime order and authoritative event together`, async () => {
    await seedPublication(); await prisma.$executeRaw`INSERT INTO synthetic_bound_faults(kind) VALUES(${fault})`;
    const before = await state(); await assert.rejects(publisher().executePaymentApproval(request(), "synthetic-payment"));
    assert.equal(await prisma.completedOrder.count({}), 0); assert.deepEqual(await state(), before);
  });
  await check("lost exact-command ACK queues immutable source reference and real child replay does not double quota", async () => {
    await seedPublication(); await publisher().executePaymentApproval(request(), "synthetic-payment");
    let first = true;
    const bus = consumer({ async redeem(input) { await service.redeem(input); if (first) { first = false; throw new Error("synthetic_ack_lost"); } } });
    await bus.publish(dispatched(await source()));
    const child = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, eventType: "coupon.redemption.requested" } });
    assert.deepEqual(child.payload, { source_event_id: (await source()).eventId });
    const before = await verifyPublication(); await bus.publish(dispatched(child)); assert.deepEqual(await state(), before);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId, eventType: "coupon.redemption.requested" } }), 1);
  });
  publicationChecks = checks - approvalReadChecks;
  await check("exact bound redemption commits once and never reads a live storefront cart", async () => { await seed(); await command(); await verify(); });
  await check("coherent replay changes no row, version, usage, event or timestamp", async () => {
    await seed(); await command(); const before = await verify(); await command(); assert.deepEqual(await state(), before);
  });
  await check("approved buyer fee is excluded from merchant order and remains unchanged through redemption/replay", async () => {
    await seed(); const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { amountCents: 1099, approvedAmountCents: 1099,
      creation: { ...payment.creation, input: { ...payment.creation.input, amountCents: 1099 } },
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137, shippingCents: 0, platformFeeCents: 99, totalCents: 1099 } } });
    const beforePayment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    await command(); const after = await verify(); assert.deepEqual(after.payments, [beforePayment]);
    assert.equal((await prisma.completedOrder.findUniqueOrThrow({ where: { id: "synthetic-completed-order" } })).orderTotal.toString(), "10");
    await command(); assert.deepEqual(await state(), after);
  });
  await check("zero merchant order can consume exact coupon with only a positive platform fee paid", async () => {
    await seed(); const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { amountCents: 99, approvedAmountCents: 99,
      creation: { ...payment.creation, input: { ...payment.creation.input, amountCents: 99 } },
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 137, discountCents: 137, shippingCents: 0, platformFeeCents: 99, totalCents: 99 } } });
    await prisma.completedOrder.update({ where: { id: "synthetic-completed-order" }, data: { orderTotal: 0 } });
    await command(); await verify();
  });
  for (const [label, patch] of [
    ["currency", { currency: "USD" }], ["version", { version: 2 }], ["fractional fee", { platformFeeCents: 0.5 }],
    ["coerced discount", { discountCents: "137" }], ["arithmetic", { totalCents: 999 }],
    ["same-total different coupon", { itemsSubtotalCents: 1138, discountCents: 138 }],
    ["unsafe cents", { itemsSubtotalCents: Number.MAX_SAFE_INTEGER + 1 }],
  ]) await check(`invalid persisted ${label} breakdown rolls back without coupon or payment effects`, async () => {
    await seed(); await prisma.paymentIntent.update({ where: { id: "synthetic-payment" }, data: { amountBreakdown: {
      version: 1, currency: "BRL", itemsSubtotalCents: 1137, discountCents: 137, shippingCents: 0, platformFeeCents: 0, totalCents: 1000, ...patch } } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("malformed JSONB breakdown is not treated as a legacy absent breakdown", async () => {
    await seed(); await prisma.paymentIntent.update({ where: { id: "synthetic-payment" }, data: { amountBreakdown: [] } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("missing canonical breakdown cannot infer a fee from the difference", async () => {
    await seed(); const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } });
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { amountCents: 1099, approvedAmountCents: 1099,
      creation: { ...payment.creation, input: { ...payment.creation.input, amountCents: 1099 } } } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("unrelated reservation under the same cart is not redeemed by OR/session scan", async () => {
    await seed(); await prisma.coupon.create({ data: { id: "unrelated-coupon", merchantId, code: "OTHER", discountType: "fixed", discountValue: 1, startsAt: new Date(0) } });
    const other = await prisma.couponRedemption.create({ data: { id: "unrelated-redemption", merchantId, couponId: "unrelated-coupon", sessionId: cartId, discountApplied: 1, source: "manual", status: "applied" } });
    await command(); const s = await verify(); assert.deepEqual(s.redemptions.find(row => row.id === other.id), other);
    assert.equal(s.coupons.find(row => row.id === "unrelated-coupon").usagesCount, 0);
  });
  for (const fault of ["usage", "binding", "outbox", "commit"]) await check(`${fault} SQL fault rolls back reservation, usage, binding and outbox`, async () => {
    await seed(); await prisma.$executeRaw`INSERT INTO synthetic_bound_faults VALUES (${fault})`; const before = await state();
    await assert.rejects(command()); assert.deepEqual(await state(), before);
  });
  await check("ACK lost after real commit remains unknown, explicit replay has no second usage", async () => {
    await seed(); let commits = 0; const failure = new Error("synthetic_ack_lost");
    const unknown = new PrismaBoundCouponRedemption({ outboxMessage: prisma.outboxMessage, async $transaction(...args) {
      await prisma.$transaction(...args); commits++; throw failure;
    } });
    await assert.rejects(unknown.redeem({ merchantId, eventId }), error => error === failure); assert.equal(commits, 1);
    const before = await verify(); await command(); assert.deepEqual(await state(), before);
  });
  for (const [label, patch] of [["generation", { bindingId: "22222222-2222-4222-8222-222222222222" }], ["basis", { basisHash: "cd".repeat(32) }],
    ["buyer", { buyerId: "other-buyer" }], ["released", { state: "released" }]]) await check(`stale ${label} authority fails with original reservation ID/amount unchanged`, async () => {
    await seed(); const stored = await checkout(); await prisma.checkoutSession.update({ where: checkoutWhere,
      data: { cart: { ...stored.cart, _storefrontCouponBinding: { ...stored.cart._storefrontCouponBinding, ...patch } } } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  for (const value of [null, 999]) await check(`missing/divergent approved amount (${value}) cannot consume a coupon`, async () => {
    await seed(); await prisma.paymentIntent.update({ where: { id: "synthetic-payment" }, data: { approvedAmountCents: value } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("missing journal authority is not reconstructed from current binding", async () => {
    await seed(); const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: "synthetic-payment" } }); const creation = { ...payment.creation }; delete creation.couponAuthority;
    await prisma.paymentIntent.update({ where: { id: payment.id }, data: { creation } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("legacy order event cannot acquire authority from live checkout state", async () => {
    await seed(); const payload = sourcePayload(); delete payload.coupon_authority;
    await prisma.outboxMessage.update({ where: { eventId }, data: { payload } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("foreign tenant cannot read or redeem another tenant's source event", async () => {
    await seed(); const before = await state(); await assert.rejects(service.redeem({ merchantId: "foreign-merchant", eventId }), conflict); assert.deepEqual(await state(), before);
  });
  await check("an existing conflicting receipt cannot be silently ACKed by outbox upsert", async () => {
    await seed(); await prisma.outboxMessage.create({ data: { eventId: receiptId(), merchantId, eventType: "coupon.redeemed", schemaVersion: 1,
      occurredAt: new Date(), correlationId: "synthetic", causationId: eventId, producer: "coupons", payload: { wrong: true } } });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  await check("20 actual contenders all finish with one redemption/usage/binding version/receipt", async () => {
    await seed(); const acquired = deferred(), release = deferred(); let attempts = [];
    const holder = prisma.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`; acquired.resolve(); await release.promise; });
    void holder.catch(() => {});
    try {
      await Promise.race([acquired.promise, holder.then(() => { throw new Error("holder_ended_before_lock"); })]);
      attempts = Array.from({ length: 20 }, () => command().then(() => "success", error => error.message));
      maxWaiters = await waitForMerchantWaiters(20); release.resolve(); await holder;
      assert.deepEqual(await Promise.all(attempts), Array(20).fill("success")); await verify();
    } finally { release.resolve(); await Promise.allSettled([holder, ...attempts]); }
  });
  await check("new generation committed while old event waits never gains stale order authority", async () => {
    await seed(); const acquired = deferred(), release = deferred(); let attempt;
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`; acquired.resolve(); await release.promise;
      const stored = await tx.checkoutSession.findUniqueOrThrow({ where: checkoutWhere });
      await tx.checkoutSession.update({ where: checkoutWhere, data: { cart: { ...stored.cart, _storefrontCouponBinding: {
        ...stored.cart._storefrontCouponBinding, bindingId: "22222222-2222-4222-8222-222222222222" } } } });
    }); void holder.catch(() => {});
    try {
      await Promise.race([acquired.promise, holder.then(() => { throw new Error("holder_ended_before_lock"); })]);
      attempt = command().then(() => "unexpected", error => error.message); await waitForMerchantWaiters(1); release.resolve(); await holder;
      assert.equal(await attempt, "checkout_coupon_binding_conflict");
      assert.equal((await prisma.couponRedemption.findUniqueOrThrow({ where: { id: identity().redemptionId } })).status, "applied");
      assert.equal(await prisma.outboxMessage.count({ where: { eventType: "coupon.redeemed" } }), 0);
    } finally { release.resolve(); await Promise.allSettled([holder, ...(attempt ? [attempt] : [])]); }
  });
  await check("legacy generic redemption cannot be presented as an atomic bound replay", async () => {
    await seed(); await new PrismaCouponTransactionRepository(prisma).redeem({ merchantId, sessionId: cartId, orderId: authority().orderId,
      eventFor: () => ({ event_id: "synthetic-legacy-receipt", event_type: "coupon.redeemed", schema_version: 1, merchant_id: merchantId,
        occurred_at: new Date().toISOString(), correlation_id: "synthetic", causation_id: "synthetic", producer: "coupons", payload: {} }) });
    const before = await state(); await assert.rejects(command(), conflict); assert.deepEqual(await state(), before);
  });
  console.log(JSON.stringify({ nativeBoundRedemptionPassed: checks - approvalReadChecks - publicationChecks, nativeApprovalReadPassed: approvalReadChecks,
    nativePublicationConsumerPassed: publicationChecks,
    totalPassed: checks, maxMerchantWaiters: maxWaiters, upstreamAuthority: "SYNTHETIC_FIXTURES_ONLY",
    publicationConsumerWired: true, issuerWired: false, actualHandoffProven: false, providerCalls: 0 }));
} catch (error) { console.error(JSON.stringify({ failed: active, message: error.message })); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
