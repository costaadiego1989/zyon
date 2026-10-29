import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { crossSellStorefrontQuoteRequestSchema, crossSellStorefrontQuoteSchema, crossSellStorefrontAcceptanceSchema,
  crossSellStorefrontCartBasisSchema, crossSellStorefrontAcknowledgementSchema, type CrossSellStorefrontQuoteRequest } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import type { StorefrontCrossSellCartPort, StorefrontCrossSellCartScope, StorefrontCrossSellCartAcknowledgement } from "../../domain/ports/storefront-cross-sell-cart.port.js";
import type { StorefrontCart, StorefrontCartCommercialSnapshot } from "../../domain/ports/storefront-cart.port.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";
import { evaluateStorefrontCartCommercial, readStorefrontCartCommercial, resolveStorefrontCartCatalogItem } from "./prisma-storefront-local-cart-effect.dependencies.js";
import { lockStorefrontCart, withStorefrontCartInTransaction, crossSellQuoteReviewRequired, cartTotal, rethrowStorefrontCommercialFailure } from "./storefront-cart-transaction.js";
import { assertLocalCartAdmission } from "./local-cart-admission.js";
import { storefrontCartHasCheckoutBinding, assertStorefrontCartUnbound } from "./storefront-checkout-binding-fence.js";
import { lockCrossSellMerchantAuthority, lockCrossSellSelectedAuthority } from "./storefront-cross-sell-authority-fence.js";
import { readNormalCheckoutSourceProjection } from "../../../../shared/persistence/storefront-normal-checkout-read.js";

const scopeSchema = z.strictObject({ merchantId: crossSellStorefrontQuoteRequestSchema.shape.variantId, cartId: crossSellStorefrontQuoteRequestSchema.shape.variantId });
const basis = (cart: StorefrontCartCommercialSnapshot) => crossSellStorefrontCartBasisSchema.parse({ items: cart.items, total: cart.total,
  discount: cart.discount, couponCode: cart.couponCode, freeShipping: cart.freeShipping });
// Used ONLY after the actual NORMAL reader proved the coupon owner. The legacy
// quote contract above remains couponCode:null and is not broadened.
const normalBasis=(cart:StorefrontCartCommercialSnapshot)=>({...crossSellStorefrontCartBasisSchema.parse({
  items:cart.items,total:cart.total,discount:cart.discount,couponCode:null,freeShipping:cart.freeShipping}),
  couponCode:scopeSchema.shape.cartId.nullable().parse(cart.couponCode)});
/** A real connected cart adapter. Not wired as a public grant endpoint until
 * coupon/read/checkout/UI parity gates pass. No provider, retries or nested tx. */
export class PrismaStorefrontCrossSellCartAdapter implements StorefrontCrossSellCartPort {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertNoActiveCoupon(tx: Prisma.TransactionClient, scope: StorefrontCrossSellCartScope): Promise<void> {
    const active = await tx.couponRedemption.findFirst({ where: { merchantId: scope.merchantId, sessionId: scope.cartId, status: { not: "cancelled" } }, select: { id: true } });
    if (active !== null) { z.strictObject({ id: scopeSchema.shape.cartId }).parse(active); throw crossSellQuoteReviewRequired(); }
  }

  private async quoteInTransaction(tx: Prisma.TransactionClient, scope: StorefrontCrossSellCartScope, request: CrossSellStorefrontQuoteRequest) {
    await lockCrossSellMerchantAuthority(tx, scope.merchantId);
    await lockStorefrontCart(tx, scope.merchantId, scope.cartId);
    assertStorefrontCartUnbound(await storefrontCartHasCheckoutBinding(tx, scope.merchantId, scope.cartId));
    await this.assertNoActiveCoupon(tx, scope);
    const cart = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
    if (!cart || cart.merchantId !== scope.merchantId || cart.sessionId !== scope.cartId
      || !(cart.expiresAt instanceof Date) || cart.expiresAt.getTime() <= Date.now()) throw crossSellQuoteReviewRequired();
    const persisted = { ...cart, items: cart.items as unknown as StorefrontCart["items"] };
    const cartBasis = basis(persisted);
    if (cartBasis.items.some(item => item.variantId === request.variantId)) throw crossSellQuoteReviewRequired();
    await lockCrossSellSelectedAuthority(tx, scope.merchantId, cartBasis, request.variantId, request.promotionId);
    const item = await resolveStorefrontCartCatalogItem(tx, scope.merchantId, request.variantId, request.selectedOptionItemIds);
    const optionSelection = item.selectedOptions?.length ? { selectedOptionItemIds: item.selectedOptions.map(option => option.itemId) } : {};
    const promotion = z.strictObject({ id: scopeSchema.shape.cartId, merchantId: scopeSchema.shape.merchantId, updatedAt: z.date() }).parse(
      await tx.crossSellPromotion.findFirst({ where: { id: request.promotionId, merchantId: scope.merchantId }, select: { id: true, merchantId: true, updatedAt: true } }));
    if (promotion.id !== request.promotionId || promotion.merchantId !== scope.merchantId) throw crossSellQuoteReviewRequired();
    await assertLocalCartAdmission(tx, scope.merchantId, request.variantId, request.quantity, item.selectedOptions);
    const simulation: StorefrontCart = { ...persisted, items: [...structuredClone(cartBasis.items), { ...item, variantId: request.variantId, quantity: request.quantity,
      crossSellIntent: { version: 1, promotionId: request.promotionId, promotionUpdatedAt: promotion.updatedAt.toISOString(),
        acceptedQuantity: request.quantity, originalUnitPriceCents: item.unitPriceCents, maximumUnitPriceCents: item.unitPriceCents, ...optionSelection } }] };
    simulation.total = cartTotal(simulation);
    const outcome = await evaluateStorefrontCartCommercial(tx, scope, simulation);
    const target = outcome.quote.items.find(line => line.variantId === request.variantId)!;
    if (target.unitPriceCents >= item.unitPriceCents) throw crossSellQuoteReviewRequired();
    return crossSellStorefrontQuoteSchema.parse({ version: 1, ...scope, variantId: request.variantId, promotionId: request.promotionId, quantity: request.quantity,
      ...optionSelection, ...(item.selectedOptions?.length ? { selectedOptions: item.selectedOptions } : {}), productId: item.productId, sku: item.sku,
      promotionUpdatedAt: promotion.updatedAt.toISOString(), originalUnitPriceCents: item.unitPriceCents,
      maximumUnitPriceCents: target.unitPriceCents, cartBasis, quote: outcome.quote });
  }

  async project(rawScope: StorefrontCrossSellCartScope, rawExpected?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart> {
    return (await this.readProjection(rawScope, rawExpected)).cart;
  }

  async projectForCheckout(rawScope: StorefrontCrossSellCartScope) {
    return this.readProjection(rawScope);
  }

  async projectNormalSource(rawScope:StorefrontCrossSellCartScope,rawExpected?:StorefrontCartCommercialSnapshot){
    const scope=scopeSchema.parse(rawScope),expected=rawExpected===undefined?undefined:structuredClone(rawExpected);
    return this.prisma.$transaction(async tx=>{
      const normal=await readNormalCheckoutSourceProjection(tx,scope);
      if(!normal)return undefined;
      if(expected!==undefined&&!isDeepStrictEqual(normalBasis(normal.source),normalBasis(expected)))throw new StorefrontCartSnapshotConflictError();
      return normal.cart;
    },{isolationLevel:"ReadCommitted",maxWait:10_000,timeout:15_000});
  }

  private async readProjection(rawScope: StorefrontCrossSellCartScope, rawExpected?: StorefrontCartCommercialSnapshot) {
    const scope = scopeSchema.parse(rawScope);
    const snapshot = rawExpected === undefined ? undefined : structuredClone(rawExpected);
    return this.prisma.$transaction(async tx => {
      const normal=await readNormalCheckoutSourceProjection(tx,scope);
      if(normal){
        if(snapshot!==undefined&&!isDeepStrictEqual(normalBasis(normal.source),normalBasis(snapshot)))throw new StorefrontCartSnapshotConflictError();
        return {cart:normal.cart,costsByVariant:normal.costsByVariant};
      }
      const expected=snapshot===undefined?undefined:basis(snapshot);
      await lockStorefrontCart(tx, scope.merchantId, scope.cartId);
      assertStorefrontCartUnbound(await storefrontCartHasCheckoutBinding(tx, scope.merchantId, scope.cartId));
      await this.assertNoActiveCoupon(tx, scope);
      const stored = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } } });
      if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.cartId
        || !(stored.expiresAt instanceof Date) || stored.expiresAt.getTime() <= Date.now()) throw crossSellQuoteReviewRequired();
      const cart: StorefrontCart = { ...stored, items: stored.items as unknown as StorefrontCart["items"] };
      if (expected !== undefined && !isDeepStrictEqual(basis(cart), expected)) throw new StorefrontCartSnapshotConflictError();
      try {
        const { outcome: result, costsByVariant } = await readStorefrontCartCommercial(tx, scope, cart);
        cart.items = cart.items.map((item, index) => ({ ...item, unitPriceCents: result.quote.items[index]!.unitPriceCents,
          ...(result.quote.items[index]!.unitPriceCents === result.quote.items[index]!.baseUnitPriceCents ? {}
            : { pricingOriginalUnitPriceCents: result.quote.items[index]!.baseUnitPriceCents }) }));
        cart.total = result.quote.subtotalCents; cart.discount = result.discountCents; cart.freeShipping = false;
        cart.discountBudget = { version: 1, originalSubtotalCents: result.quote.originalSubtotalCents, promotionDiscountCents: result.quote.promotionDiscountCents };
        if (result.quote.commercialNotices) cart.commercialNotices = result.quote.commercialNotices;
        return { cart, costsByVariant };
      } catch (error) { rethrowStorefrontCommercialFailure(error); }
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  }

  async quote(rawScope: StorefrontCrossSellCartScope, rawRequest: CrossSellStorefrontQuoteRequest) {
    const scope = scopeSchema.parse(rawScope), request = crossSellStorefrontQuoteRequestSchema.parse(rawRequest);
    return this.prisma.$transaction(async tx => {
      try { return await this.quoteInTransaction(tx, scope, request); } catch (error) { rethrowStorefrontCommercialFailure(error); }
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  }

  async accept(rawScope: StorefrontCrossSellCartScope, rawRequest: Parameters<StorefrontCrossSellCartPort["accept"]>[1]): Promise<StorefrontCrossSellCartAcknowledgement> {
    const scope = scopeSchema.parse(rawScope), { expectedQuote } = crossSellStorefrontAcceptanceSchema.parse(rawRequest);
    if (expectedQuote.merchantId !== scope.merchantId || expectedQuote.cartId !== scope.cartId) throw crossSellQuoteReviewRequired();
    await this.prisma.$transaction(async tx => {
      try {
      const current = await this.quoteInTransaction(tx, scope, { variantId: expectedQuote.variantId, promotionId: expectedQuote.promotionId, quantity: expectedQuote.quantity,
        ...(expectedQuote.selectedOptionItemIds?.length ? { selectedOptionItemIds: expectedQuote.selectedOptionItemIds } : {}) });
      if (!isDeepStrictEqual(current.cartBasis, expectedQuote.cartBasis)) throw new StorefrontCartSnapshotConflictError();
      if (!isDeepStrictEqual(current, expectedQuote)) throw crossSellQuoteReviewRequired();
      const item = await resolveStorefrontCartCatalogItem(tx, scope.merchantId, current.variantId, current.selectedOptionItemIds);
      const result = await withStorefrontCartInTransaction(tx, scope.merchantId, scope.cartId, async (_tx, cart) => {
        if (!isDeepStrictEqual(basis(cart), expectedQuote.cartBasis)) throw new StorefrontCartSnapshotConflictError();
        cart.items.push({ ...item, variantId: current.variantId, quantity: current.quantity, crossSellIntent: {
          version: 1, promotionId: current.promotionId, promotionUpdatedAt: current.promotionUpdatedAt, acceptedQuantity: current.quantity,
          originalUnitPriceCents: current.originalUnitPriceCents, maximumUnitPriceCents: current.maximumUnitPriceCents,
          ...(current.selectedOptionItemIds?.length ? { selectedOptionItemIds: current.selectedOptionItemIds } : {}) } });
      });
      if (!result.commercial || !isDeepStrictEqual(result.commercial.quote, expectedQuote.quote)) throw crossSellQuoteReviewRequired();
      } catch (error) { rethrowStorefrontCommercialFailure(error); }
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
    return crossSellStorefrontAcknowledgementSchema.parse({ version: 1, status: "accepted", ...scope });
  }
}

