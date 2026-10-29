import assert from "node:assert/strict";

/** Historical rows are seeded directly, not presented as new coupon issuance,
 * authenticated HTTP, immutable receipt or operation replay/idempotency proof. */
export async function runLegacyCouponReleaseNativeCases({ prisma, runId }) {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const carts = new PrismaStorefrontCartRepository(prisma), merchantId = "synthetic-merchant", code = "LEGACY5", couponId = "legacy-release-coupon";
  let passed = 0, active = "seed";
  const check = async (name, work) => { active = name; await work(); passed++; console.log(JSON.stringify({ test: name, status: "passed" })); };
  const state = async cartId => ({ cart: await prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } }),
    reservations: await prisma.couponRedemption.findMany({ where: { merchantId, sessionId: cartId }, orderBy: { id: "asc" } }),
    outbox: await prisma.outboxMessage.findMany({ orderBy: { eventId: "asc" } }),
    payments: await prisma.paymentIntent.findMany({ orderBy: { id: "asc" } }) });
  const seed = async (cartId = "legacy-release-cart") => {
    await prisma.$executeRaw`DELETE FROM payment_intents`; await prisma.$executeRaw`DELETE FROM checkout_sessions`;
    await prisma.$executeRaw`DELETE FROM outbox_messages`; await prisma.$executeRaw`DELETE FROM coupon_redemptions`;
    await prisma.$executeRaw`DELETE FROM coupons`; await prisma.$executeRaw`DELETE FROM storefront_carts`;
    await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=NULL`; await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=0`;
    const items = [{ variantId: "synthetic-variant", productId: "synthetic-product", sku: "synthetic-sku", name: "Saved historical quote", quantity: 2, unitPriceCents: 9000 }];
    await prisma.storefrontCart.create({ data: { id: cartId, merchantId, sessionId: cartId, items, total: 18000, discount: 500, couponCode: code,
      freeShipping: false, expiresAt: new Date("2001-01-01") } });
    await prisma.coupon.create({ data: { id: couponId, merchantId, code, discountType: "fixed", discountValue: 5,
      startsAt: new Date("2000-01-01"), endsAt: new Date("2001-01-01"), maxUsages: 1, usagesCount: 0 } });
    await prisma.couponRedemption.create({ data: { id: "legacy-release-reservation", merchantId, sessionId: cartId, couponId,
      buyerGlobalUserId: "synthetic-buyer", discountApplied: 5, source: "manual", status: "applied" } });
    return cartId;
  };
  const command = (action, cartId, repository = carts) => action === "coupon" ? repository.removeCoupon(merchantId, cartId)
    : action === "clear" ? repository.clear(merchantId, cartId) : action === "last" ? repository.removeItem(merchantId, cartId, "synthetic-variant")
      : repository.updateItemQuantity(merchantId, cartId, "synthetic-variant", 0);
  const review = error => { assert.equal(error?.getStatus?.(), 409); assert.ok(["checkout_review_required", "storefront_cart_checkout_bound"].includes(error.getResponse()?.code ?? error.message)); return true; };
  // Native failures only for named synthetic sources. No delegate/repository
  // override or runtime guard is used for cancellation/CAS/deferred rollback.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_legacy_release_cart_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.session_id='legacy-release-cas-fault' AND OLD.coupon_code IS NOT NULL AND NEW.coupon_code IS NULL THEN RETURN NULL; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_legacy_release_cart_fault BEFORE UPDATE ON storefront_carts
    FOR EACH ROW EXECUTE FUNCTION synthetic_legacy_release_cart_fault()`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_legacy_release_cancel_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.session_id='legacy-release-cancel-fault' AND NEW.status='cancelled' THEN RAISE EXCEPTION 'synthetic_legacy_cancel_fault'; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER synthetic_legacy_release_cancel_fault BEFORE UPDATE ON coupon_redemptions
    FOR EACH ROW EXECUTE FUNCTION synthetic_legacy_release_cancel_fault()`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION synthetic_legacy_release_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.session_id='legacy-release-commit-fault' AND NEW.status='cancelled' THEN RAISE EXCEPTION 'synthetic_legacy_commit_fault'; END IF;
    RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER synthetic_legacy_release_commit_fault AFTER UPDATE ON coupon_redemptions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_legacy_release_commit_fault()`);
  try {
    for (const action of ["coupon", "clear", "last", "zero"]) await check(`legacy ${action} cancels the exact reservation despite expired source/coupon, cap zero and unknown cost`, async () => {
      const cartId = await seed(), before = await state(cartId); await command(action, cartId); const after = await state(cartId);
      assert.equal(after.cart.couponCode, null); assert.equal(after.cart.discount, 0); assert.equal(after.reservations.length, 1);
      assert.equal(after.reservations[0].id, before.reservations[0].id); assert.equal(after.reservations[0].status, "cancelled");
      assert.equal(Number(after.reservations[0].discountApplied), 5); assert.equal(after.reservations[0].buyerGlobalUserId, "synthetic-buyer");
      if (action === "coupon") { assert.deepEqual(after.cart.items, before.cart.items); assert.equal(after.cart.total, 18000); }
      else { assert.equal(after.cart.items.length, 0); assert.equal(after.cart.total, 0); }
      assert.equal(after.outbox.length, 0); assert.equal(after.payments.length, 0);
      assert.equal(await prisma.couponRedemption.count({ where: { merchantId, couponId, status: { not: "cancelled" } } }), 0);
      assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: couponId } })).usagesCount, 0);
    });
    for (const action of ["coupon", "clear", "last"]) for (const stage of ["cas", "cancel", "commit"]) await check(`legacy ${action} ${stage} failure rolls source and reservation back together`, async () => {
      const cartId = await seed(`legacy-release-${stage}-fault`), before = await state(cartId);
      await assert.rejects(command(action, cartId)); assert.deepEqual(await state(cartId), before);
    });
    await check("lost acknowledgement propagates exact unknown error after one actual committed cancellation without retry", async () => {
      const cartId = await seed(), before = await state(cartId), fault = new Error("synthetic_legacy_ack_lost"); let transactions = 0;
      const uncertain = new PrismaStorefrontCartRepository(new Proxy(prisma, { get(target, key) {
        if (key === "$transaction") return async (...args) => { const result = await target.$transaction(...args); transactions++; throw fault; };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } }));
      await assert.rejects(command("coupon", cartId, uncertain), error => error === fault); assert.equal(transactions, 1);
      const after = await state(cartId); assert.equal(after.reservations[0].status, "cancelled"); assert.equal(after.cart.couponCode, null);
      assert.deepEqual(after.cart.items, before.cart.items); assert.equal(after.cart.total, 18000); assert.equal(after.outbox.length, 0);
    });
    for (const status of ["unknown", "paid"]) for (const action of ["coupon", "clear", "last"]) await check(`legacy ${action} preserves another checkout cart_ref with ${status} payment`, async () => {
      const cartId = await seed(), checkoutId = "legacy-other-checkout";
      await prisma.checkoutSession.create({ data: { id: "legacy-checkout-row", merchantId, sessionId: checkoutId, globalUserId: "synthetic-buyer",
        conversationId: "synthetic-conversation", cart: { source: "storefront", cart_ref: cartId, total: 180, currentDiscount: 5, items: [] },
        createdAt: new Date(), updatedAt: new Date() } });
      await prisma.paymentIntent.create({ data: { id: "legacy-existing-payment", merchantId, sessionId: checkoutId, idempotencyKey: "legacy-existing-key",
        amountCents: 17500, currency: "BRL", method: "pix", status: status === "paid" ? "approved" : "pending",
        ...(status === "paid" ? { providerPaymentId: "synthetic-paid-reference", approvedAmountCents: 17500 } : {}),
        creation: { state: status === "paid" ? "complete" : "uncertain", input: { merchantId, sessionId: checkoutId,
          intentId: "legacy-existing-payment", amountCents: 17500, currency: "BRL", method: "pix" } } } });
      const before = await state(cartId); await assert.rejects(command(action, cartId), review); assert.deepEqual(await state(cartId), before);
    });
    for (const action of ["coupon", "clear", "last"]) await check(`legacy shipping D0 ${action} remains explicit review instead of orphan release`, async () => {
      const cartId = await seed(); await prisma.storefrontCart.update({ where: { id: cartId }, data: { discount: 0, freeShipping: true } });
      await prisma.couponRedemption.update({ where: { id: "legacy-release-reservation" }, data: { discountApplied: 0 } });
      await prisma.coupon.update({ where: { id: couponId }, data: { discountType: "shipping_free", discountValue: 0 } });
      const before = await state(cartId); await assert.rejects(command(action, cartId), review); assert.deepEqual(await state(cartId), before);
    });
    return { checks: passed, legacyReleaseOnly: true, realPrismaTransactions: true, historicalRowsSeeded: true };
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", test: active, checksPassed: passed, errorName: error?.name ?? "unknown", code: typeof error?.code === "string" ? error.code : undefined }));
    throw error;
  }
}
