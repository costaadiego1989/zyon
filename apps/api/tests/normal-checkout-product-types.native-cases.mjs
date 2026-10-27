import assert from "node:assert/strict";

/** Actual owned PostgreSQL catalog/acceptance/payment/order transactions.
 * Approval is explicitly synthetic: no PSP, webhook, digital provisioner,
 * service booking, email or other external delivery is invoked or claimed. */
export async function runNormalCheckoutProductTypesNativeCases({ prisma, check, runId }) {
  assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runId }]);
  const { PrismaNormalCheckoutCrossSellAdapter, projectNormalCrossSellCart } = await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.adapter.ts");
  const { readNormalCheckoutCrossSellAuthority } = await import("../src/modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.ts");
  const { createNormalCrossSellPaymentAdmission } = await import("../src/modules/payment/infrastructure/prisma-normal-cross-sell-payment-admission.ts");
  const { captureStorefrontCouponForPayment } = await import("../src/shared/persistence/storefront-coupon/admission.ts");
  const { PaymentIntentEntity } = await import("../src/modules/payment/domain/payment-intent.entity.ts");
  const { PrismaPaymentRepository } = await import("../src/modules/payment/infrastructure/prisma-payment.repository.ts");
  const { PrismaCheckoutRepository } = await import("../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts");
  const { PrismaPaymentApprovalReader } = await import("../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.ts");
  const { CompleteOrderUseCase } = await import("../src/modules/checkout/application/use-cases/complete-order.use-case.ts");
  const { paymentCartFingerprint } = await import("../src/modules/checkout/domain/services/payment-cart-fingerprint.ts");
  const merchantId = "synthetic-normal-product-types", adapter = new PrismaNormalCheckoutCrossSellAdapter(prisma);
  const reader = async (tx, scope, options) => {
    const current = await readNormalCheckoutCrossSellAuthority(tx, scope, undefined, options);
    return { ...current, projectedCart: projectNormalCrossSellCart(current) };
  };
  const payment = new PrismaPaymentRepository(prisma, captureStorefrontCouponForPayment, undefined,
    createNormalCrossSellPaymentAdmission(reader, () => 149));
  const checkout = new PrismaCheckoutRepository(prisma), approvalReader = new PrismaPaymentApprovalReader(prisma);
  const complete = new CompleteOrderUseCase(checkout, checkout, checkout, undefined, undefined, undefined, undefined, checkout,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, approvalReader);
  await prisma.$executeRaw`INSERT INTO merchants(id,name,updated_at) VALUES (${merchantId},'Synthetic product-type coverage',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO merchant_rules(id,merchant_id,max_discount_percent,minimum_margin_percent,allow_free_shipping,allow_shipping_discount,
    allow_bonus_item,allow_stack_discount_and_free_shipping,coupon_box_enabled,autonomous_engine_enabled,free_shipping_min_cart_value,max_shipping_subsidy,
    max_partial_shipping_discount,offer_expiration_minutes,blocked_regions,brand_voice,updated_at)
    VALUES (${merchantId},${merchantId},20,99,false,false,false,false,true,true,0,0,0,30,ARRAY[]::text[],'consultative',CURRENT_TIMESTAMP)`;
  await prisma.$executeRaw`INSERT INTO checkout_settings(id,merchant_id,advanced_rules) VALUES (${merchantId},${merchantId},'[]'::jsonb)`;
  const optionGroups = [{ id: "size", name: "Size", required: true, selectionType: "single",
    items: [{ id: "large", name: "Large", priceModifierInCents: 500 }] }];
  const stocked = type => type === "physical" || type === "food";
  const strategy = type => type === "digital" ? "digital" : type === "service" ? "service" : "carrier";
  const session = s => prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: s.scope } });
  const source = s => s.sourceBacked ? prisma.storefrontCart.findUniqueOrThrow({ where: {
    merchantId_sessionId: { merchantId, sessionId: s.cartId } } }) : null;
  const journal = intent => prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
  async function state(s) {
    return { session: await session(s), source: await source(s),
      suggestions: await prisma.crossSellSuggestion.findMany({ where: s.scope, orderBy: { id: "asc" } }),
      events: await prisma.checkoutEvent.findMany({ where: s.scope, orderBy: { id: "asc" } }),
      outbox: await prisma.outboxMessage.findMany({ where: { merchantId, causationId: s.suggestionId }, orderBy: { eventId: "asc" } }),
      payments: await prisma.paymentIntent.findMany({ where: s.scope }), orders: await prisma.completedOrder.findMany({ where: s.scope }) };
  }
  async function seed(label, { triggerType = "physical", targetType = triggerType, sourceBacked = false, scheduled = false } = {}) {
    const prefix = `normal-types-${label}`, scope = { merchantId, sessionId: prefix }, cartId = `${prefix}-source`;
    const buyerId = `${prefix}-buyer`, triggerId = `${prefix}-trigger`, targetId = `${prefix}-target`, suggestionId = `${prefix}-suggestion`;
    const productIds = [triggerId, targetId].map(id => `${id}-product`), types = [triggerType, targetType];
    const sku = [`TYPE_${label}_TRIGGER`, `TYPE_${label}_TARGET`];
    const metadata = types.map((type, index) => ({ ...(index === 1 || type === "food" ? { optionGroups: index === 1 ? optionGroups : [] } : {}),
      ...(type === "digital" ? { downloadUrl: `https://example.test/${label}-${index}.pdf` } : {}),
      ...(type === "service" ? { serviceType: "remoto" } : {}),
      ...(index === 1 && scheduled ? { serviceSchedule: { timeZone: "UTC", durationMinutes: 30,
        slots: [{ id: "canonical-slot", date: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10), startTime: "12:00" }] } } : {}) }));
    for (const [index, variantId] of [triggerId, targetId].entries()) {
      await prisma.$executeRaw`INSERT INTO products(id,merchant_id,name,type,metadata,updated_at)
        VALUES (${productIds[index]},${merchantId},${sku[index]},${types[index]},${JSON.stringify(metadata[index])}::jsonb,CURRENT_TIMESTAMP)`;
      await prisma.$executeRaw`INSERT INTO product_variants(id,product_id,sku,updated_at) VALUES (${variantId},${productIds[index]},${sku[index]},CURRENT_TIMESTAMP)`;
      await prisma.$executeRaw`INSERT INTO product_prices(id,variant_id,base_price_in_cents) VALUES (${variantId},${variantId},5000)`;
      if (stocked(types[index])) await prisma.$executeRaw`INSERT INTO product_stock(id,variant_id,quantity,reserved) VALUES (${variantId},${variantId},100,0)`;
    }
    const customer = { fullName: "Synthetic Buyer", email: `${prefix}@example.test`, cpf: "12345678901", phone: "11987654321", email_verified: true };
    const physical = types.some(stocked);
    if (physical) Object.assign(customer, { address_verified: true, address: { zip: "01310100", street: "Synthetic", number: "1", complement: "",
      neighborhood: "Synthetic", city: "Synthetic City", state: "SP" } });
    const cart = { currency: "BRL", source: sourceBacked ? "storefront" : "checkout", ...(sourceBacked ? { cart_ref: cartId } : {}),
      total: 50, currentDiscount: 0, items: [{ sku: sku[0], variantId: triggerId, product_id: productIds[0], name: sku[0], productType: triggerType,
        quantity: 1, price: 50, variant: JSON.stringify([triggerId, []]) }] };
    if (sourceBacked) await prisma.storefrontCart.create({ data: { id: cartId, merchantId, sessionId: cartId,
      items: [{ variantId: triggerId, productId: productIds[0], sku: sku[0], name: sku[0], quantity: 1, unitPriceCents: 5000 }],
      total: 5000, discount: 0, couponCode: null, freeShipping: false, expiresAt: new Date(Date.now() + 3600_000) }, select: { id: true } });
    await prisma.checkoutSession.create({ data: { id: prefix, ...scope, globalUserId: buyerId, conversationId: `${prefix}-conversation`,
      cart, customer, createdAt: new Date(), updatedAt: new Date() }, select: { id: true } });
    const promoId = `${prefix}-promo`;
    await prisma.crossSellPromotion.create({ data: { id: promoId, merchantId, name: "Synthetic product-type offer", trigger: { sku_in_cart: [sku[0]] },
      recommendedSkus: [sku[1]], discountPercent: 10, maxDiscountPercent: 10, status: "active", startsAt: new Date(Date.now() - 60_000) }, select: { id: true } });
    await prisma.crossSellSuggestion.create({ data: { id: suggestionId, ...scope, promoId, rankedItems: [sku[1]], agentCopy: "Synthetic", computedDiscount: 10,
      status: "pending", suggestedAt: new Date() }, select: { id: true } });
    return { scope, cartId, sourceBacked, buyerId, suggestionId, triggerId, targetId, productIds, sku, types, metadata, physical, customer,
      request: { suggestion_id: suggestionId, targets: [{ sku: sku[1], variant_id: targetId, quantity: 1, selected_option_item_ids: ["large"] }] } };
  }
  async function accept(s) {
    const quote = await adapter.quote(s.scope, s.request);
    assert.equal(quote.pricing.originalSubtotalCents, 10500); assert.equal(quote.pricing.promotionDiscountCents, 550);
    assert.equal(quote.pricing.merchandiseSubtotalCents, 9950); assert.equal(quote.pricing.cartDiscountCents, 0);
    assert.deepEqual(quote.pricing.targets[0].selectedOptionItemIds, ["large"]);
    const input = { suggestion_id: s.suggestionId, accepted_skus: [s.sku[1]], expected_quote: quote };
    const ack = await adapter.accept(s.scope, input), committed = await state(s);
    assert.deepEqual(await adapter.accept(s.scope, input), ack); assert.deepEqual(await state(s), committed);
    if (s.sourceBacked) assert.equal((await source(s)).total, 10500);
    return quote;
  }
  async function makeIntent(s) {
    const current = await adapter.read(s.scope), shippingCents = s.physical ? 900 : 0;
    const breakdown = { version: 1, currency: "BRL", cartFingerprint: paymentCartFingerprint(current), itemsSubtotalCents: 9950,
      discountCents: 0, shippingCents, platformFeeCents: 149, totalCents: 10099 + shippingCents };
    const intent = PaymentIntentEntity.create({ ...s.scope, idempotencyKey: `${s.scope.sessionId}-payment`, amountCents: breakdown.totalCents,
      currency: "BRL", method: "pix", amountBreakdown: breakdown });
    intent.prepareCreation({ ...s.scope, intentId: intent.id, amountCents: breakdown.totalCents, currency: "BRL", method: "pix" });
    return { intent, breakdown };
  }
  async function selectDelivery(s) {
    if (s.physical) await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: {
      shipping: { customerPrice: 9, carrier: "Synthetic carrier", method: "Synthetic selected delivery", deliveryDays: 1, destinationZip: "01310100", region: "SP" },
    }, select: { id: true } });
  }
  for (const [label, options] of [["physical", {}], ["food", { triggerType: "food" }],
    ["digital", { triggerType: "digital", sourceBacked: true }], ["service", { triggerType: "service" }],
    ["mixed", { triggerType: "physical", targetType: "digital", sourceBacked: true }]]) {
    await check(`normal SQL ${label} catalog/options to frozen synthetic-approved order exactly once`, async () => {
      const s = await seed(label, options); await accept(s);
      if (s.physical) {
        const { intent } = await makeIntent(s);
        await assert.rejects(payment.saveIntent({ intent }), /payment_normal_cross_sell_authority_conflict/);
        assert.equal(await prisma.paymentIntent.count({ where: s.scope }), 0);
      }
      await selectDelivery(s);
      const { intent, breakdown } = await makeIntent(s);
      await payment.saveIntent({ intent });
      const firstJournal = await journal(intent), admitted = firstJournal.creation.normalCrossSellAuthority;
      const digitalCount = s.types.filter(type => type === "digital").length;
      assert.equal(firstJournal.digitalContent.length, digitalCount);
      assert.equal(admitted.amountCents, s.physical ? 10999 : 10099);
      assert.equal(admitted.amountBreakdown.shippingCents, s.physical ? 900 : 0);
      assert.equal(admitted.frozenProjection.cart.discountBudget.promotionDiscountCents, 550);
      assert.equal(admitted.frozenProjection.cart.items.find(item => item.sku === s.sku[1]).selected_options[0].price_modifier, 5);
      assert.equal("widgetCheckoutAuthority" in (await journal(intent)).creation, false);
      if (!s.physical) {
        assert.equal(admitted.frozenProjection.shipping, undefined);
        assert.equal(admitted.frozenProjection.customer.address, undefined);
        assert.equal(admitted.frozenProjection.customer.address_verified, undefined);
      }
      for (const [index, id] of [s.triggerId, s.targetId].entries())
        assert.equal(await prisma.productStock.count({ where: { variantId: id } }), stocked(s.types[index]) ? 1 : 0);
      intent.claimCreation("synthetic-first-send", new Date()); await payment.saveIntent({ intent });
      assert.deepEqual((await journal(intent)).creation.normalCrossSellAuthority, admitted);
      assert.deepEqual((await journal(intent)).digitalContent, firstJournal.digitalContent);
      intent.completeCreation("synthetic-first-send");
      const providerId = `${s.scope.sessionId}-synthetic-provider`;
      intent.markApproved({ providerPaymentId: providerId, approvedAmountCents: breakdown.totalCents });
      await payment.saveIntent({ intent });
      // Prove historical completion does not consult current prices. The pure
      // digital case also changes the mutable session email: provisioning must
      // remain tied to the actual approved frozen buyer, not that later hint.
      // The reviewed native price projection intentionally has no @updatedAt
      // column; mutate its real canonical cents through the same parameterized
      // SQL seam as the existing native price-drift cases, not Prisma's implicit
      // timestamp write. Do not broaden the fixture to conceal this limitation.
      assert.equal(await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=9999 WHERE variant_id=${s.targetId}`, 1);
      if (label === "digital") await prisma.checkoutSession.update({ where: { merchantId_sessionId: s.scope }, data: {
        customer: { ...s.customer, email: "different-synthetic-buyer@example.test" },
      }, select: { id: true } });
      const input = { merchant_id: merchantId, session_id: s.scope.sessionId, external_order_id: providerId,
        order_total: (9950 + breakdown.shippingCents) / 100, currency: "BRL" };
      assert.equal((await complete.executePaymentApproval(input, intent.id)).idempotent, false);
      const order = await prisma.completedOrder.findFirstOrThrow({ where: s.scope });
      assert.equal(Number(order.orderTotal), s.physical ? 108.5 : 99.5); assert.equal(order.shippingCents, s.physical ? 900 : null);
      assert.deepEqual(order.lineItemsJson.map(item => [item.sku, item.unitPriceCents, item.productType, item.fulfillmentStrategy]),
        admitted.frozenProjection.cart.items.map(item => [item.sku, Math.round(item.price * 100), item.productType, item.fulfillmentStrategy]));
      const event = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId, eventType: "order.completed", payload: { path: ["payment_intent_id"], equals: intent.id } } });
      assert.deepEqual(event.payload.fulfillment_snapshot, { version: 2, lines: order.lineItemsJson });
      assert.deepEqual(event.payload.inventory_sale.items.map(item => item.sku).sort(), s.sku.filter((_, index) => stocked(s.types[index])).sort());
      for (const [index, type] of s.types.entries()) {
        const line = order.lineItemsJson.find(item => item.sku === s.sku[index]);
        assert.equal(line.productType, type); assert.equal(line.fulfillmentStrategy, strategy(type));
      }
      assert.equal(order.fulfillmentJson.schemaVersion, 1);
      assert.deepEqual(order.fulfillmentJson.units.map(unit => [unit.sku, unit.productType, unit.strategy]),
        order.lineItemsJson.map(line => [line.sku, line.productType, line.fulfillmentStrategy]));
      const entitlements = await prisma.digitalEntitlement.findMany({ where: { merchantId, orderId: order.id }, orderBy: { variantId: "asc" } });
      assert.equal(entitlements.length, digitalCount);
      for (const entitlement of entitlements) {
        assert.equal(entitlement.paymentIntentId, intent.id); assert.equal(entitlement.status, "active");
        assert.equal(entitlement.downloadCount, 0);
        const content = firstJournal.digitalContent.find(item => item.variantId === entitlement.variantId);
        assert.ok(content); assert.equal(entitlement.downloadUrl, content.downloadUrl);
        const deliveries = await prisma.digitalDelivery.findMany({ where: { merchantId, entitlementId: entitlement.id }, orderBy: { channel: "asc" } });
        assert.deepEqual(deliveries.map(item => [item.channel, item.destination, item.status, item.providerId]),
          [["email", s.customer.email, "pending", null], ["whatsapp", s.customer.phone, "pending", null]]);
        for (const delivery of deliveries) assert.equal(await prisma.outboxMessage.count({ where: { merchantId, eventType: "digital.delivery.requested",
          payload: { path: ["deliveryId"], equals: delivery.id } } }), 1);
      }
      const outboxCount = await prisma.outboxMessage.count({ where: { merchantId } });
      assert.equal((await complete.executePaymentApproval(input, intent.id)).idempotent, true);
      assert.equal(await prisma.completedOrder.count({ where: s.scope }), 1);
      assert.equal(await prisma.paymentIntent.count({ where: s.scope }), 1);
      assert.equal(await prisma.outboxMessage.count({ where: { merchantId } }), outboxCount);
      assert.deepEqual(await prisma.digitalEntitlement.findMany({ where: { merchantId, orderId: order.id }, orderBy: { variantId: "asc" } }), entitlements);
      assert.equal(await prisma.outboxMessage.count({ where: { merchantId, eventType: "order.completed", payload: { path: ["payment_intent_id"], equals: intent.id } } }), 1);
    });
  }
  await check("normal SQL scheduled service remains slot-required with no commercial writes", async () => {
    const s = await seed("scheduled", { triggerType: "service", scheduled: true }), before = await state(s);
    await assert.rejects(adapter.quote(s.scope, s.request), { code: "cross_sell_quote_review_required", reason: "service_slot_required" });
    assert.deepEqual(await state(s), before);
  });
  async function mutateDigitalConfiguration(s) {
    await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify({ ...s.metadata[1], downloadUrl: "https://example.test/replaced.pdf" })}::jsonb,
      updated_at=updated_at+INTERVAL '1 second' WHERE id=${s.productIds[1]} AND merchant_id=${merchantId}`;
  }
  await check("normal SQL unchanged-price digital configuration invalidates the displayed quote before acceptance", async () => {
    const s = await seed("stale-quote", { triggerType: "digital", sourceBacked: true }), quote = await adapter.quote(s.scope, s.request);
    await mutateDigitalConfiguration(s);
    const fresh = await adapter.quote(s.scope, s.request), before = await state(s);
    assert.deepEqual(fresh.pricing, quote.pricing); assert.notEqual(fresh.basisHash, quote.basisHash);
    await assert.rejects(adapter.accept(s.scope, { suggestion_id: s.suggestionId, accepted_skus: [s.sku[1]], expected_quote: quote }),
      { code: "cross_sell_quote_review_required", reason: "quote_changed" });
    assert.deepEqual(await state(s), before);
  });
  await check("normal SQL digital configuration drift after admission cannot commit the first-send lease", async () => {
    const s = await seed("stale-send", { triggerType: "digital", sourceBacked: true }); await accept(s);
    const { intent } = await makeIntent(s); await payment.saveIntent({ intent });
    const before = await journal(intent); await mutateDigitalConfiguration(s);
    intent.claimCreation("stale-first-send", new Date());
    await assert.rejects(payment.saveIntent({ intent }), { code: "cross_sell_quote_review_required", reason: "payment_source_changed" });
    assert.deepEqual(await journal(intent), before);
    assert.equal(await prisma.completedOrder.count({ where: s.scope }), 0);
  });
}
