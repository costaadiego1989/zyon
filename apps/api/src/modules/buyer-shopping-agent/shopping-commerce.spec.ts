import { test } from "node:test";
import assert from "node:assert/strict";
import { ShoppingCommerceService } from "./application/shopping-commerce.service.js";
import { validateConfig, ShoppingError } from "./domain/shopping-agent.js";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../embed/domain/embed-checkout-session.js";
import { CartPromoResolutionService } from "../checkout/application/services/cart-promo-resolution.service.js";

function fixture() {
  const product = { id: "product", merchantId: "merchant", name: "Café", type: "physical", isActive: true, hasStock: true, categoryId: "coffee",
    variants: [{ id: "variant", sku: "CAFE", isActive: true, attributes: {}, currency: "BRL", basePriceInCents: 2500, costInCents: 1000, stockQuantity: 5, stockReserved: 1, weightGrams: 500, heightCm: 10, widthCm: 10, lengthCm: 10 }] };
  const lookup: any[] = []; const added: any[] = []; const starts: any[] = []; const accepted: any[] = []; const saved: any[] = []; const previews: any[] = [];
  const cart = { id: "cart", sessionId: "", merchantId: "merchant", total: 0, items: [] as any[], discount: 0, freeShipping: false, couponCode: null, createdAt: new Date(), updatedAt: new Date() };
  const policy = { enabled: false, global: { minOfferDiscountPercent: 0, maxDiscountPercent: 10 }, maxRounds: 3, estimatedCostPerAiCallCents: 0 };
  const rules = { maxDiscountPercent: 10, minimumMarginPercent: 10 };
  const promotions: any[] = [];
  const tokens = new EmbedTokenService({ value: Buffer.from("shopping-agent-test-secret-32-bytes") });
  let checkout: any;
  const service = new ShoppingCommerceService(
    { async findById(merchantId: string, productId: string) { lookup.push({ merchantId, productId }); return merchantId === product.merchantId && productId === product.id ? product : null; } } as any,
    Reflect.construct(CartPromoResolutionService, [{ async findActiveBySku() { return promotions; } }, { async getRules() { return rules; }, async getExistingRules() { return rules; } }]) as CartPromoResolutionService,
    { async preview(input: unknown) { previews.push(input); return { results: [{ carrier_key: "fast", price: 2000, eta_days: 1, label: "Entrega rápida" }, { carrier_key: "cheap", price: 800, eta_days: 3, label: "Entrega econômica" }] }; } } as any,
    { async getRules() { return rules; } } as any,
    { async getProfile() { return { id: "merchant", name: "Loja", slug: "loja" }; } } as any,
    { async getMerchantPolicy() { return policy; }, async createNegotiationSessionWithLedger() { return { id: "negotiation" }; } } as any,
    { async getOrCreate(_merchantId: string, ref: string) { cart.sessionId = ref; return structuredClone(cart); },
      async addItem(_merchantId: string, _ref: string, item: any) { added.push(item); cart.items.push(item); cart.total += item.unitPriceCents * item.quantity; return structuredClone(cart); },
      async updateItemQuantity(_merchantId: string, _ref: string, id: string, quantity: number) { cart.items.find(i => i.variantId === id).quantity = quantity; return structuredClone(cart); } } as any,
    { platformFeeBrl: 0.99 }, tokens,
    { async execute(input: any, context: any) { starts.push({ input, context }); checkout ??= { merchantId: "merchant", sessionId: input.session_id, globalUserId: "buyer", cart: { currency: "BRL", total: 50, items: [{ sku: "CAFE", quantity: 2, price: 25 }] } }; return { session_id: input.session_id }; } } as any,
    { async execute() { return { offer: { id: "offer" } }; } } as any,
    { async execute(input: unknown) { accepted.push(input); } } as any,
    { async getSession() { return checkout; }, async saveSession(input: unknown) { checkout = input; saved.push(input); } } as any,
    { async findByGlobalUserId() { return { email: "buyer@example.test", displayName: "Compradora" }; } } as any,
  );
  const config = (extra: Record<string, unknown> = {}) => validateConfig({ kind: "price_watch", title: "Café", items: [{ productId: "product", variantId: "variant", quantity: 2 }], targetCents: 10000, includeShipping: false, targetDiscountPercent: 0, ...extra });
  return { service, product, promotions, policy, rules, tokens, lookup, added, starts, accepted, saved, previews, config };
}
test("quotes use the exact merchant and variant and include the configured service fee", async () => {
  const f = fixture(); const quote = await f.service.quote("merchant", f.config(), new Date());
  assert.deepEqual(f.lookup, [{ merchantId: "merchant", productId: "product" }]); assert.equal(quote.subtotalCents, 5000); assert.equal(quote.serviceFeeCents, 99); assert.equal(quote.totalCents, 5099);
  await assert.rejects(() => f.service.quote("other", f.config(), new Date()), (error: unknown) => error instanceof ShoppingError && error.code === "agent_product_unavailable");
});
test("reserved units are excluded from the quantity available to a task", async () => {
  const f = fixture(); f.product.variants[0]!.stockReserved = 4;
  assert.equal((await f.service.quote("merchant", f.config(), new Date())).available, false);
});

test("uncategorized catalog products omit a null category from the native pricing input", async () => {
  const f = fixture(); f.product.categoryId = null as any;
  const quote = await f.service.quote("merchant", f.config(), new Date());
  assert.equal(quote.totalCents, 5099); assert.equal(quote.available, true);
  assert.equal(quote.items[0]?.categoryId, undefined);
});
test("an active product promotion changes the real unit price before the budget comparison", async () => {
  const f = fixture(); f.promotions.push({ id: "promotion", merchantId: "merchant", productId: "product", variantId: "variant", isActive: true,
    startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000), discountType: "percent", discountValue: 5 });
  const quote = await f.service.quote("merchant", f.config(), new Date()); assert.equal(quote.items[0]?.unitPriceCents, 2375); assert.equal(quote.totalCents, 4849);
});
test("a shipping-inclusive quote selects an eligible carrier and includes its price", async () => {
  const f = fixture(); const quote = await f.service.quote("merchant", f.config({ includeShipping: true, destinationZip: "01310100", maxDeliveryDays: 2 }), new Date());
  assert.equal(quote.shippingCents, 2000); assert.equal(quote.totalCents, 7099); assert.equal(quote.deliveryDays, 1); assert.equal(f.previews[0]?.destination_zip, "01310100");
});
test("negotiation obeys the merchant policy and the rules engine cap", async () => {
  const f = fixture(); const config = f.config({ kind: "negotiate", targetDiscountPercent: 10 });
  assert.equal((await f.service.quote("merchant", config, new Date())).discountCents, 0);
  f.policy.enabled = true; assert.equal((await f.service.quote("merchant", config, new Date())).discountCents, 500);
  f.rules.maxDiscountPercent = 2; assert.equal((await f.service.quote("merchant", config, new Date())).discountCents, 0);
});
test("services and food never receive an automatically selected slot or option", async () => {
  for (const type of ["service", "food"]) {
    const f = fixture(); f.product.type = type;
    await assert.rejects(() => f.service.quote("merchant", f.config(), new Date()), (error: unknown) => error instanceof ShoppingError && error.code === "agent_product_requires_options");
  }
});
test("checkout handoff is origin-bound, buyer-bound and uses one deterministic session on retry", async () => {
  const f = fixture(); const config = f.config(); const quote = await f.service.quote("merchant", config, new Date());
  const first = await f.service.prepare("buyer", "merchant", "activity", config, quote, "https://store.example");
  const second = await f.service.prepare("buyer", "merchant", "activity", config, quote, "https://store.example");
  const claims = f.tokens.verify(first.embedToken); const repeated = f.tokens.verify(second.embedToken);
  assert.equal(claims.allowedOrigin, "https://store.example"); assert.equal(claims.aiUserId, "buyer:buyer"); assert.equal(claims.storefrontCartRef, "agent_activity");
  assert.equal(embedCheckoutSessionId(claims), embedCheckoutSessionId(repeated)); assert.equal(f.added.length, 1);
  assert.equal(f.starts[0]?.context.trustedBuyer.globalUserId, "buyer"); assert.equal(f.starts[0]?.context.requireBuyerProof, true);
  assert.equal(claims.scopes?.includes("payment:intents:resume"), false);
});
test("native negotiation accepts one validated offer and never compounds the discount on retry", async () => {
  const f = fixture(); f.policy.enabled = true; const config = f.config({ kind: "negotiate", targetDiscountPercent: 10 }); const quote = await f.service.quote("merchant", config, new Date());
  await f.service.prepare("buyer", "merchant", "activity", config, quote, "https://store.example");
  await f.service.prepare("buyer", "merchant", "activity", config, quote, "https://store.example");
  assert.equal(f.accepted.length, 1); assert.equal(f.saved.length, 1); assert.equal(f.saved[0]?.cart.currentDiscount, 5);
});
