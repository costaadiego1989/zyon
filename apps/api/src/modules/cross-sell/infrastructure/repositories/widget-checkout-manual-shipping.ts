import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { authorizeConfiguredManualDelivery, DEFAULT_QUOTE_TTL_SECONDS } from "@zyon/shipping-engine";
import { checkoutExplicitAddressSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";
import { manualDeliveryConfigSchema, quoteManualDelivery } from "../../../shipping/domain/services/manual-delivery-quote.js";
import { widgetCheckoutManualShippingSnapshotSchema } from "../../domain/contracts/widget-cross-sell-checkout-shipping.schemas.js";
import type { WidgetCrossSellCheckoutScope } from "../../domain/contracts/widget-cross-sell-checkout-command.schemas.js";
import type { ShippingQuoteResult } from "../../../shipping/domain/entities/shipping-quote.entity.js";
import type { prepareAcceptedWidgetCheckout } from "./widget-checkout-accepted-reader.js";
import { readWidgetRadiusShippingSelectionSource } from "./widget-checkout-provider-shipping-source.js";
import { widgetCheckoutShippingHash } from "./widget-cross-sell-checkout-revision.js";
export { widgetCheckoutShippingHash } from "./widget-cross-sell-checkout-revision.js";
import { requireWidgetCrossSellReview } from "./prisma-widget-cross-sell-checkout.authority.js";
import { readNeighborhoodDeliveryOrigin } from "../../../shipping/infrastructure/repositories/neighborhood-delivery-origin.reader.js";
import type { NeighborhoodDeliveryOrigin } from "../../../shipping/domain/services/neighborhood-delivery-origin.js";

const decimal = z.custom<Prisma.Decimal>(value => Prisma.Decimal.isDecimal(value));
const ref = z.string().min(1).max(191);
const selectionSourceSchema = z.strictObject({ quoteId: z.uuidv4(), carrierKey: z.string().min(1).max(300) });
const shippingSchema = z.strictObject({ customerPrice: z.number().finite().nonnegative(), carrier: z.string().min(1),
  method: z.string().min(1), deliveryDays: z.number().int().positive(), destinationZip: z.string().regex(/^\d{8}$/), region: z.string().length(2),
});
type Context = Awaited<ReturnType<typeof prepareAcceptedWidgetCheckout>>;
export const widgetManualShippingConfigurationHash = (config: z.output<typeof manualDeliveryConfigSchema>, origin?: NeighborhoodDeliveryOrigin) =>
  widgetCheckoutShippingHash(config.mode === "neighborhood" ? { config, origin: origin ?? null } : config);

/** SAME transaction after merchant/rules/manual config/session/catalog fences.
 * Stored JSON is only a reference: recompute against current canonical sources.
 * Do not call this from a detached read to authorize a later payment write. */
export async function prepareWidgetManualShippingSelection(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope,
  context: Context, quoteId: string, carrierKey: string) {
  const { stored, receipt, quote, projectedCart } = context;
  let selected: ShippingQuoteResult, quoteIdentity: string;
  let addressData: z.infer<typeof checkoutExplicitAddressSchema>, configData: z.infer<typeof manualDeliveryConfigSchema>;
  if (stored.shippingOptions && typeof stored.shippingOptions === "object"
    && Reflect.get(stored.shippingOptions, "origin") === "widget_checkout_provider") {
    const radius = await readWidgetRadiusShippingSelectionSource(tx, scope, context, quoteId);
    const option = radius.options.find(candidate => candidate.carrier_key === carrierKey);
    if (!option) return requireWidgetCrossSellReview();
    selected = option; quoteIdentity = radius.id; addressData = radius.address; configData = radius.config;
  } else {
    // Preserve flat/neighborhood provenance, rounding, expiry and tariff rules.
    const snapshot = widgetCheckoutManualShippingSnapshotSchema.safeParse(stored.shippingOptions);
    const address = checkoutExplicitAddressSchema.safeParse(stored.customer?.address);
    const config = manualDeliveryConfigSchema.safeParse(await tx.ownDeliveryConfig.findUnique({ where: { merchantId: scope.merchantId } }));
    if (!snapshot.success || !address.success || stored.customer?.address_verified !== true || !config.success
      || config.data.merchantId !== scope.merchantId || !config.data.enabled || config.data.mode === "radius") return requireWidgetCrossSellReview();
    const originResult = config.data.mode === "neighborhood" ? await readNeighborhoodDeliveryOrigin(tx, scope.merchantId) : undefined;
    if (config.data.mode === "neighborhood" && originResult?.kind !== "ready") return requireWidgetCrossSellReview();
    const origin = originResult?.kind === "ready" ? originResult.origin : undefined;
    const saved = snapshot.data, now = Date.parse(quote.quotedAt);
    if (saved.id !== quoteId || saved.merchantId !== scope.merchantId || saved.sessionId !== scope.sessionId
      || saved.buyerId !== stored.globalUserId || saved.acceptanceEventId !== receipt.eventId
      || Date.parse(saved.issuedAt) > now || Date.parse(saved.issuedAt) < Date.parse(receipt.acceptedAt)
      || Date.parse(saved.expiresAt) <= now || Date.parse(saved.expiresAt) - Date.parse(saved.issuedAt) !== DEFAULT_QUOTE_TTL_SECONDS * 1000
      || saved.basisHash !== widgetCheckoutShippingHash({ acceptanceEventId: receipt.eventId, quote: receipt.quote })
      || saved.destinationHash !== widgetCheckoutShippingHash({ ...scope, buyerId: stored.globalUserId, address: address.data })
      || saved.configHash !== widgetManualShippingConfigurationHash(config.data, origin)
      || !isDeepStrictEqual(saved.options, quoteManualDelivery(config.data, { cartTotalCents: quote.totalCents, neighborhood: address.data.neighborhood,
        origin, destinationCity: address.data.city, destinationState: address.data.state })))
      return requireWidgetCrossSellReview();
    const option = saved.options.find(candidate => candidate.carrier_key === carrierKey);
    if (!option) return requireWidgetCrossSellReview();
    selected = option; quoteIdentity = saved.id; addressData = address.data; configData = config.data;
  }
  const raw = z.object({ merchantId: ref, maxDiscountPercent: decimal, allowFreeShipping: z.boolean(), allowStackDiscountAndFreeShipping: z.boolean(),
    freeShippingMinCartValue: decimal, maxShippingSubsidy: decimal, blockedRegions: z.array(z.string()) }).safeParse(
    await tx.merchantRule.findUnique({ where: { merchantId: scope.merchantId }, select: { merchantId: true, maxDiscountPercent: true,
      allowFreeShipping: true, allowStackDiscountAndFreeShipping: true, freeShippingMinCartValue: true, maxShippingSubsidy: true, blockedRegions: true } }));
  if (!raw.success || raw.data.merchantId !== scope.merchantId) return requireWidgetCrossSellReview();
  const rules = { ...raw.data, maxDiscountPercent: raw.data.maxDiscountPercent.toNumber(),
    freeShippingMinCartValue: raw.data.freeShippingMinCartValue.toNumber(), maxShippingSubsidy: raw.data.maxShippingSubsidy.toNumber() };
  if (!authorizeConfiguredManualDelivery({ cart: projectedCart, rules, priceCents: selected.price,
    originalPriceCents: selected.original_price ?? selected.price, configuredFreeAboveCents: configData.freeAboveCents, region: addressData.state }).approved)
    return requireWidgetCrossSellReview();
  const shipping = shippingSchema.parse({ customerPrice: selected.price / 100, carrier: selected.carrier_key, method: selected.label,
    deliveryDays: selected.eta_days, destinationZip: addressData.zip, region: addressData.state });
  return { shipping, storedShipping: { ...shipping, _widgetManualSelection: selectionSourceSchema.parse({ quoteId: quoteIdentity, carrierKey: selected.carrier_key }) } };
}

export async function readWidgetSelectedManualShipping(tx: Prisma.TransactionClient, scope: WidgetCrossSellCheckoutScope, context: Context) {
  if (context.stored.shipping == null) return null;
  const source = z.object({ _widgetManualSelection: selectionSourceSchema }).safeParse(context.stored.shipping);
  if (!source.success) return requireWidgetCrossSellReview();
  const projected = await prepareWidgetManualShippingSelection(tx, scope, context, source.data._widgetManualSelection.quoteId, source.data._widgetManualSelection.carrierKey);
  if (!isDeepStrictEqual(context.stored.shipping, projected.storedShipping)) return requireWidgetCrossSellReview();
  return projected.shipping;
}
