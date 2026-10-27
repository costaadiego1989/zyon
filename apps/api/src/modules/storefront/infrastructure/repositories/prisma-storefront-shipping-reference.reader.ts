import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";
import { readCombinedStorefrontCouponCommercial } from "../../../../shared/persistence/storefront-coupon/combined-merchandise.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { storefrontCartHasCheckoutBinding } from "./storefront-checkout-binding-fence.js";
import { lockCrossSellMerchantAuthority } from "./storefront-cross-sell-authority-fence.js";
import { readStorefrontCartCommercial } from "./prisma-storefront-local-cart-effect.dependencies.js";
import { crossSellStorefrontBasisItemSchema } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { checkoutExplicitAddressSchema } from "../../../checkout/domain/services/checkout-explicit-address.schema.js";
import { manualDeliveryConfigSchema } from "../../../shipping/domain/services/manual-delivery-quote.js";
import { shippingReferenceConfigurationHash } from "../../../shipping/application/use-cases/quote-shipping.use-case.js";
import { readNeighborhoodDeliveryOrigin } from "../../../shipping/infrastructure/repositories/neighborhood-delivery-origin.reader.js";
import { neighborhoodDeliveryMatchesOrigin } from "../../../shipping/domain/services/neighborhood-delivery-origin.js";
import { storefrontShippingReferenceScopeSchema, storefrontShippingReferenceRequestSchema, storefrontShippingReferenceAuthoritySchema,
  shippingReferenceCepSchema, type ShippingReferenceReason, type StorefrontShippingReferenceScope } from "../../domain/contracts/storefront-shipping-reference.schemas.js";
import type { StorefrontShippingReferenceReader, StorefrontShippingReferenceAuthority } from "../../domain/ports/storefront-shipping-reference.port.js";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { storefrontLocalCartCommercialOutcomeV1Schema, type StorefrontLocalCartCommercialOutcomeV1 } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";

const id = storefrontShippingReferenceScopeSchema.shape.merchantId, cents = z.number().int().min(0).max(2_147_483_647);
const cartSchema = z.object({ id, merchantId: id, sessionId: id, items: z.array(crossSellStorefrontBasisItemSchema).max(200),
  total: cents, discount: cents, couponCode: id.nullable(), freeShipping: z.boolean(), createdAt: z.date(), updatedAt: z.date(), expiresAt: z.date() });
const dimensions = z.number().finite().nonnegative().nullish();
const variantSchema = z.object({ id, sku: id, isActive: z.literal(true), weightGrams: dimensions, heightCm: dimensions, widthCm: dimensions, lengthCm: dimensions,
  product: z.object({ id, merchantId: id, type: z.literal("physical"), isActive: z.literal(true), deletedAt: z.null() }) });
const unavailable = (reason: ShippingReferenceReason): StorefrontShippingReferenceAuthority => ({ kind: "unavailable", reason });
type Dependencies = { commercial(tx: Prisma.TransactionClient, scope: { merchantId: string; cartId: string }, cart: StorefrontCart,
  buyerId?: string): Promise<StorefrontLocalCartCommercialOutcomeV1>;
  bound(tx: Prisma.TransactionClient, merchantId: string, cartId: string): Promise<boolean> };
const dependencies: Dependencies = { bound: storefrontCartHasCheckoutBinding, commercial: async (tx, scope, cart, buyerId) =>
  cart.couponCode !== null ? readCombinedStorefrontCouponCommercial(tx, scope, cart, buyerId)
    : (await readStorefrontCartCommercial(tx, scope, cart, undefined, false)).outcome };

/** Read-only existing source. Never calls getOrCreate/upsert/update, commercial
 * writers, coupon reservation, checkout mapper or an invented checkout lookup. */
export class PrismaStorefrontShippingReferenceReader implements StorefrontShippingReferenceReader {
  constructor(private readonly prisma: PrismaClient, private readonly source: Dependencies = dependencies) {}

  async read(rawScope: StorefrontShippingReferenceScope, rawRequest: Parameters<StorefrontShippingReferenceReader["read"]>[1]): Promise<StorefrontShippingReferenceAuthority> {
    const scope = storefrontShippingReferenceScopeSchema.parse(rawScope), request = storefrontShippingReferenceRequestSchema.parse(rawRequest);
    if (request.productId) return unavailable("product_selection_required");
    try {
      return await this.prisma.$transaction(async tx => {
        await lockCrossSellMerchantAuthority(tx, scope.merchantId);
        await tx.$queryRaw`SELECT id FROM own_delivery_configs WHERE merchant_id=${scope.merchantId} FOR SHARE`;
        await lockStorefrontCart(tx, scope.merchantId, scope.cartId);
        if (await this.source.bound(tx, scope.merchantId, scope.cartId)) return unavailable("cart_checkout_bound");
        const raw = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
        if (!raw) return unavailable("cart_required");
        const cart = cartSchema.parse(raw);
        const clock = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0]!.now;
        if (cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId || cart.expiresAt <= clock || cart.freeShipping) return unavailable("cart_review_required");
        if (!cart.items.length) return unavailable("cart_empty");
        if (cart.couponCode !== null && !cart.items.some(item => item.crossSellIntent !== undefined)) return unavailable("cart_review_required");
        if (cart.couponCode === null && await tx.couponRedemption.findFirst({ where: { merchantId: scope.merchantId, sessionId: scope.cartId,
          status: { not: "cancelled" } }, select: { id: true } })) return unavailable("cart_review_required");
        const commercial = storefrontLocalCartCommercialOutcomeV1Schema.parse(await this.source.commercial(tx,
          { merchantId: scope.merchantId, cartId: scope.cartId }, cart, scope.buyerId));
        if (commercial.discountCents !== cart.discount || commercial.quote.items.length !== cart.items.length
          || commercial.quote.items.some((line, index) => line.variantId !== cart.items[index]!.variantId || line.productId !== cart.items[index]!.productId
            || line.quantity !== cart.items[index]!.quantity)) return unavailable("cart_review_required");
        const ids = [...new Set(cart.items.map(item => item.variantId))];
        const rows = z.array(variantSchema).max(200).parse(await tx.productVariant.findMany({
          where: { id: { in: ids }, isActive: true, product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } }, orderBy: { id: "asc" }, select: {
            id: true, sku: true, isActive: true, weightGrams: true, heightCm: true, widthCm: true, lengthCm: true,
            product: { select: { id: true, merchantId: true, type: true, isActive: true, deletedAt: true } } } }));
        const byId = new Map(rows.map(row => [row.id, row]));
        if (byId.size !== ids.length || rows.length !== ids.length || cart.items.some(line => {
          const variant = byId.get(line.variantId); return !variant || variant.product.merchantId !== scope.merchantId
            || variant.product.id !== line.productId || variant.sku !== line.sku;
        })) return unavailable("cart_review_required");
        const rawManual = await tx.ownDeliveryConfig.findUnique({ where: { merchantId: scope.merchantId } });
        const manual = rawManual === null ? null : manualDeliveryConfigSchema.parse(rawManual);
        if (manual && manual.merchantId !== scope.merchantId) return unavailable("cart_review_required");
        const rules = z.object({ merchantId: id, originZip: z.string().nullable() }).parse(await tx.merchantRule.findUnique({
          where: { merchantId: scope.merchantId }, select: { merchantId: true, originZip: true } }));
        if (rules.merchantId !== scope.merchantId) return unavailable("cart_review_required");
        const origin = shippingReferenceCepSchema.safeParse(rules.originZip), originZip = origin.success ? origin.data : "";
        const carrierEnabled = (await tx.merchant.findUnique({ where: { id: scope.merchantId }, select: { melhorEnvioEnabled: true } }))?.melhorEnvioEnabled ?? false;
        const mode = manual?.enabled ? manual.mode : "carrier";
        const originResult = mode === "neighborhood" ? await readNeighborhoodDeliveryOrigin(tx, scope.merchantId) : undefined;
        if (mode === "neighborhood" && !carrierEnabled && originResult?.kind !== "ready") return unavailable("origin_address_configuration_required");
        const localityOrigin = originResult?.kind === "ready" ? originResult.origin : undefined;
        if ((mode === "radius" || mode === "carrier") && !originZip) return unavailable("origin_required");
        const hasDimensions = rows.every(row => [row.weightGrams, row.heightCm, row.widthCm, row.lengthCm]
          .every(value => typeof value === "number" && Number.isFinite(value) && value > 0));
        if (mode === "carrier" && !hasDimensions) return unavailable("dimensions_required");
        const packages = hasDimensions ? cart.items.map(line => { const row = byId.get(line.variantId)!;
          return { weightKg: row.weightGrams! / 1000, heightCm: row.heightCm!, widthCm: row.widthCm!, lengthCm: row.lengthCm!, quantity: line.quantity }; }) : undefined;
        let address: { id: string; globalUserId: string; value: z.output<typeof checkoutExplicitAddressSchema> } | undefined;
        if (mode === "neighborhood") {
          if (!scope.buyerId && !carrierEnabled) return unavailable("address_required");
          const addresses = scope.buyerId ? await tx.buyerAddress.findMany({ where: { globalUserId: scope.buyerId, zip: request.zipCode }, take: 2,
            select: { id: true, globalUserId: true, zip: true, street: true, number: true, complement: true, neighborhood: true, city: true, state: true } })
          : [];
          if (!addresses.length && !carrierEnabled) return unavailable("address_required");
          if (addresses.length > 1 && !carrierEnabled) return unavailable("address_ambiguous");
          if (addresses.length === 1) {
          const saved = addresses[0]!;
          if (saved.globalUserId !== scope.buyerId || saved.zip !== request.zipCode) return unavailable("address_required");
          const { id: addressId, globalUserId, ...value } = saved;
          address = { id: id.parse(addressId), globalUserId, value: checkoutExplicitAddressSchema.parse(value) };
          if (!neighborhoodDeliveryMatchesOrigin(scope.merchantId, localityOrigin, address.value.city, address.value.state) && !carrierEnabled) return unavailable("coverage_unavailable");
          }
        }
        const basisHash = createHash("sha256").update(canonicalJson({ namespace: "storefront-reference-v1", scope, cart, commercial,
          dimensions: rows, carrierEnabled, address: address ?? null, destinationZip: request.zipCode })).digest("hex");
        return storefrontShippingReferenceAuthoritySchema.parse({ kind: "ready", basisHash,
          configurationHash: shippingReferenceConfigurationHash(manual, originZip, localityOrigin, carrierEnabled), cartTotalCents: commercial.quote.merchandiseTotalCents,
          originZip, destinationZip: request.zipCode, ...(address ? { destinationNeighborhood: address.value.neighborhood,
            destinationCity: address.value.city, destinationState: address.value.state } : {}),
          addressSource: address ? "saved_buyer_address" : "requested_cep", mode, carrierEnabled,
          ...(packages ? { packages } : {}), items: cart.items.map(item => ({ sku: item.sku, quantity: item.quantity })) });
      }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
    } catch { return unavailable("cart_review_required"); }
  }
}
