import assert from "node:assert/strict";

// Actual repositories/Prisma/PG; only the provider transport and event bus are
// synthetic. No real authorization HTTP, browser, provider or old-journal backfill.
export async function runStorefrontCouponSourceBasisNative({ prisma, runId, seed, check, merchantId, cartId, buyerId }) {
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  assert.equal(merchantId, "synthetic-admission-merchant"); assert.equal(cartId, "synthetic-admission-cart");
  const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const { ResumePaymentCreationService } = await import("../src/modules/payment/application/resume-payment-creation.service.ts");
  const { PaymentCreationRejectedError } = await import("../src/modules/payment/domain/payment-creation-rejected.error.ts");
  const { captureStorefrontCouponForPayment, readStorefrontCouponForCheckout } = await import("../src/shared/persistence/storefront-coupon/admission.ts");
  const { toCheckoutSession } = await import("../src/modules/checkout/infrastructure/prisma/checkout-session.mapper.ts");
  const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const { lockCheckoutSessionAnchor } = await import("../src/shared/persistence/checkout-session-lock.ts");
  const { lockStorefrontCart } = await import("../src/shared/persistence/storefront-cart-lock.ts");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const { CouponsOnOrderCompletedHandler } = await import("../src/modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts");
  const { PrismaBoundCouponRedemption } = await import("../src/modules/coupons/infrastructure/repositories/prisma-bound-coupon-redemption.ts");
  const { RedeemCouponUseCase } = await import("../src/modules/coupons/application/use-cases/redeem-coupon.use-case.ts");
  const { PrismaCouponTransactionRepository } = await import("../src/modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts");
  const { InMemoryDomainEventBus } = await import("../src/shared/events/in-memory-domain-event-bus.ts");
  const repository = new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment);
  const checkoutId = "checkout_1", variantId = "synthetic-variant", productId = "synthetic-product";
  const scope = { merchantId, cartId, checkoutSessionId: checkoutId, buyerId };
  const shipping = { customerPrice: 5, realCost: 5, region: "SP" };
  const selected = { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 1000 };
  const make = async ({ paidOptions = false, mixed = false } = {}) => {
    await seed();
    const metadata = paidOptions ? { optionGroups: [{ id: "size", name: "Tamanho", required: false, selectionType: "single",
      items: [{ id: "large", name: "Grande", priceModifierInCents: 1000 }] }] } : {};
    for (const [id, vId, sku, base, config] of [[productId, variantId, "SYNTHETIC", paidOptions ? 9000 : 10000, metadata],
      ["basis-other-product", "basis-other-variant", "OTHER", 5000, {}]]) {
      await prisma.product.upsert({ where: { id }, create: { id, merchantId, name: "Synthetic historical only", type: "physical", metadata: config },
        update: { merchantId, metadata: config, isActive: true, deletedAt: null } });
      await prisma.productVariant.upsert({ where: { id: vId }, create: { id: vId, productId: id, sku }, update: { productId: id, sku, isActive: true } });
      await prisma.productPrice.upsert({ where: { variantId: vId }, create: { id: `price-${vId}`, variantId: vId, basePriceInCents: base, currency: "BRL", costInCents: null },
        update: { basePriceInCents: base, currency: "BRL", costInCents: null } });
    }
    const quantity = mixed ? 1 : 2;
    const items = [{ variantId, productId, sku: "SYNTHETIC", name: "Saved", quantity, unitPriceCents: 9000,
      ...(paidOptions ? { selectedOptions: [selected] } : {}) },
    ...(mixed ? [{ variantId: "basis-other-variant", productId: "basis-other-product", sku: "OTHER", name: "Other", quantity: 1, unitPriceCents: 5000 }] : [])];
    const cart = { currency: "BRL", source: "storefront", cart_ref: cartId, total: mixed ? 135 : 180, currentDiscount: 10,
      commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Synthetic source", couponCode: "SAVE10" },
      discountBudget: { version: 1, originalSubtotalCents: mixed ? 15000 : 20000, promotionDiscountCents: mixed ? 1500 : 2000 },
      items: [{ variantId, product_id: productId, sku: "SYNTHETIC", name: "Saved", quantity, price: 90, originalPrice: 100,
        variant: JSON.stringify([variantId, paidOptions ? ["large"] : []]),
        ...(paidOptions ? { selected_options: [{ group_name: "Tamanho", item_name: "Grande", price_modifier: 10 }] } : {}) },
      ...(mixed ? [{ variantId: "basis-other-variant", product_id: "basis-other-product", sku: "OTHER", name: "Other", quantity: 1,
        price: 45, originalPrice: 50, variant: JSON.stringify(["basis-other-variant", []]) }] : [])] };
    await prisma.storefrontCart.update({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } }, data: { items, total: mixed ? 14000 : 18000 } });
    await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutId } }, data: { cart, shipping } });
    await prisma.coupon.update({ where: { id: "synthetic-coupon" }, data: { discountType: "fixed", discountValue: 10 } });
    await prisma.merchantRule.update({ where: { merchantId }, data: { maxDiscountPercent: 20, minimumMarginPercent: 100 } });
    return cart;
  };
  const state = async () => ({ source: await prisma.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } }),
    checkout: await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutId } } }),
    reservations: await prisma.couponRedemption.findMany({ where: { merchantId }, orderBy: { id: "asc" } }),
    payments: await prisma.paymentIntent.findMany({ where: { merchantId }, orderBy: { id: "asc" } }),
    settlements: await prisma.paymentSettlement.findMany({ where: { merchantId }, orderBy: { id: "asc" } }),
    events: await prisma.outboxMessage.findMany({ where: { merchantId }, orderBy: { eventId: "asc" } }) });
  const readInTransaction = async tx => {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${merchantId} FOR UPDATE`;
    await lockCheckoutSessionAnchor(tx, merchantId, checkoutId);
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${merchantId} AND session_id=${checkoutId} FOR UPDATE`;
    await lockStorefrontCart(tx, merchantId, cartId);
    return readStorefrontCouponForCheckout(tx, toCheckoutSession(await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutId } } })));
  };
  const read = () => prisma.$transaction(readInTransaction, { isolationLevel: "ReadCommitted" });
  const intent = cart => {
    const itemsSubtotalCents = Math.round(cart.total * 100), amountCents = itemsSubtotalCents - 1000 + 599;
    const value = PaymentIntentEntity.create({ merchantId, sessionId: checkoutId, idempotencyKey: `basis-${runId}`, method: "pix", currency: "BRL", amountCents,
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents, discountCents: 1000, shippingCents: 500, platformFeeCents: 99, totalCents: amountCents,
        cartFingerprint: paymentCartFingerprint({ cart, shipping }) } });
    value.prepareCreation({ intentId: value.id, merchantId, sessionId: checkoutId, method: "pix", currency: "BRL", amountCents, provider: "mercadopago" }); return value;
  };
  const admit = (value, owner = repository) => {
    const snapshot = value.snapshot(), amount = snapshot.amountCents;
    return owner.saveIntentWithSettlementPlan({ intent: value, storefrontCouponScope: scope, settlementPlan: {
      merchantId, paymentIntentId: value.id, provider: "mercadopago", currency: "BRL", providerReference: `basis-${value.id}`,
      plannedGrossCents: amount, plannedPlatformFeeCents: 99, plannedMerchantNetCents: amount - 99, plannedProviderFeeCents: 0, occurredAt: new Date(0),
      entries: [{ entryKey: "platform_fee", entryType: "platform_fee", direction: "credit", recipientType: "platform", plannedAmountCents: 99 },
        { entryKey: "merchant_payout", entryType: "merchant_payout", direction: "credit", recipientType: "merchant", recipientReference: merchantId, plannedAmountCents: amount - 99 }] } });
  };
  const transport = error => { let calls = 0; return { calls: () => calls, async createPayment(input) {
    calls++; for (const key of ["couponAuthority", "coupon_authority", "_storefrontCouponBinding"]) assert.equal(Object.hasOwn(input, key), false);
    if (error) throw error;
    return { providerPaymentId: `basis-provider-${input.intentId}`, buyerFacingPayload: { qrCodeCopyPaste: "synthetic-only" } };
  }, async recoverPayment() { assert.fail("no_auto_provider_retry"); } }; };
  const rejected = async cart => {
    const value = intent(cart); await admit(value); const fake = transport(new PaymentCreationRejectedError("mercadopago_pix_key_required"));
    await assert.rejects(new ResumePaymentCreationService(repository, fake).execute(value), error => error.message === "mercadopago_pix_key_required");
    assert.equal(fake.calls(), 1); return value;
  };
  for (const shape of [{}, { paidOptions: true }, { mixed: true }, { paidOptions: true, mixed: true }]) {
    await check(`native historical B/S/T read capture first-send and exact order ${JSON.stringify(shape)}`, async () => {
      const cart = await make(shape), before = await state(), candidate = await read();
      assert.equal(candidate.discountCents, 1000); assert.deepEqual(await state(), before);
      const value = intent(cart); await admit(value); assert.equal(value.snapshot().creation.couponAuthority.cartId, cartId);
      const fake = transport(); await new ResumePaymentCreationService(repository, fake).execute(value); assert.equal(fake.calls(), 1);
      const amount = value.snapshot().amountCents;
      value.markApproved({ providerPaymentId: value.snapshot().providerPaymentId, approvedAmountCents: amount }); await repository.saveIntent({ intent: value });
      const repo = new PrismaCheckoutRepository(prisma), reader = new PrismaPaymentApprovalReader(prisma);
      const complete = new CompleteOrderUseCase(repo, repo, repo, undefined, undefined, undefined, undefined, repo,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reader);
      await complete.executePaymentApproval({ merchant_id: merchantId, session_id: checkoutId, external_order_id: value.snapshot().providerPaymentId,
        order_total: (amount - 99) / 100, currency: "BRL" }, value.id);
      const event = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, eventType: "order.completed" } });
      assert.equal(event.payload.coupon_authority.cartId, cartId); assert.equal(event.payload.coupon_authority.checkoutSessionId, checkoutId);
      const bus = new InMemoryDomainEventBus();
      new CouponsOnOrderCompletedHandler(bus, new RedeemCouponUseCase(new PrismaCouponTransactionRepository(prisma)), repo,
        new PrismaBoundCouponRedemption(prisma)).onModuleInit();
      const delivery = { eventId: event.eventId, eventType: event.eventType, merchantId, payload: event.payload };
      await bus.publish(delivery); await bus.publish(delivery);
      const after = await state(); assert.equal(after.reservations[0].status, "redeemed"); assert.equal(after.reservations[0].sessionId, cartId);
      assert.deepEqual(after.source.items, before.source.items); assert.equal(after.source.total, shape.mixed ? 14000 : 18000);
      assert.equal(after.events.filter(row => row.eventType === "coupon.redeemed").length, 1);
      assert.equal((await prisma.coupon.findUniqueOrThrow({ where: { id: "synthetic-coupon" } })).usagesCount, 1);
      if (shape.mixed) { assert.equal(amount, 13099); assert.equal(cart.discountBudget.promotionDiscountCents, 1500); assert.equal(cart.total * 100 - 1000, 12500); }
    });
  }
  for (const shape of [{}, { paidOptions: true }, { mixed: true }]) await check(`native definitive release preserves historical source after catalog drift ${JSON.stringify(shape)}`, async () => {
    const cart = await make(shape); await rejected(cart); const before = await state();
    await prisma.productPrice.update({ where: { variantId }, data: { basePriceInCents: 99999 } });
    await prisma.product.update({ where: { id: productId }, data: { isActive: false, metadata: { changed: true } } });
    await prisma.coupon.update({ where: { id: "synthetic-coupon" }, data: { status: "expired", endsAt: new Date(0) } });
    await new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, checkoutId, "address");
    const after = await state(); assert.equal(after.reservations[0].status, "cancelled"); assert.equal(after.source.couponCode, null); assert.equal(after.source.discount, 0);
    assert.deepEqual(after.source.items, before.source.items); assert.equal(after.checkout.cart._storefrontCouponBinding.state, "released");
    assert.equal(after.events.filter(row => row.eventType === "checkout.cart.updated" && row.payload.coupon_release).length, 1);
  });
  for (const changed of ["forged hints", "changed catalog", "changed options", "over cap"]) await check(`native historical admission refuses ${changed} without binding journal or settlement`, async () => {
    const cart = await make({ paidOptions: true });
    if (changed === "forged hints") { cart.items[0].originalPrice = 110; cart.discountBudget = { version: 1, originalSubtotalCents: 22000, promotionDiscountCents: 4000 };
      await prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutId } }, data: { cart } }); }
    if (changed === "changed catalog") await prisma.productPrice.update({ where: { variantId }, data: { basePriceInCents: 9001 } });
    if (changed === "changed options") await prisma.product.update({ where: { id: productId }, data: { metadata: {} } });
    if (changed === "over cap") await prisma.merchantRule.update({ where: { merchantId }, data: { maxDiscountPercent: 5 } });
    const before = await state(); await assert.rejects(admit(intent(cart))); assert.deepEqual(await state(), before);
  });
  await check("native historical source CAS loser rolls cancellation and bound state back together", async () => {
    const cart = await make({ paidOptions: true }); await rejected(cart);
    await prisma.$executeRaw`INSERT INTO synthetic_bound_faults(kind) VALUES('source_cas')`;
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, checkoutId, "address"));
    assert.deepEqual(await state(), before);
  });
  await check("native uncertain historical dispatch cannot release source or reservation", async () => {
    const cart = await make(); const value = intent(cart); await admit(value); const fake = transport(new Error("synthetic_unknown_transport"));
    await assert.rejects(new ResumePaymentCreationService(repository, fake).execute(value)); assert.equal(fake.calls(), 1);
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, checkoutId, "address"));
    assert.deepEqual(await state(), before);
  });
  await check("native approved historical payment cannot release source before order consumption", async () => {
    const cart = await make(), value = intent(cart); await admit(value); const fake = transport();
    await new ResumePaymentCreationService(repository, fake).execute(value);
    value.markApproved({ providerPaymentId: value.snapshot().providerPaymentId, approvedAmountCents: value.snapshot().amountCents });
    await repository.saveIntent({ intent: value });
    const before = await state(); await assert.rejects(new PrismaCheckoutRepository(prisma).reopenForBuyerEdit(merchantId, checkoutId, "address"));
    assert.deepEqual(await state(), before);
  });
  await check("native historical proof reads its uncommitted catalog in the same transaction and rolls it back", async () => {
    await make({ paidOptions: true }); const before = await state();
    await assert.rejects(prisma.$transaction(async tx => {
      assert.equal((await readInTransaction(tx)).discountCents, 1000);
      await tx.productPrice.update({ where: { variantId }, data: { basePriceInCents: 9001 } });
      const row = await tx.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: checkoutId } } });
      await readStorefrontCouponForCheckout(tx, toCheckoutSession(row));
    }, { isolationLevel: "ReadCommitted" }), error => error.message === "checkout_coupon_binding_conflict");
    assert.equal((await prisma.productPrice.findUniqueOrThrow({ where: { variantId } })).basePriceInCents, 9000);
    assert.deepEqual(await state(), before);
  });
  await check("native lost admission ACK retains actual historical binding journal and exact reservation", async () => {
    const cart = await make({ mixed: true }), value = intent(cart), lost = new Error("synthetic_lost_admission_ack");
    // Transport-ACK fault around an ACTUAL Prisma transaction, not a transaction
    // delegate replacement: SQL commits first, then only its acknowledgement is lost.
    const intercepted = new Proxy(prisma, { get(target, property) {
      if (property === "$transaction") return async (...args) => { await target.$transaction(...args); throw lost; };
      const result = Reflect.get(target, property); return typeof result === "function" ? result.bind(target) : result;
    } });
    const owner = new PrismaPaymentRepository(intercepted, captureStorefrontCouponForPayment);
    await assert.rejects(admit(value, owner), error => error === lost);
    const committed = await state(); assert.equal(committed.payments.length, 1); assert.equal(committed.settlements.length, 1);
    const recovered = await repository.getByIdempotency(merchantId, checkoutId, value.snapshot().idempotencyKey);
    assert.ok(recovered.snapshot().creation.couponAuthority); assert.equal(committed.reservations[0].status, "applied");
    const fake = transport(); await new ResumePaymentCreationService(repository, fake).execute(recovered); assert.equal(fake.calls(), 1);
    assert.equal((await state()).payments.length, 1);
  });
}
