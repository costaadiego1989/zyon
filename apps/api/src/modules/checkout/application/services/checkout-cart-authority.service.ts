import { resolveSelectedServiceSlot, serviceSlotSnapshotMatches, serviceSlotLabel } from "../../../catalog/domain/services/service-schedule.js";
import { fulfillmentStrategy } from "../../../operations/domain/order-fulfillment.js";
import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Cart, CartItem, CurrencyCode } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ValidateCartForPaymentUseCase } from "../../../commerce/application/validate-cart-for-payment.use-case.js";
import type { StorefrontCartItem } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";
import { CartPromoResolutionService, checkoutCartLineIdentity, storefrontCrossSellLineIdentity, storefrontCrossSellOptionsMatch } from "./cart-promo-resolution.service.js";
import { isDeepStrictEqual } from "node:util";
import { STOREFRONT_CROSS_SELL_CART, type StorefrontCrossSellCartPort } from "../../../storefront/domain/ports/storefront-cross-sell-cart.port.js";
import { couponNudge } from "../../../coupons/application/services/checkout-coupon.js";
import { LegacySavedPriceReviewRequired } from "../../../storefront/application/services/legacy-saved-price-review.js";

@Injectable()
export class CheckoutCartAuthorityService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly commerce: ValidateCartForPaymentUseCase,
    @Optional() private readonly promotions?: CartPromoResolutionService,
    @Optional() @Inject(STOREFRONT_CROSS_SELL_CART) private readonly crossSellCart?: Pick<StorefrontCrossSellCartPort, "project">,
  ) {}

  // Called only with the cart reference authenticated by the embed capability.
  // Explicitly approved saved quotations are preserved only for existing scoped
  // lines/quantities; current catalog B and saved S are accounted separately.
  async resolveStorefront(merchantId: string, cartRef: string): Promise<Cart> {
    const stored = await this.prisma.storefrontCart.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId: cartRef } },
    });
    if (!stored || stored.expiresAt.getTime() <= Date.now()) throw new BadRequestException("checkout_cart_expired");
    if (stored.merchantId !== undefined && stored.merchantId !== merchantId || stored.sessionId !== undefined && stored.sessionId !== cartRef)
      throw new BadRequestException("checkout_cart_scope_invalid");
    const quoted = await this.resolveStorefrontLines(merchantId, cartRef, stored.items as unknown as StorefrontCartItem[], stored.discount, false);
    if (stored.couponCode === null || stored.couponCode === undefined) return quoted;
    const code = stored.couponCode;
    if (typeof code !== "string" || !code || code.trim() !== code || code.length > 191 || code.includes("\0")) {
      throw new BadRequestException("checkout_coupon_review_required");
    }
    // Preserve server provenance, not a new grant. Exact reservation and buyer
    // ownership are revalidated under transactional fences before admission.
    // Otherwise benefits preparation can mistake this D for a progressive grant.
    const discount = quoted.currentDiscount ?? 0;
    return { ...quoted,
      commercialNudge: couponNudge({ code, discount_type: "fixed" }, discount, 0, quoted.total),
      appliedBenefits: [...(quoted.appliedBenefits ?? []).filter(benefit => benefit.kind !== "discount"),
        ...(discount > 0 ? [{ kind: "discount" as const, label: `Cupom ${code}`, amount: discount }] : [])],
    };
  }

  /** Only the authenticated, persisted checkout snapshot may supply these lines. */
  async resolveRecoveredStorefront(merchantId: string, snapshot: Cart, cartRef: string): Promise<Cart> {
    if (snapshot.items.some(item => item.crossSellIntent !== undefined)) {
      if (!this.crossSellCart || snapshot.cart_ref !== cartRef) throw new BadRequestException("checkout_price_review_required");
      const current = await this.crossSellCart.project({ merchantId, cartId: cartRef });
      if (current.items.length !== snapshot.items.length || new Set(snapshot.items.map(checkoutCartLineIdentity)).size !== snapshot.items.length
        || new Set(current.items.map(storefrontCrossSellLineIdentity)).size !== current.items.length
        || snapshot.items.some(item => {
          const line = current.items.find(line => storefrontCrossSellLineIdentity(line) === checkoutCartLineIdentity(item));
          return !line || line.productId !== item.product_id || line.sku !== item.sku || line.quantity !== item.quantity
            || !storefrontCrossSellOptionsMatch(item, line)
            || !isDeepStrictEqual(item.crossSellIntent, line.crossSellIntent)
            || Math.round((item.originalPrice ?? item.price) * 100) !== (line.pricingOriginalUnitPriceCents ?? line.unitPriceCents);
        })) throw new BadRequestException("checkout_price_review_required");
      return this.resolveStorefront(merchantId, cartRef);
    }
    const lines = snapshot.items.map(item => {
      let optionIds: string[] = [];
      if (item.variant) {
        try {
          const selection = JSON.parse(item.variant);
          if (!Array.isArray(selection) || selection[0] !== item.variantId || !Array.isArray(selection[1])
            || !selection[1].every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_-]{1,191}$/.test(id))) throw new Error();
          optionIds = selection[1];
        } catch { throw new BadRequestException("checkout_product_options_changed"); }
      } else if (item.selected_options?.length) throw new BadRequestException("checkout_product_options_changed");
      return {
        variantId: item.variantId ?? "", productId: item.product_id ?? "", sku: item.sku, name: item.name,
        quantity: item.quantity, unitPriceCents: Math.round(item.price * 100), imageUrl: item.imageUrl,
        selectedOptions: optionIds.map(itemId => ({ itemId, groupId: "", groupName: "", itemName: "", priceModifierInCents: 0 })),
      };
    });
    if (snapshot.cart_ref === cartRef) {
      const current = await this.prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId, sessionId: cartRef } } });
      if (current && current.expiresAt.getTime() > Date.now()
        && Array.isArray(current.items)) {
        const keys = (items: StorefrontCartItem[]) => items.map(line => JSON.stringify([
          line.variantId, line.productId, line.sku, line.quantity, line.unitPriceCents,
          (line.selectedOptions ?? []).map(option => option.itemId).sort(),
        ])).sort();
        const expected = lines.map((line, index) => ({ ...line,
          unitPriceCents: Math.round((snapshot.items[index]!.originalPrice ?? snapshot.items[index]!.price) * 100),
        }));
        if (isDeepStrictEqual(keys(current.items as unknown as StorefrontCartItem[]), keys(expected))
          || isDeepStrictEqual(keys(current.items as unknown as StorefrontCartItem[]), keys(lines))) {
          // Only an exact authenticated source continuation may restore its D.
          // A different cart never donates benefits or changes recovered lines.
          return this.resolveStorefront(merchantId, cartRef);
        }
      }
    }
    // No exact source continuation: remembered commercial terms must not be
    // silently replaced. Only an unreferenced, ungranted authenticated snapshot
    // supplies identities/quantity for a NEW current-catalog quotation. Equal
    // originalPrice metadata alone is not evidence of a previous reduction.
    if (snapshot.cart_ref !== undefined || snapshot.discountBudget !== undefined
      || snapshot.items.some(item => item.originalPrice !== undefined && item.originalPrice !== item.price)
      || snapshot.commercialNudge?.kind === "coupon" || snapshot.appliedBenefits?.some(benefit => benefit.amount > 0))
      throw new LegacySavedPriceReviewRequired("source_changed");
    return this.resolveStorefrontLines(merchantId, cartRef, lines, 0, true);
  }

  private async resolveStorefrontLines(merchantId: string, cartRef: string, lines: StorefrontCartItem[], discount: number, reprice: boolean): Promise<Cart> {
    if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new BadRequestException("checkout_cart_items_required");
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: lines.map(line => line.variantId) }, isActive: true, product: { merchantId, isActive: true, deletedAt: null } },
      include: {
        product: true,
        price: true,
        stock: true,
        media: { orderBy: { order: "asc" }, take: 1 },
      },
    });
    const productIdsWithoutVariantImage = [...new Set(
      variants.filter(variant => !variant.media[0]?.url).map(variant => variant.productId),
    )];
    const fallbackMedia = productIdsWithoutVariantImage.length
      ? await this.prisma.productVariant.findMany({
        where: { productId: { in: productIdsWithoutVariantImage }, isActive: true,
          product: { merchantId, isActive: true, deletedAt: null }, media: { some: {} } },
        select: { productId: true, media: { orderBy: { order: "asc" }, take: 1 } },
      })
      : [];
    const productImages = new Map<string, string>();
    for (const candidate of fallbackMedia) {
      const imageUrl = candidate.media[0]?.url;
      if (imageUrl && !productImages.has(candidate.productId)) productImages.set(candidate.productId, imageUrl);
    }
    const quantities = new Map<string, number>();
    let canonicalSubtotalCents = 0, hasLegacySavedPrice = false;
    let currency: CurrencyCode | undefined;
    const items: CartItem[] = lines.map(line => {
      this.quantity(line.quantity);
      this.price(line.unitPriceCents);
      const variant = variants.find(candidate => candidate.id === line.variantId && candidate.productId === line.productId);
      if (!variant?.price || variant.sku !== line.sku || variant.product.merchantId !== merchantId) throw new BadRequestException("checkout_product_unavailable");
      if (variant.product.type === "service") {
        try {
          const currentSlot = resolveSelectedServiceSlot(variant.product.metadata, line.selectedServiceSlot?.slotId);
          if (currentSlot && (!line.selectedServiceSlot || line.quantity !== 1 || !serviceSlotSnapshotMatches(currentSlot, line.selectedServiceSlot))) throw Error();
        } catch { throw new BadRequestException("checkout_service_slot_changed"); }
      }
      const itemCurrency = this.currency(variant.price.currency);
      if (currency && currency !== itemCurrency) throw new BadRequestException("checkout_mixed_currency");
      currency = itemCurrency;
      const quantity = (quantities.get(variant.id) ?? 0) + line.quantity;
      this.quantity(quantity);
      quantities.set(variant.id, quantity);
      if (variant.product.type === "physical" && variant.stock.reduce((sum, stock) => sum + Math.max(0, stock.quantity - stock.reserved), 0) < quantity) {
        throw new BadRequestException("checkout_insufficient_stock");
      }
      let resolvedOptions;
      try {
        resolvedOptions = resolveSelectedOptions(extractOptionGroups(variant.product.metadata), (line.selectedOptions ?? []).map(option => option.itemId));
      } catch { throw new BadRequestException("checkout_product_options_changed"); }
      this.price(variant.price.basePriceInCents);
      const quotedPrice = variant.price.basePriceInCents + resolvedOptions.priceModifierInCents;
      this.price(quotedPrice);
      if (!reprice && line.unitPriceCents > quotedPrice)
        throw new LegacySavedPriceReviewRequired("source_changed");
      if (line.crossSellIntent !== undefined && line.unitPriceCents !== quotedPrice) throw new BadRequestException("checkout_price_review_required");
      if (!reprice && line.unitPriceCents !== quotedPrice) {
        const sortOptions = (options: NonNullable<StorefrontCartItem["selectedOptions"]>) => [...options].sort((a, b) => a.itemId.localeCompare(b.itemId));
        if (!isDeepStrictEqual(sortOptions(line.selectedOptions ?? []), sortOptions(resolvedOptions.selected))) throw new LegacySavedPriceReviewRequired("source_changed");
        hasLegacySavedPrice = true;
      }
      canonicalSubtotalCents += quotedPrice * line.quantity;
      this.price(canonicalSubtotalCents);
      return {
        sku: variant.sku, variantId: variant.id, product_id: variant.productId,
        ...(line.crossSellIntent !== undefined ? { crossSellIntent: structuredClone(line.crossSellIntent) } : {}),
        productType: variant.product.type as CartItem["productType"],
        fulfillmentStrategy: fulfillmentStrategy(variant.product.type, variant.product.metadata, !!line.selectedServiceSlot),
        ...(line.selectedServiceSlot ? { fulfillmentSchedule: line.selectedServiceSlot } : {}),
        variant: JSON.stringify([variant.id, (line.selectedOptions ?? []).map(option => option.itemId).sort()]),
        variantLabel: [
          ...Object.values((variant.attributes ?? {}) as Record<string, unknown>)
            .filter((value): value is string => typeof value === "string" && Boolean(value.trim())),
          ...(reprice ? resolvedOptions.selected : line.selectedOptions ?? []).map(option => option.itemName),
        ].join(" · "),
        name: reprice ? variant.product.name : line.name, quantity: line.quantity, price: (reprice ? quotedPrice : line.unitPriceCents) / 100,
        ...(!reprice && line.unitPriceCents < quotedPrice ? { originalPrice: quotedPrice / 100 } : {}),
        imageUrl: variant.media[0]?.url ?? productImages.get(variant.productId) ?? line.imageUrl,
        cost: variant.price.costInCents == null ? undefined : variant.price.costInCents / 100,
        weightGrams: variant.weightGrams ?? undefined, height_cm: variant.heightCm ?? undefined,
        width_cm: variant.widthCm ?? undefined, length_cm: variant.lengthCm ?? undefined,
        category: variant.product.categoryId ?? undefined,
        selected_options: (reprice ? resolvedOptions.selected : line.selectedOptions)?.map(option => ({ group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100 })),
      };
    });
    const totalCents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
    this.price(totalCents);
    this.price(discount);
    const quoted: Cart & { cart_ref: string } = { items, currency: currency!, total: totalCents / 100,
      source: "storefront", cart_ref: cartRef, currentDiscount: reprice ? 0 : discount / 100 };
    if (hasLegacySavedPrice) {
      if (currency !== "BRL") throw new LegacySavedPriceReviewRequired("source_changed");
      quoted.discountBudget = { version: 1, originalSubtotalCents: canonicalSubtotalCents, promotionDiscountCents: canonicalSubtotalCents - totalCents };
    }
    return this.projectPromotions(quoted, merchantId);
  }

  async resolve(merchantId: string, submitted: Cart): Promise<Cart> {
    if (!submitted || typeof submitted !== "object") {
      throw new BadRequestException("checkout_cart_required");
    }
    if (submitted.commerceCartRef !== undefined) {
      if (typeof submitted.commerceCartRef !== "string" || !submitted.commerceCartRef.trim()) {
        throw new BadRequestException("checkout_commerce_cart_ref_invalid");
      }
      const { trustedCart } = await this.commerce.execute({
        merchantId,
        commerceCartRef: submitted.commerceCartRef,
      });
      const currency = this.currency(trustedCart.currency);
      if (!Array.isArray(trustedCart.lines) || !trustedCart.lines.length || trustedCart.lines.length > 100) {
        throw new BadRequestException("checkout_cart_items_invalid");
      }
      let totalCents = 0;
      const items = trustedCart.lines.map((line): CartItem => {
        this.quantity(line.quantity);
        this.price(line.unitPriceCents);
        totalCents += line.unitPriceCents * line.quantity;
        return { sku: line.sku, name: line.title, price: line.unitPriceCents / 100, quantity: line.quantity };
      });
      // A provider total containing unmodeled tax, discount or freight must not be
      // silently treated as item subtotal; payment needs a complete breakdown.
      if (!Number.isSafeInteger(totalCents) || totalCents !== trustedCart.totalCents) {
        throw new BadRequestException("checkout_commerce_total_breakdown_required");
      }
      return { currency, total: totalCents / 100, items, source: "platform_api", commerceCartRef: trustedCart.commerceCartRef };
    }

    if (!Array.isArray(submitted.items) || !submitted.items.length || submitted.items.length > 100) {
      throw new BadRequestException("checkout_cart_items_required");
    }
    const quantities = new Map<string, number>();
    for (const line of submitted.items) {
      if (!line || typeof line.sku !== "string" || !line.sku.trim() || line.sku.length > 200) {
        throw new BadRequestException("checkout_sku_invalid");
      }
      this.quantity(line.quantity);
      const sku = line.sku.trim();
      const quantity = (quantities.get(sku) ?? 0) + line.quantity;
      this.quantity(quantity);
      quantities.set(sku, quantity);
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: [...quantities.keys()] }, isActive: true, product: { merchantId, isActive: true, deletedAt: null } },
      include: { product: true, price: true, stock: true, media: { orderBy: { order: "asc" }, take: 1 } },
    });
    let currency: CurrencyCode | undefined;
    let totalCents = 0;
    const items: CartItem[] = [];
    for (const [sku, quantity] of quantities) {
      const matches = variants.filter((variant) => variant.sku === sku);
      // SKU uniqueness is per product in the schema; ambiguous SKUs cannot be priced safely.
      if (matches.length !== 1) throw new BadRequestException("checkout_unknown_or_ambiguous_sku");
      const variant = matches[0]!;
      if (!variant.price) throw new BadRequestException("checkout_product_price_missing");
      const itemCurrency = this.currency(variant.price.currency);
      if (currency && itemCurrency !== currency) throw new BadRequestException("checkout_mixed_currency");
      currency = itemCurrency;
      this.price(variant.price.basePriceInCents);
      const priceCents = variant.price.basePriceInCents;
      this.price(priceCents);
      if (variant.product.type === "physical") {
        const available = variant.stock.reduce((sum, stock) => sum + Math.max(0, stock.quantity - stock.reserved), 0);
        if (available < quantity) throw new BadRequestException("checkout_insufficient_stock");
      }
      totalCents += priceCents * quantity;
      items.push({
        sku, variantId: variant.id, quantity, name: variant.product.name, price: priceCents / 100,
        productType: variant.product.type as CartItem["productType"], fulfillmentStrategy: fulfillmentStrategy(variant.product.type, variant.product.metadata),
        cost: variant.price.costInCents == null ? undefined : variant.price.costInCents / 100,
        weightGrams: variant.weightGrams ?? undefined,
        height_cm: variant.heightCm ?? undefined,
        width_cm: variant.widthCm ?? undefined,
        length_cm: variant.lengthCm ?? undefined,
        imageUrl: variant.media[0]?.url,
        category: variant.product.categoryId ?? undefined,
        product_id: variant.productId,
      });
    }
    if (!Number.isSafeInteger(totalCents)) throw new BadRequestException("checkout_total_invalid");
    return this.projectPromotions({ currency: currency!, total: totalCents / 100, items, source: "checkout" }, merchantId);
  }

  private async projectPromotions(cart: Cart, merchantId: string): Promise<Cart> {
    if (this.promotions) return this.promotions.resolveCartPromos(cart, merchantId);
    if (cart.items.some(item => item.crossSellIntent !== undefined)) throw new BadRequestException("checkout_price_review_required");
    if ((cart.currentDiscount ?? 0) > 0 || (cart.discountBudget?.promotionDiscountCents ?? 0) > 0) throw new BadRequestException("checkout_discount_policy_unavailable");
    // Backwards test construction without the real module grants no promotion.
    return cart;
  }

  private quantity(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 99) throw new BadRequestException("checkout_quantity_invalid");
  }

  private price(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new BadRequestException("checkout_price_invalid");
  }

  private currency(value: string): CurrencyCode {
    if (value !== "BRL" && value !== "USD" && value !== "EUR") throw new BadRequestException("checkout_currency_invalid");
    return value;
  }
}
