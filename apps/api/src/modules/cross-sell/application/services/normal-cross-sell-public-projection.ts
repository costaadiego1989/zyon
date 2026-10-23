import { z } from "zod";
import type { Cart, CheckoutSession, MerchantTheme } from "@zyon/shared-types";
import type { NormalCheckoutCrossSellQuote } from "@zyon/contracts";

const text = z.string().max(4000), id = z.string().min(1).max(191);
const amount = z.number().finite().min(0).max(21_474_836.47)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < .0000001);
const optionalText = text.optional();
const option = z.object({ group_name: text, item_name: text, price_modifier: amount });
const item = z.object({ sku: id, name: z.string().min(1).max(1000), variantId: id, product_id: id,
  productType:z.enum(["physical","food","digital","service"]).optional(),
  fulfillmentStrategy:z.enum(["carrier","pickup","local_delivery","digital","service"]).optional(),
  quantity: z.number().int().min(1).max(99), price: amount, originalPrice: amount.optional(),
  variant: optionalText, variantLabel: optionalText, imageUrl: optionalText, productUrl: optionalText,
  category: optionalText, description: optionalText, selected_options: z.array(option).max(250).optional() });
const notice = z.object({ version: z.literal(1), code: z.enum(["discount_limit_reached", "discount_limited", "discount_unavailable",
  "benefit_not_combinable", "benefit_conditions_not_met"]), message: z.string().min(1).max(1000) });
// z.object strips unknown keys at EVERY nested level. Never spread repository JSON.
const cartSchema = z.object({ currency: z.literal("BRL"), items: z.array(item).min(1).max(200), total: amount,
  currentDiscount: amount.optional(), commercialNotices: z.array(notice).max(5).optional(),
  couponCode: z.string().max(200).nullable().optional(),
  commercialNudge: z.object({ kind: z.enum(["coupon", "progressive_discount", "advanced_rule"]), title: text, message: text,
    badge: optionalText, couponCode: optionalText, ruleId: optionalText, discountPercent: z.number().finite().min(0).max(100).optional() }).optional(),
  appliedBenefits: z.array(z.object({ kind: z.enum(["discount", "shipping"]), label: text, amount })).max(20).optional() });
const address = z.object({ zip: optionalText, street: optionalText, number: optionalText, complement: optionalText,
  neighborhood: optionalText, city: optionalText, state: optionalText });
const customer = z.object({ fullName: optionalText, cpf: optionalText, email: optionalText, phone: optionalText,
  email_verified: z.boolean().optional(), phone_verified: z.boolean().optional(), address_verified: z.boolean().optional(),
  recognized_buyer: z.boolean().optional(), isReturning: z.boolean().optional(), deliveryAddressLabel: optionalText,
  address: address.optional() });
const shipping = z.object({ customerPrice: amount, carrier: optionalText, method: optionalText,
  deliveryDays: z.number().int().min(0).max(3650).optional(), destinationZip: optionalText, region: optionalText });
const themeSchema = z.object({ accentColor: text, textColor: text, backgroundColor: text, fontFamily: text,
  secondaryColor: optionalText, logoUrl: optionalText, faviconUrl: optionalText, agentAvatarUrl: optionalText,
  surfaceColor: optionalText, surfaceElevatedColor: optionalText, borderColor: optionalText, successColor: optionalText,
  warningColor: optionalText, mutedTextColor: optionalText, fontDisplay: optionalText, backgroundImageUrl: optionalText,
  borderRadius: z.number().finite().optional(), density: z.enum(["compact", "comfortable", "spacious"]).optional(),
  headerTitle: optionalText, headerSubtitle: optionalText, agentName: optionalText, trustBadges: z.array(text).max(30).optional(),
  mode: z.enum(["light", "dark", "grey"]).optional() });
export const normalCrossSellPublicPoliciesSchema = z.object({ privacyUrl: optionalText, termsUrl: optionalText,
  refundUrl: optionalText, shippingUrl: optionalText });

export function normalCrossSellPublicTheme(theme: MerchantTheme | undefined) {
  return theme === undefined ? undefined : themeSchema.parse(theme);
}
export function normalCrossSellPublicSession(session: CheckoutSession, quote: NormalCheckoutCrossSellQuote,
  persistenceVersion: number): CheckoutSession {
  if (session.merchantId !== quote.merchantId || session.sessionId !== quote.sessionId
    || session.persistenceVersion !== persistenceVersion) throw new Error("cross_sell_projection_scope_changed");
  const cart = cartSchema.parse(session.cart);
  const cents = (value: number) => Math.round(value * 100);
  if (cents(cart.total) !== quote.pricing.merchandiseSubtotalCents
    || cents(cart.currentDiscount ?? 0) !== quote.pricing.cartDiscountCents
    || cart.items.length !== quote.pricing.items.length) throw new Error("cross_sell_projection_money_changed");
  const seen = new Set<string>();
  for (const line of cart.items) {
    const projected = quote.pricing.items.find(expected => expected.variantId === line.variantId
      && (line.variant ?? JSON.stringify([line.variantId, []])) === JSON.stringify([expected.variantId,
        (expected.selectedOptions ?? []).map(option => option.itemId).sort()]));
    const identity = JSON.stringify([line.variantId, line.variant ?? JSON.stringify([line.variantId, []])]);
    if (!projected || seen.has(identity) || projected.sku !== line.sku || projected.productId !== line.product_id
      || projected.quantity !== line.quantity || projected.unitPriceCents !== cents(line.price)
      || projected.baseUnitPriceCents !== cents(line.originalPrice ?? line.price)
      || JSON.stringify(line.selected_options ?? []) !== JSON.stringify((projected.selectedOptions ?? []).map(option => ({
        group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100,
      })))) throw new Error("cross_sell_projection_lines_changed");
    seen.add(identity);
  }
  return { ...session, cart: cart satisfies Cart,
    customer: session.customer === undefined ? undefined : customer.parse(session.customer),
    shipping: session.shipping === undefined ? undefined : shipping.parse(session.shipping),
    shippingOptions: session.shippingOptions === undefined ? undefined : z.array(shipping).max(200).parse(session.shippingOptions) };
}
