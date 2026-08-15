import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { CartItemNotFoundError } from "../../../catalog/domain/errors.js";
import type {
  StorefrontCart,
  StorefrontCartItem,
  StorefrontCartPort
} from "../../domain/ports/storefront-cart.port.js";

const CART_TTL_HOURS = 72;

function computeTotal(items: StorefrontCartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

function toCart(row: {
  id: string;
  merchantId: string;
  sessionId: string;
  items: unknown;
  couponCode: string | null;
  discount: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}): StorefrontCart {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sessionId: row.sessionId,
    items: (row.items as StorefrontCartItem[]) ?? [],
    couponCode: row.couponCode,
    discount: row.discount,
    total: row.total,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

@Injectable()
export class PrismaStorefrontCartRepository implements StorefrontCartPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getOrCreate(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const expiresAt = new Date(Date.now() + CART_TTL_HOURS * 3600_000);
    const row = await this.prisma.storefrontCart.upsert({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      create: { merchantId, sessionId, items: [], total: 0, discount: 0, expiresAt },
      update: { expiresAt }
    });
    return toCart(row);
  }

  async addItem(
    merchantId: string,
    sessionId: string,
    item: Omit<StorefrontCartItem, "quantity"> & { quantity?: number }
  ): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    const existing = cart.items.find((i) => i.variantId === item.variantId);
    if (existing) {
      existing.quantity += item.quantity ?? 1;
    } else {
      cart.items.push({ ...item, quantity: item.quantity ?? 1 });
    }
    const total = computeTotal(cart.items);
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { items: cart.items as any, total, discount: cart.discount }
    });
    return toCart(row);
  }

  async removeItem(merchantId: string, sessionId: string, variantId: string): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    cart.items = cart.items.filter((i) => i.variantId !== variantId);
    const total = computeTotal(cart.items);
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { items: cart.items as any, total, discount: cart.items.length === 0 ? 0 : cart.discount }
    });
    return toCart(row);
  }

  async updateItemQuantity(
    merchantId: string,
    sessionId: string,
    variantId: string,
    quantity: number
  ): Promise<StorefrontCart> {
    if (quantity <= 0) return this.removeItem(merchantId, sessionId, variantId);
    const cart = await this.getOrCreate(merchantId, sessionId);
    const item = cart.items.find((i) => i.variantId === variantId);
    if (!item) throw new CartItemNotFoundError(variantId);
    item.quantity = Math.min(quantity, 99);
    const total = computeTotal(cart.items);
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { items: cart.items as any, total }
    });
    return toCart(row);
  }

  async clear(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { items: [], total: 0, discount: 0, couponCode: null }
    });
    return toCart(row);
  }

  async applyCoupon(
    merchantId: string,
    sessionId: string,
    couponCode: string,
    discountCents: number
  ): Promise<StorefrontCart> {
    const cart = await this.getOrCreate(merchantId, sessionId);
    const total = computeTotal(cart.items);
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { couponCode, discount: discountCents, total }
    });
    return toCart(row);
  }

  async removeCoupon(merchantId: string, sessionId: string): Promise<StorefrontCart> {
    const row = await this.prisma.storefrontCart.update({
      where: { merchantId_sessionId: { merchantId, sessionId } },
      data: { couponCode: null, discount: 0 }
    });
    return toCart(row);
  }
}
