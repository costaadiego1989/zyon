import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Only caller's independently marker-verified native client on a fresh owned
 * complete schema. Real canonical Prisma writes, no approval/journal fabrication,
 * payment connection, dev bypass, E2E provider or real contact data. */
export async function seedOwnedStorefrontJourney(prisma, { runId, merchantId, buyerId }) {
  for (const id of [runId, merchantId, buyerId]) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(await prisma.merchant.count(), 0, "journey_fresh_canonical_schema_required");
  const products = [{ id: randomUUID(), variantId: randomUUID(), option: false }, { id: randomUUID(), variantId: randomUUID(), option: true }];
  await prisma.$transaction(async tx => {
    await tx.merchant.create({ data: { id: merchantId, name: "Loja sintética da jornada", plan: "BOTH", storeSlug: `journey-${runId}`, storeCategory: "others", melhorEnvioEnabled: false } });
    await tx.buyerAccount.create({ data: { globalUserId: buyerId, email: `journey.${runId}@example.invalid`, displayName: "Comprador sintético" } });
    await tx.merchantRule.create({ data: { merchantId, maxDiscountPercent: 20, minimumMarginPercent: 0,
      allowFreeShipping: false, allowShippingDiscount: false, allowBonusItem: false, allowStackDiscountAndFreeShipping: false,
      couponBoxEnabled: true, autonomousEngineEnabled: false, freeShippingMinCartValue: 0, maxShippingSubsidy: 0,
      maxPartialShippingDiscount: 0, offerExpirationMinutes: 10, blockedRegions: [], brandVoice: "Cordial", originZip: "01310000" } });
    await tx.ownDeliveryConfig.create({ data: { merchantId, enabled: true, mode: "flat", flatPriceCents: 700,
      freeAboveCents: null, estimatedValue: 2, estimatedUnit: "days" } });
    for (const product of products) {
      await tx.product.create({ data: { id: product.id, merchantId, name: product.option ? "Hidratante sintético com tamanho" : "Hidratante sintético sem perfume",
        description: "Catálogo fictício de teste, não comercializável.", type: "physical", isActive: true,
        ...(product.option ? { metadata: { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single",
          items: [{ id: "large", name: "Grande", priceModifierInCents: 500 }] }] } } : {}),
        variants: { create: { id: product.variantId, sku: `JOURNEY-${product.id}`, isActive: true,
          weightGrams: 500, heightCm: 10, widthCm: 15, lengthCm: 20,
          price: { create: { basePriceInCents: 5000, costInCents: null, currency: "BRL" } },
          stock: { create: { quantity: 100, reserved: 0 } } } } } });
    }
  });
  return Object.freeze({ productIds: products.map(row => row.id), variantIds: products.map(row => row.variantId) });
}
