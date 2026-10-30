import test from "node:test";
import assert from "node:assert/strict";
import { createProductHandlers } from "./product.handlers.js";
import { validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";

const ctx = { merchantId: "merchant", sessionId: "session" };
const promotion = (id: string, discountValue: number, patch: Record<string, unknown> = {}) => ({
  id, merchantId: ctx.merchantId, productId: "product", isActive: true, discountType: "percent", discountValue,
  startsAt: new Date(0), endsAt: new Date("2099-01-01T00:00:00Z"), ...patch,
});

function fixture(promotions: ReturnType<typeof promotion>[], beforePricing?: () => void) {
  const variant = { id: "variant", sku: "QA", basePriceInCents: 10000, attributes: {}, media: [] };
  const product = { id: "product", name: "QA", isActive: true, hasStock: true,
    defaultVariant: variant, variants: [variant] };
  const handlers = createProductHandlers({
    productRepo: { search: async () => ({ products: [product] }) },
    stockRepo: {},
    merchantRepo: { getRules: async () => ({ maxDiscountPercent: 20, minimumMarginPercent: 0, allowFreeShipping: false }) },
    prisma: {
      productPromotion: { findMany: async (args: any) => {
        assert.equal(args.where.merchantId, ctx.merchantId);
        assert.equal(args.where.isActive, true);
        return promotions;
      } },
      productPrice: { findMany: async () => {
        beforePricing?.();
        return [{ variantId: "variant", basePriceInCents: 10000, costInCents: 1000,
          variant: { productId: "product", product: { categoryId: null } } }];
      } },
    },
  } as any, ctx);
  return { handlers, product };
}

test("daily deal exposes the selected promotion's expiry without changing catalog price", async () => {
  const { handlers, product } = fixture([
    promotion("smaller", 5, { endsAt: new Date("2098-01-01T00:00:00Z") }),
    promotion("winner", 10),
    promotion("foreign", 90, { merchantId: "another-merchant" }),
    promotion("expired", 90, { endsAt: new Date(1) }),
    promotion("inactive", 90, { isActive: false }),
  ]);
  const result = await handlers.getDailyDeals({});
  assert.equal(result.deals.length, 1);
  assert.equal(result.deals[0]?.price, 9000);
  assert.equal(result.deals[0]?.expiresAt, "2099-01-01T00:00:00.000Z");
  assert.equal(result.deals[0]?.variantId, "variant");
  assert.equal(result.deals[0]?.expiresAtFormatted, "31/12/2098, 21:00 (horário de Brasília)");
  const validated = validateStorefrontToolOutput("get_daily_deals", result);
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal((validated.data as any).deals[0].expiresAt, result.deals[0]?.expiresAt);
  assert.equal(product.defaultVariant.basePriceInCents, 10000);
});

test("daily deal with no eligible promotion does not advertise an expiry or price reduction", async () => {
  const { handlers } = fixture([promotion("expired", 90, { endsAt: new Date(1) }), promotion("inactive", 90, { isActive: false })]);
  assert.deepEqual(await handlers.getDailyDeals({}), { deals: [] });
});

test("expiry follows the promotion actually priced when the original winner expires during a read", async t => {
  const start = Date.parse("2026-10-29T18:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const { handlers } = fixture([
    promotion("expires-during-read", 10, { endsAt: new Date(start + 1000) }),
    promotion("still-valid", 5),
  ], () => t.mock.timers.tick(2000));
  const result = await handlers.getDailyDeals({});
  assert.equal(result.deals[0]?.price, 9500);
  assert.equal(result.deals[0]?.expiresAt, "2099-01-01T00:00:00.000Z");
});
