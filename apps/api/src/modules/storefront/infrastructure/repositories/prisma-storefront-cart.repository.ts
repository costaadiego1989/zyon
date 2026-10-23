import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CartItemNotFoundError } from "../../../catalog/domain/errors.js";
import type { StorefrontCart, StorefrontCartCommercialSnapshot, StorefrontCartItem, StorefrontCartPort, StorefrontCartLineSelector } from "../../domain/ports/storefront-cart.port.js";
import { selectStorefrontCartLine, storefrontCartLineIdentity, StorefrontCartLineSelectionError } from "../../domain/services/storefront-cart-line-identity.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";
import { assertMarketplaceDiscount, withStorefrontCart, crossSellQuoteReviewRequired, type StorefrontCartAccess, type StorefrontCartTransactionWork, type StorefrontCartTransactionResult } from "./storefront-cart-transaction.js";
import { assertLocalCartAdmission } from "./local-cart-admission.js";
import { LegacySavedPriceReviewRequired } from "../../application/services/legacy-saved-price-review.js";

/** Only persisted commercial values participate; timestamps/projections do not. */
function commercialSnapshot(cart: StorefrontCartCommercialSnapshot): StorefrontCartCommercialSnapshot {
  return structuredClone({ items: cart.items, total: cart.total, discount: cart.discount,
    couponCode: cart.couponCode, freeShipping: cart.freeShipping });
}

function assertExpectedCart(cart: StorefrontCart, expected?: StorefrontCartCommercialSnapshot): void {
  if (expected !== undefined && !isDeepStrictEqual(commercialSnapshot(cart), expected)) {
    throw new StorefrontCartSnapshotConflictError();
  }
}
function selectedIndex(cart: StorefrontCart, variantId: string, selector?: StorefrontCartLineSelector): number | undefined {
  try { return selectStorefrontCartLine(cart.items, variantId, selector); }
  catch (error) { if (error instanceof StorefrontCartLineSelectionError) throw new ConflictException(error.message); throw error; }
}

/** Shared mutations only; transaction ownership is supplied by the runner. */
export abstract class StorefrontCartRepositoryCore implements StorefrontCartPort {
  protected abstract withCart<T>(merchantId: string, sessionId: string,
    work: StorefrontCartTransactionWork<T>, access?: StorefrontCartAccess): Promise<StorefrontCartTransactionResult<T | void>>;

  async getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await this.withCart(merchantId, sessionId, async () => {}, "read")).cart;
  }

  async addItem(merchantId: string, sessionId: string, item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }): Promise<StorefrontCart> {
    const quantity = item.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("cart_quantity_invalid");
    return (await this.withCart(merchantId, sessionId, async (tx, cart) => {
      // Only the explicit server quote adapter may introduce accepted intent.
      // Ordinary adds cannot merge plain/benefit lines, including forged metadata.
      if (item.crossSellIntent !== undefined || cart.items.some(line => line.variantId === item.variantId && line.crossSellIntent !== undefined)) throw crossSellQuoteReviewRequired();
      const existing = cart.items.find(line => storefrontCartLineIdentity(line) === storefrontCartLineIdentity(item));
      // Option lines share physical stock; separate booked service slots remain separate units.
      const finalVariantQuantity = cart.items.filter(line => line.variantId === item.variantId).reduce((sum, line) => sum + line.quantity, 0) + quantity;
      const canonical = await assertLocalCartAdmission(tx, merchantId, item.variantId, item.selectedServiceSlot ? (existing?.quantity ?? 0) + quantity : finalVariantQuantity, item.selectedOptions, item.selectedServiceSlot, true);
      // BEFORE quantity is the scoped, locked source, not client metadata.
      // Never extend a saved concession or carry it into a new option identity.
      if (canonical === undefined || item.unitPriceCents !== canonical) throw new LegacySavedPriceReviewRequired("source_changed");
      if (existing && existing.unitPriceCents !== canonical) throw new LegacySavedPriceReviewRequired("quantity_extension");
      if (existing) existing.quantity += quantity;
      else cart.items.push({ ...item, quantity });
    })).cart;
  }

  async removeItem(merchantId: string, sessionId: string, variantId: string, selector?: StorefrontCartLineSelector): Promise<StorefrontCart> {
    selector = selector === undefined ? undefined : structuredClone(selector);
    return (await this.withCart(merchantId, sessionId, async (_tx, cart) => {
      const index = selectedIndex(cart, variantId, selector);
      if (index !== undefined) cart.items.splice(index, 1);
      if (cart.items.length === 0) cart.discount = 0;
    })).cart;
  }

  async updateItemQuantity(merchantId: string, sessionId: string, variantId: string, quantity: number, selector?: StorefrontCartLineSelector): Promise<StorefrontCart> {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99) throw new BadRequestException("cart_quantity_invalid");
    selector = selector === undefined ? undefined : structuredClone(selector);
    if (quantity === 0) return this.removeItem(merchantId, sessionId, variantId, selector);
    return (await this.withCart(merchantId, sessionId, async (tx, cart) => {
      const index = selectedIndex(cart, variantId, selector);
      if (index === undefined) throw new CartItemNotFoundError(variantId);
      const item = cart.items[index]!;
      if (item.crossSellIntent !== undefined && quantity > item.crossSellIntent.acceptedQuantity) throw crossSellQuoteReviewRequired();
      const finalQuantity = item.selectedServiceSlot ? quantity : cart.items.reduce((sum, line, position) =>
        sum + (line.variantId === variantId ? position === index ? quantity : line.quantity : 0), 0);
      const increasing = quantity > item.quantity;
      const canonical = await assertLocalCartAdmission(tx, merchantId, variantId, finalQuantity, item.selectedOptions, item.selectedServiceSlot, increasing);
      if (increasing && (canonical === undefined || item.unitPriceCents !== canonical)) throw new LegacySavedPriceReviewRequired("quantity_extension");
      item.quantity = quantity;
    })).cart;
  }

  async clear(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await this.withCart(merchantId, sessionId, async (_tx, cart) => {
      cart.items = []; cart.discount = 0; cart.couponCode = null;
    })).cart;
  }

  async applyCoupon(merchantId: string, sessionId: string, couponCode: string, discountCents: number,
    expectedCart?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart> {
    const expected = expectedCart === undefined ? undefined : commercialSnapshot(expectedCart);
    return (await this.withCart(merchantId, sessionId, async (_tx, cart) => {
      assertExpectedCart(cart, expected);
      assertMarketplaceDiscount(cart, discountCents);
      cart.couponCode = couponCode; cart.discount = discountCents;
    })).cart;
  }

  async removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await this.withCart(merchantId, sessionId, async (_tx, cart) => {
      cart.couponCode = null; cart.discount = 0;
    })).cart;
  }

  async applyRuleOutcome(merchantId: string, sessionId: string, outcome: { discountCents: number; freeShipping: boolean },
    expectedCart?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart> {
    const expected = expectedCart === undefined ? undefined : commercialSnapshot(expectedCart);
    const { discountCents, freeShipping } = outcome;
    return (await this.withCart(merchantId, sessionId, async (_tx, cart) => {
      assertExpectedCart(cart, expected);
      assertMarketplaceDiscount(cart, discountCents, freeShipping);
      cart.discount = discountCents; cart.freeShipping = freeShipping;
    })).cart;
  }
}

@Injectable()
export class PrismaStorefrontCartRepository extends StorefrontCartRepositoryCore {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) { super(); }

  protected withCart<T>(merchantId: string, sessionId: string, work: StorefrontCartTransactionWork<T>, access?: StorefrontCartAccess): Promise<StorefrontCartTransactionResult<T | void>> {
    return withStorefrontCart(this.prisma, merchantId, sessionId, work, access);
  }
}
