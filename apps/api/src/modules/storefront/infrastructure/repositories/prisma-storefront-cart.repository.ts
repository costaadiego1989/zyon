import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CartItemNotFoundError } from "../../../catalog/domain/errors.js";
import type { StorefrontCart, StorefrontCartItem, StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { assertMarketplaceDiscount, withStorefrontCart } from "./storefront-cart-transaction.js";
import { assertLocalCartAdmission } from "./local-cart-admission.js";

@Injectable()
export class PrismaStorefrontCartRepository implements StorefrontCartPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async () => {})).cart;
  }

  async addItem(merchantId: string, sessionId: string, item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }): Promise<StorefrontCart> {
    const quantity = item.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) throw new BadRequestException("cart_quantity_invalid");
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (tx, cart) => {
      const optionKey = (options?: StorefrontCartItem["selectedOptions"]) => (options ?? []).map(option => option.itemId).sort().join(",");
      const existing = cart.items.find(line => line.variantId === item.variantId && optionKey(line.selectedOptions) === optionKey(item.selectedOptions)
        && line.selectedServiceSlot?.slotId === item.selectedServiceSlot?.slotId);
      // Option lines share physical stock; separate booked service slots remain separate units.
      const finalVariantQuantity = cart.items.filter(line => line.variantId === item.variantId).reduce((sum, line) => sum + line.quantity, 0) + quantity;
      await assertLocalCartAdmission(tx, merchantId, item.variantId, item.selectedServiceSlot ? (existing?.quantity ?? 0) + quantity : finalVariantQuantity, item.selectedOptions, item.selectedServiceSlot);
      if (existing) existing.quantity += quantity;
      else cart.items.push({ ...item, quantity });
    })).cart;
  }

  async removeItem(merchantId: string, sessionId: string, variantId: string): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (_tx, cart) => {
      cart.items = cart.items.filter(line => line.variantId !== variantId);
      if (cart.items.length === 0) cart.discount = 0;
    })).cart;
  }

  async updateItemQuantity(merchantId: string, sessionId: string, variantId: string, quantity: number): Promise<StorefrontCart> {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 99) throw new BadRequestException("cart_quantity_invalid");
    if (quantity === 0) return this.removeItem(merchantId, sessionId, variantId);
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (tx, cart) => {
      const matches = cart.items.filter(line => line.variantId === variantId);
      if (!matches.length) throw new CartItemNotFoundError(variantId);
      if (matches.length > 1) throw new ConflictException("cart_option_line_selection_required");
      const item = matches[0]!;
      await assertLocalCartAdmission(tx, merchantId, variantId, quantity, item.selectedOptions, item.selectedServiceSlot);
      item.quantity = quantity;
    })).cart;
  }

  async clear(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (_tx, cart) => {
      cart.items = []; cart.discount = 0; cart.couponCode = null;
    })).cart;
  }

  async applyCoupon(merchantId: string, sessionId: string, couponCode: string, discountCents: number): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (_tx, cart) => {
      assertMarketplaceDiscount(cart, discountCents);
      cart.couponCode = couponCode; cart.discount = discountCents;
    })).cart;
  }

  async removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (_tx, cart) => {
      cart.couponCode = null; cart.discount = 0;
    })).cart;
  }

  async applyRuleOutcome(merchantId: string, sessionId: string, outcome: { discountCents: number; freeShipping: boolean }): Promise<StorefrontCart> {
    return (await withStorefrontCart(this.prisma, merchantId, sessionId, async (_tx, cart) => {
      assertMarketplaceDiscount(cart, outcome.discountCents, outcome.freeShipping);
      cart.discount = outcome.discountCents; cart.freeShipping = outcome.freeShipping;
    })).cart;
  }
}
