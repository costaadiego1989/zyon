import { z } from "zod";
import { moneyCents } from "@zyon/rules-engine";
import { widgetCrossSellCheckoutScopeSchema } from "./widget-cross-sell-checkout-command.schemas.js";
import { commercialNoticesSchema } from "../../../storefront/domain/contracts/commercial-notice.schemas.js";

const id = widgetCrossSellCheckoutScopeSchema.shape.merchantId;
const cents = z.number().int().min(0).max(2_147_483_647);
const brl = z.number().finite().nonnegative().refine(value => moneyCents(value) !== null);
/** Internal reader OUTPUT only. This validates shape/math, not issuance or
 * provenance. The transaction must establish those before producing a cart. */
export const widgetCrossSellCheckoutProjectedCartSchema = z.object({ currency: z.literal("BRL"), total: brl,
  source: z.literal("checkout").optional(), currentDiscount: z.literal(0),
  items: z.array(z.object({ sku: id, variantId: id, product_id: id, name: z.string().min(1).max(1000),
    quantity: z.number().int().min(1).max(99), price: brl, originalPrice: brl.optional(), variant: z.string(),
    selected_options: z.array(z.strictObject({ group_name: z.string(), item_name: z.string(), price_modifier: brl })).max(250).optional(),
  }).passthrough()).min(1).max(200),
  discountBudget: z.strictObject({ version: z.literal(1), originalSubtotalCents: cents, promotionDiscountCents: cents }),
  commercialNotices: commercialNoticesSchema.optional(),
}).passthrough().superRefine((cart, ctx) => {
  const total = moneyCents(cart.total), lines = cart.items.map(line => ({
    price: moneyCents(line.price), original: moneyCents(line.originalPrice ?? line.price), quantity: line.quantity,
  }));
  if (total === null || lines.some(line => line.price === null || line.original === null || !Number.isSafeInteger(line.quantity))) {
    ctx.addIssue({ code: "custom", message: "widget_cross_sell_projection_inconsistent" }); return;
  }
  const effective = lines.reduce((sum, line) => sum + BigInt(line.price!) * BigInt(line.quantity), 0n);
  const original = lines.reduce((sum, line) => sum + BigInt(line.original!) * BigInt(line.quantity), 0n);
  if (Object.keys(cart).some(key => key.startsWith("_")) || cart.items.some(line => Object.keys(line).some(key => key.startsWith("_"))
      || line.originalPrice !== undefined && line.originalPrice < line.price)
    || effective !== BigInt(total) || original !== BigInt(cart.discountBudget.originalSubtotalCents)
    || original - effective !== BigInt(cart.discountBudget.promotionDiscountCents)) {
    ctx.addIssue({ code: "custom", message: "widget_cross_sell_projection_inconsistent" });
  }
});
