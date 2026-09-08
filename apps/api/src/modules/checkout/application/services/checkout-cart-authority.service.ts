import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Cart, CartItem, CurrencyCode } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ValidateCartForPaymentUseCase } from "../../../commerce/application/validate-cart-for-payment.use-case.js";
import { resolveEffectivePrice } from "../../../catalog/domain/services/price-resolver.service.js";
import type { StorefrontCartItem } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";
import { CartPromoResolutionService } from "./cart-promo-resolution.service.js";

@Injectable()
export class CheckoutCartAuthorityService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly commerce: ValidateCartForPaymentUseCase,
    @Optional() private readonly promotions?: CartPromoResolutionService,
  ) {}

  // Called only with the cart reference authenticated by the embed capability.
  // Persisted lines are server quotations, including modifiers and cross-sell prices.
  async resolveStorefront(merchantId: string, cartRef: string): Promise<Cart> {
    const stored = await this.prisma.storefrontCart.findUnique({
      where: { merchantId_sessionId: { merchantId, sessionId: cartRef } },
    });
    if (!stored || stored.expiresAt.getTime() <= Date.now()) throw new BadRequestException("checkout_cart_expired");
    const lines = stored.items as unknown as StorefrontCartItem[];
    if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new BadRequestException("checkout_cart_items_required");
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: lines.map(line => line.variantId) }, isActive: true, product: { merchantId, isActive: true } },
      include: { product: true, price: true, stock: true },
    });
    const quantities = new Map<string, number>();
    let currency: CurrencyCode | undefined;
    const items: CartItem[] = lines.map(line => {
      this.quantity(line.quantity);
      this.price(line.unitPriceCents);
      const variant = variants.find(candidate => candidate.id === line.variantId && candidate.productId === line.productId);
      if (!variant?.price || variant.sku !== line.sku || variant.product.merchantId !== merchantId) throw new BadRequestException("checkout_product_unavailable");
      const itemCurrency = this.currency(variant.price.currency);
      if (currency && currency !== itemCurrency) throw new BadRequestException("checkout_mixed_currency");
      currency = itemCurrency;
      const quantity = (quantities.get(variant.id) ?? 0) + line.quantity;
      this.quantity(quantity);
      quantities.set(variant.id, quantity);
      if (variant.product.type === "physical" && variant.stock.reduce((sum, stock) => sum + Math.max(0, stock.quantity - stock.reserved), 0) < quantity) {
        throw new BadRequestException("checkout_insufficient_stock");
      }
      try {
        resolveSelectedOptions(extractOptionGroups(variant.product.metadata), (line.selectedOptions ?? []).map(option => option.itemId));
      } catch { throw new BadRequestException("checkout_product_options_changed"); }
      return {
        sku: variant.sku, variantId: variant.id, product_id: variant.productId,
        variant: JSON.stringify([variant.id, (line.selectedOptions ?? []).map(option => option.itemId).sort()]),
        name: line.name, quantity: line.quantity, price: line.unitPriceCents / 100,
        imageUrl: line.imageUrl,
        cost: variant.price.costInCents == null ? undefined : variant.price.costInCents / 100,
        weightGrams: variant.weightGrams ?? undefined, height_cm: variant.heightCm ?? undefined,
        width_cm: variant.widthCm ?? undefined, length_cm: variant.lengthCm ?? undefined,
        category: variant.product.categoryId ?? undefined,
        selected_options: line.selectedOptions?.map(option => ({ group_name: option.groupName, item_name: option.itemName, price_modifier: option.priceModifierInCents / 100 })),
      };
    });
    const quoted: Cart & { cart_ref: string } = { items, currency: currency!, total: 0, source: "storefront", cart_ref: cartRef, currentDiscount: stored.discount / 100 };
    const cart = await this.promotions?.resolveCartPromos(quoted, merchantId) ?? quoted;
    const totalCents = cart.items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
    this.price(totalCents);
    this.price(stored.discount);
    return { ...cart, total: totalCents / 100, currentDiscount: Math.min(stored.discount, totalCents) / 100 };
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
      where: { sku: { in: [...quantities.keys()] }, isActive: true, product: { merchantId, isActive: true } },
      include: { product: true, price: true, stock: true, media: { orderBy: { order: "asc" }, take: 1 } },
    });
    const now = new Date();
    const promotions = await this.prisma.productPromotion.findMany({
      where: { merchantId, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
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
      let priceCents = variant.price.basePriceInCents;
      for (const promotion of promotions) {
        if (promotion.variantId !== variant.id && (!variant.product.categoryId || promotion.categoryId !== variant.product.categoryId)) continue;
        const discountType = promotion.discountType;
        const discountValue = promotion.discountValue;
        if ((discountType !== "percent" && discountType !== "fixed") ||
          typeof discountValue !== "number" || !Number.isFinite(discountValue) || discountValue < 0) {
          throw new BadRequestException("checkout_product_promotion_invalid");
        }
        const resolved = resolveEffectivePrice(variant.price.basePriceInCents, {
          discountType,
          discountValue,
          isActive: true,
        }, null);
        priceCents = Math.min(priceCents, resolved.effectivePriceCents);
      }
      this.price(priceCents);
      if (variant.product.type === "physical") {
        const available = variant.stock.reduce((sum, stock) => sum + Math.max(0, stock.quantity - stock.reserved), 0);
        if (available < quantity) throw new BadRequestException("checkout_insufficient_stock");
      }
      totalCents += priceCents * quantity;
      items.push({
        sku, variantId: variant.id, quantity, name: variant.product.name, price: priceCents / 100,
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
    return { currency: currency!, total: totalCents / 100, items, source: "checkout" };
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
