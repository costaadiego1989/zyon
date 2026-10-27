import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seedOwnedStorefrontJourney } from "./storefront-journey-bootstrap.seed.mjs";

/** Synthetic preconditions only. Accepted intents and checkout/payment/order
 * state MUST be produced by real HTTP commands, never by this seed. */
export async function seedOwnedCommerceJourney(prisma, identity) {
  const catalog = await seedOwnedStorefrontJourney(prisma, identity);
  const { merchantId, buyerId, runId } = identity;
  const address = { zip: "01310000", street: "Rua Sintetica", number: "123", complement: "",
    neighborhood: "Bela Vista", city: "Sao Paulo", state: "SP" };
  // The approved neighborhood coverage is the merchant's origin city only.
  // Seed the actual server-owned company locality with the same configured
  // origin CEP; destination/body text cannot establish merchant coverage.
  await prisma.merchant.update({ where: { id: merchantId }, data: {
    storeSettings: { company: { address: { zip: "01310000", city: "Sao Paulo", state: "SP" } } },
  } });
  const customer = { fullName: "Comprador sintetico", email: `journey.${runId}@example.invalid`,
    cpf: "11144477735", phone: "11900000000" };
  await prisma.buyerAccount.update({ where: { globalUserId: buyerId }, data: {
    displayName: customer.fullName, phone: customer.phone, cpf: customer.cpf, address,
  } });
  const otherBuyerId = randomUUID(), otherBuyerEmail = `journey.other.${runId}@example.invalid`;
  // A valid DIFFERENT account must satisfy BuyerAccount's password-or-phone
  // invariant; otherwise recovery tests login failure, not ownership mismatch.
  await prisma.buyerAccount.create({ data: { globalUserId: otherBuyerId, email: otherBuyerEmail,
    displayName: "Outro comprador sintetico", phone: "11900000001" } });
  // Isolate cross-sell P; no unrelated progressive/coupon D in phase A. The
  // bootstrap seed's display-like "Cordial" is not a canonical BrandVoice.
  const { DEFAULT_RULES } = await import("../dist-test/modules/merchant/domain/merchant-rules.defaults.js");
  assert.equal(DEFAULT_RULES.brandVoice, "consultative");
  await prisma.merchantRule.update({ where: { merchantId }, data: {
    couponBoxEnabled: false, brandVoice: DEFAULT_RULES.brandVoice,
  } });
  const { CheckoutSettingsEntity } = await import("../dist-test/modules/checkout-settings/domain/entities/checkout-settings.entity.js");
  const settings = CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
  assert.equal(settings.interventionPolicy.progressiveDiscount.enabled, false);
  await prisma.checkoutSetting.create({ data: { merchantId, mode: settings.mode,
    widgetBehavior: settings.widgetBehavior, interventionPolicy: settings.interventionPolicy,
    triggerRules: settings.triggerRules, suppressionRules: settings.suppressionRules,
    handoff: settings.handoff, advancedRules: [] } });
  const variants = await prisma.productVariant.findMany({ where: { id: { in: catalog.variantIds }, product: { merchantId } }, include: { product: true, price: true } });
  const trigger = variants.find(row => row.product.id === catalog.productIds[0]);
  const target = variants.find(row => row.product.id === catalog.productIds[1]);
  assert.ok(trigger?.price && target?.price);
  assert.equal(trigger.price.basePriceInCents, 5000); assert.equal(target.price.basePriceInCents, 5000);
  const promotion = await prisma.crossSellPromotion.create({ data: { id: randomUUID(), merchantId,
    name: "Oferta sintetica da jornada", trigger: { sku_in_cart: [trigger.sku] }, recommendedSkus: [target.sku],
    discountPercent: 10, maxDiscountPercent: 10, status: "active", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) } });
  return Object.freeze({ customer, address, trigger: { variantId: trigger.id, productId: trigger.productId,
    sku: trigger.sku, name: trigger.product.name }, target: { variantId: target.id, productId: target.productId,
    sku: target.sku, name: target.product.name }, promotionId: promotion.id, otherBuyerId, otherBuyerEmail });
}

/** Seeds an initial ordinary cart, not a PUBLIC ADD and never an accepted offer.
 * Conversation identity was already issued/verified by the real controller. */
export async function seedInitialCommerceCart(prisma, { merchantId, cartId, trigger }) {
  const existing = await prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: cartId } } });
  assert.equal(existing, null, "commerce_seed_requires_fresh_conversation_cart");
  return prisma.storefrontCart.create({ data: { merchantId, sessionId: cartId,
    items: [{ ...trigger, unitPriceCents: 5000, quantity: 1 }], total: 5000, discount: 0,
    couponCode: null, freeShipping: false, expiresAt: new Date(Date.now() + 3_600_000) } });
}

export async function configureOwnedCommerceDelivery(prisma, merchantId, mode) {
  assert.ok(mode === "flat" || mode === "neighborhood");
  await prisma.ownDeliveryConfig.update({ where: { merchantId }, data: {
    enabled: true, mode, flatPriceCents: mode === "flat" ? 700 : null, freeAboveCents: null,
    neighborhoods: mode === "neighborhood" ? [{ name: "Bela Vista", priceCents: 900 }] : [],
    radiusZones: [], estimatedValue: 2, estimatedUnit: "days",
  } });
  return mode === "flat" ? { carrierKey: "own_delivery_flat", priceCents: 700 }
    : { carrierKey: "own_delivery_neighborhood_bela_vista", priceCents: 900 };
}
