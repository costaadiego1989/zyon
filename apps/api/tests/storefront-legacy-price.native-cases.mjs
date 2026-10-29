import assert from "node:assert/strict";

// Explicit focal suite, not the old claimed-V1/default authority suite. Historical
// margin assertions in that default suite are NOT executed or certified here.
// Uses the real legacy repository and canonical reader against the owned PG.
// No HTTP authorization, coupon lifecycle, provider or payment proof is claimed.
export async function runStorefrontLegacyPriceNativeCases({ prisma, runId, merchantId, check }) {
  assert.match(runId, /^[a-f0-9-]{36}$/);
  assert.equal(merchantId, "synthetic-merchant");
  const [marker] = await prisma.$queryRaw`SELECT current_database() AS database,run_id FROM synthetic_native_marker`;
  assert.deepEqual(marker, { database: "storefront_synthetic", run_id: runId });
  const { PrismaStorefrontCartRepository } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts");
  const { readStorefrontCartCommercial } = await import("../src/modules/storefront/infrastructure/repositories/prisma-storefront-local-cart-effect.dependencies.ts");
  const { storefrontLocalCartCommercialOutcomeV1Schema } = await import("../src/modules/storefront/domain/contracts/storefront-claimed-cart-effect.schemas.ts");
  const repository = new PrismaStorefrontCartRepository(prisma);
  await prisma.$executeRaw`INSERT INTO merchants(id) VALUES (${merchantId}) ON CONFLICT DO NOTHING`;
  const large = { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 1000 };
  const extra = { ...large, itemId: "extra", itemName: "Extra", priceModifierInCents: 2000 };
  const options = { optionGroups: [{ id: "size", name: "Tamanho", required: false, selectionType: "single",
    items: [large, extra].map(option => ({ id: option.itemId, name: option.itemName, priceModifierInCents: option.priceModifierInCents })) }] };
  const line = (overrides = {}) => ({ variantId: "synthetic-variant", productId: "synthetic-product",
    name: "Historically saved synthetic product", sku: "synthetic-sku", quantity: 2, unitPriceCents: 9000, ...overrides });
  const financial = value => ({ items: value.items, total: value.total, discount: value.discount,
    couponCode: value.couponCode, freeShipping: value.freeShipping });
  const raw = async sessionId => {
    const rows = await prisma.$queryRaw`SELECT id,merchant_id AS "merchantId",session_id AS "sessionId",items,total,discount,
      coupon_code AS "couponCode",free_shipping AS "freeShipping",created_at AS "createdAt",updated_at AS "updatedAt",expires_at AS "expiresAt"
      FROM storefront_carts WHERE merchant_id=${merchantId} AND session_id=${sessionId}`;
    assert.equal(rows.length, 1); return rows[0];
  };
  const seed = async (name, { items = [line()], discount = 0, max = 20, paidOptions = false } = {}) => {
    const sessionId = `legacy-${runId}-${name}`;
    await prisma.$executeRaw`DELETE FROM product_promotions`;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=${paidOptions ? 9000 : 10000},cost_in_cents=NULL,currency='BRL' WHERE variant_id='synthetic-variant'`;
    await prisma.$executeRaw`UPDATE product_prices SET base_price_in_cents=5000,cost_in_cents=NULL,currency='BRL' WHERE variant_id='other-variant'`;
    await prisma.$executeRaw`UPDATE products SET metadata=${JSON.stringify(paidOptions ? options : {})}::jsonb WHERE id='synthetic-product'`;
    await prisma.$executeRaw`UPDATE merchant_rules SET max_discount_percent=${max},minimum_margin_percent=100,autonomous_engine_enabled=TRUE WHERE merchant_id=${merchantId}`;
    await prisma.$executeRaw`UPDATE checkout_settings SET advanced_rules='[]'::jsonb WHERE merchant_id=${merchantId}`;
    const [{ now }] = await prisma.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
    await prisma.storefrontCart.create({ data: { id: `${sessionId}-row`, merchantId, sessionId, items,
      total: items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0), discount,
      couponCode: null, freeShipping: false, expiresAt: new Date(now.getTime() + 72 * 3600_000) } });
    const source = await raw(sessionId);
    assert.ok(source.items.every(item => !Object.hasOwn(item, "crossSellIntent") && !Object.hasOwn(item, "pricingOriginalUnitPriceCents")));
    return sessionId;
  };
  const commercial = (sessionId, includeCostAnalytics = false) => prisma.$transaction(async tx => {
    const source = await tx.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId } } });
    const [{ now }] = await tx.$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
    return storefrontLocalCartCommercialOutcomeV1Schema.parse((await readStorefrontCartCommercial(tx,
      { merchantId, cartId: sessionId }, source, now, includeCostAnalytics)).outcome);
  }, { maxWait: 10_000, timeout: 15_000 });
  const money = (outcome, { original, promotion, subtotal, discount = 0, due = subtotal - discount }) => {
    assert.equal(outcome.discountCents, discount); assert.equal(outcome.freeShipping, false);
    assert.equal(outcome.quote.currency, "BRL"); assert.equal(outcome.quote.originalSubtotalCents, original);
    assert.equal(outcome.quote.promotionDiscountCents, promotion); assert.equal(outcome.quote.subtotalCents, subtotal);
    assert.equal(outcome.quote.merchandiseTotalCents, due);
  };
  const review = reason => error => {
    assert.equal(error.name, "LegacySavedPriceReviewRequired"); assert.equal(error.reason, reason);
    const response = error.getResponse(); assert.equal(response.code, "checkout_review_required");
    assert.equal(response.reason, "legacy_saved_price_review_required"); assert.equal(response.requires_confirmation, true);
    assert.ok(typeof response.message === "string" && response.message.length > 30); return true;
  };
  const rejectUnchanged = async (sessionId, operation, reason) => {
    const before = await raw(sessionId); await assert.rejects(operation(), review(reason));
    // Includes timestamps and TTL: refusal must roll back even the preliminary upsert.
    assert.deepEqual(await raw(sessionId), before);
  };
  await check("legacy SQL S9000 B10000 quantity2 GET preserves saved source and commercial read projects P2000", async () => {
    const id = await seed("read"), before = await raw(id);
    assert.deepEqual(financial(await repository.getOrCreate(merchantId, id)), financial(before));
    assert.deepEqual(financial(await raw(id)), financial(before));
    const afterGet = await raw(id);
    const outcome = await commercial(id); money(outcome, { original: 20000, promotion: 2000, subtotal: 18000 });
    assert.equal(outcome.quote.items[0].baseUnitPriceCents, 10000); assert.equal(outcome.quote.items[0].unitPriceCents, 9000);
    assert.deepEqual(await raw(id), afterGet);
  });
  await check("legacy SQL paid option belongs to canonical base per unit and quantity without persisted fake intent", async () => {
    const id = await seed("paid-options", { paidOptions: true, items: [line({ selectedOptions: [large] })] });
    const before = await raw(id), outcome = await commercial(id);
    money(outcome, { original: 20000, promotion: 2000, subtotal: 18000 });
    assert.deepEqual(outcome.quote.items[0].selectedOptionItemIds, ["large"]);
    assert.equal(outcome.quote.items[0].baseUnitPriceCents, 10000); assert.deepEqual(await raw(id), before);
  });
  await check("legacy SQL ordinary add cannot extend existing concession even with canonical incoming price", async () => {
    const id = await seed("add");
    await rejectUnchanged(id, () => repository.addItem(merchantId, id, line({ unitPriceCents: 10000, quantity: 1 })), "quantity_extension");
  });
  await check("legacy SQL quantity increase refuses before commit and retains original source and TTL", async () => {
    const id = await seed("increase");
    await rejectUnchanged(id, () => repository.updateItemQuantity(merchantId, id, "synthetic-variant", 3), "quantity_extension");
  });
  await check("legacy SQL quantity decrease preserves saved unit price and reduced historical benefit", async () => {
    const id = await seed("decrease"), result = await repository.updateItemQuantity(merchantId, id, "synthetic-variant", 1);
    assert.equal(result.items[0].quantity, 1); assert.equal(result.items[0].unitPriceCents, 9000); assert.equal(result.total, 9000);
    assert.deepEqual(financial(await raw(id)), financial(result));
    money(await commercial(id), { original: 10000, promotion: 1000, subtotal: 9000 });
    await rejectUnchanged(id, () => repository.updateItemQuantity(merchantId, id, "synthetic-variant", 2), "quantity_extension");
  });
  await check("legacy SQL removing last line without coupon commits empty cart and clears cart D", async () => {
    const id = await seed("remove-last", { discount: 500 });
    const result = await repository.removeItem(merchantId, id, "synthetic-variant");
    assert.deepEqual(result.items, []); assert.equal(result.total, 0); assert.equal(result.discount, 0); assert.equal(result.couponCode, null);
    assert.deepEqual(financial(await raw(id)), financial(result));
  });
  await check("legacy SQL clear without coupon commits empty cart without a claimed protocol", async () => {
    const id = await seed("clear", { discount: 500 }), result = await repository.clear(merchantId, id);
    assert.deepEqual(result.items, []); assert.equal(result.total, 0); assert.equal(result.discount, 0); assert.equal(result.couponCode, null);
    assert.deepEqual(financial(await raw(id)), financial(result));
  });
  await check("legacy SQL different options cannot inherit saved concession but canonical new option is permitted", async () => {
    const id = await seed("different-options", { paidOptions: true, items: [line({ selectedOptions: [large] })] });
    await rejectUnchanged(id, () => repository.addItem(merchantId, id, line({ selectedOptions: [extra], quantity: 1 })), "source_changed");
    const result = await repository.addItem(merchantId, id, line({ selectedOptions: [extra], unitPriceCents: 11000, quantity: 1 }));
    assert.equal(result.items.length, 2); assert.equal(result.total, 29000);
    assert.equal(result.items.find(item => item.selectedOptions?.[0].itemId === "large").unitPriceCents, 9000);
    assert.equal(result.items.find(item => item.selectedOptions?.[0].itemId === "extra").unitPriceCents, 11000);
    assert.deepEqual(financial(await raw(id)), financial(result));
    money(await commercial(id), { original: 31000, promotion: 2000, subtotal: 29000 });
  });
  await check("legacy SQL mixed projection preserves P0 plus D and adds only current other-line promotion", async () => {
    const id = await seed("mixed", { discount: 1000, items: [line({ quantity: 1 }), line({ variantId: "other-variant", productId: "other-product",
      sku: "other-current-sku", quantity: 1, unitPriceCents: 5000 })] });
    await prisma.$executeRaw`INSERT INTO product_promotions(id,merchant_id,variant_id,discount_type,discount_value,starts_at,ends_at)
      VALUES (${`legacy-promotion-${runId}`},${merchantId},'other-variant','percent',10,CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day')`;
    const before = await raw(id), first = await commercial(id), second = await commercial(id);
    assert.equal(before.total, 14000); assert.equal(before.discount, 1000);
    money(first, { original: 15000, promotion: 1500, subtotal: 13500, discount: 1000, due: 12500 });
    assert.equal(first.quote.items.find(item => item.variantId === "other-variant").unitPriceCents, 4500);
    assert.deepEqual(second, first); assert.deepEqual(await raw(id), before);
    assert.deepEqual(financial(await repository.getOrCreate(merchantId, id)), financial(before));
  });
  await check("legacy SQL exact combined company cap returns notice without repricing historical source", async () => {
    const id = await seed("exact-cap", { max: 10 }), before = await raw(id), outcome = await commercial(id);
    money(outcome, { original: 20000, promotion: 2000, subtotal: 18000 });
    assert.ok(outcome.quote.commercialNotices.some(notice => notice.code === "discount_limit_reached"));
    assert.deepEqual(await raw(id), before);
  });
  await check("legacy SQL above cap preserves GET and source while reader requires explicit review and confirmation", async () => {
    const id = await seed("above-cap", { max: 5 }), before = await raw(id);
    assert.deepEqual(financial(await repository.getOrCreate(merchantId, id)), financial(before));
    const afterGet = await raw(id); await assert.rejects(commercial(id), review("above_company_limit"));
    assert.deepEqual(await raw(id), afterGet);
  });
  await check("legacy SQL current cost null or high and margin100 do not change eligibility", async () => {
    const id = await seed("analytics"), before = await raw(id), noCost = await commercial(id, true);
    await prisma.$executeRaw`UPDATE product_prices SET cost_in_cents=999999 WHERE variant_id='synthetic-variant'`;
    const highCost = await commercial(id, true); assert.deepEqual(highCost, noCost);
    money(highCost, { original: 20000, promotion: 2000, subtotal: 18000 }); assert.deepEqual(await raw(id), before);
  });
  await check("legacy SQL scoped reader rejects foreign merchant without mutating saved cart", async () => {
    const id = await seed("scope"), before = await raw(id);
    await assert.rejects(prisma.$transaction(async tx => {
      const source = await tx.storefrontCart.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: id } } });
      await readStorefrontCartCommercial(tx, { merchantId: "foreign-merchant", cartId: id }, source);
    }), { message: "storefront_effect_cart_scope_invalid" });
    assert.deepEqual(await raw(id), before);
  });
  await check("legacy SQL focal suite creates no execution scopes requests or claimed cart effects", async () => {
    const [counts] = await prisma.$queryRaw`SELECT (SELECT count(*)::int FROM storefront_execution_scopes) AS scopes,
      (SELECT count(*)::int FROM storefront_write_requests) AS requests,(SELECT count(*)::int FROM storefront_local_cart_effects) AS effects`;
    assert.deepEqual(counts, { scopes: 0, requests: 0, effects: 0 });
  });
}
