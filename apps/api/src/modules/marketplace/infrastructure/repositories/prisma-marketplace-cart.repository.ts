import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CrossStoreLineItem } from "@zyon/shared-types";
import type { StorefrontCart, StorefrontCartItem } from "../../../storefront/domain/ports/storefront-cart.port.js";
import { assertMarketplaceDiscount, withStorefrontCart } from "../../../storefront/infrastructure/repositories/storefront-cart-transaction.js";
import { extractOptionGroups, resolveSelectedOptions } from "../../../storefront/domain/food-options.js";
import { CommissionCalculatorService } from "../../domain/services/commission-calculator.service.js";
import { isBillingFeatureEnabled } from "../../../payment/domain/billing-plans.js";
import { MARKETPLACE_PROVIDER_FEE_POLICY } from "../../domain/services/marketplace-provider-fee-allocation.js";
import { marketplaceVariantAttributesLabel, marketplaceVariantLabel } from "../../domain/services/marketplace-variant.js";
import { isStorefrontTelemetrySession } from "../../../storefront/domain/storefront-telemetry-session.js";
import { assertMarketplaceProductOptions } from "../../domain/services/marketplace-product-options.js";

const commissions = new CommissionCalculatorService();
type Db = Prisma.TransactionClient;

export async function assertMarketplacePartners(db: Db, hostId: string, sellerId: string, categoryId?: string | null) {
  if (hostId === sellerId) throw new BadRequestException("marketplace_own_product");
  const select = { name: true, marketplaceConfig: true, billingAccountMerchantId: true, billingSubscription: true,
    billingAccount: { select: { billingSubscription: true } } } as const;
  const [host, seller, connection] = await Promise.all([
    db.merchant.findUnique({ where: { id: hostId }, select }),
    db.merchant.findUnique({ where: { id: sellerId }, select }),
    db.marketplaceConnection.findUnique({ where: { buyerMerchantId_sellerMerchantId: { buyerMerchantId: hostId, sellerMerchantId: sellerId } } }),
  ]);
  const config = host?.marketplaceConfig, sellerConfig = seller?.marketplaceConfig;
  for (const merchant of [host, seller]) {
    const subscription = merchant?.billingAccountMerchantId ? merchant.billingAccount?.billingSubscription : merchant?.billingSubscription;
    if (!isBillingFeatureEnabled(subscription, "marketplace")) throw new ForbiddenException("marketplace_plan_unavailable");
  }
  if (!config?.enabled || !sellerConfig?.enabled || connection?.status !== "active" ||
      config.blockedMerchants.includes(sellerId) || sellerConfig.blockedMerchants.includes(hostId)) {
    throw new ConflictException("marketplace_seller_unavailable");
  }
  if (config.allowedCategories.length && (!categoryId || !config.allowedCategories.includes(categoryId))) {
    throw new ConflictException("marketplace_category_unavailable");
  }
  return { config, sellerConfig, sellerName: seller!.name };
}

function quantity(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 99) throw new BadRequestException("marketplace_quantity_invalid");
}

export async function assertMarketplaceCartMutable(db: Db, cart: StorefrontCart): Promise<void> {
  // A checkout already issued from this cart is a frozen quote. New purchases
  // use a new conversation/cart, avoiding stale sessions and payment retries.
  const scope = { merchantId: cart.merchantId,
    OR: [{ sessionId: cart.sessionId }, { cart: { path: ["cart_ref"], equals: cart.sessionId } }] };
  const checkout = await db.checkoutSession.findFirst({ where: scope, select: {
    merchantId: true, sessionId: true, conversationId: true, globalUserId: true, cart: true,
    customer: true, shipping: true, shippingOptions: true, abandonmentScore: true, triggerAgent: true,
    chatHistory: true, promptVariantId: true, cohort: true, featuresApplied: true, aiCostCents: true, version: true,
    _count: { select: { authorizedOffers: true, acceptedOffers: true, completedOrders: true } },
  } });
  if (!checkout) return;
  // Conversation funnel telemetry creates an explicitly marked empty row.
  // Its marker never permits changing a real quote or a financial operation.
  if (!isStorefrontTelemetrySession(checkout, cart.merchantId, cart.sessionId) ||
      await db.checkoutSession.findFirst({ where: { ...scope, sessionId: { not: cart.sessionId } }, select: { sessionId: true } }) ||
      await db.paymentIntent.findFirst({ where: { merchantId: cart.merchantId, sessionId: cart.sessionId }, select: { id: true } }) ||
      await db.marketplaceFundingPlan.findFirst({ where: { hostMerchantId: cart.merchantId, OR: [
        { checkoutSessionId: cart.sessionId }, { payment: { merchantId: cart.merchantId, sessionId: cart.sessionId } },
      ] }, select: { paymentIntentId: true } })) throw new ConflictException("marketplace_cart_checkout_started");
}

/** Same variant lock as the catalog reservation writer and expiry worker. */
async function lockVariant(db: Db, variantId: string) {
  await db.$queryRaw`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`;
}

export async function changeMarketplaceCartQuantity(db: Db, cart: StorefrontCart, line: StorefrontCartItem, next: number) {
  quantity(next, true);
  await assertMarketplaceCartMutable(db, cart);
  await lockVariant(db, line.variantId);
  const item = await db.crossStoreLineItem.findFirst({ where: { id: line.marketplace?.lineItemId,
    hostMerchantId: cart.merchantId, checkoutSessionId: cart.sessionId, sellerMerchantId: line.marketplace?.sellerMerchantId } });
  if (!item || item.orderId || item.sourceVariantId !== line.variantId || item.quantity !== line.quantity ||
      item.unitPriceCents !== line.unitPriceCents || item.federatedProductId !== line.marketplace?.federatedProductId) {
    throw new ConflictException("marketplace_cart_binding_invalid");
  }
  const variant = await db.productVariant.findUnique({ where: { id: line.variantId }, include: { product: true, price: true } });
  if (next > 0) {
    if (!variant?.isActive || !variant.product.isActive || variant.product.deletedAt ||
        variant.product.merchantId !== item.sellerMerchantId || variant.productId !== line.productId ||
        variant.price?.currency !== "BRL" || variant.price.basePriceInCents !== line.unitPriceCents) {
      throw new ConflictException("marketplace_product_changed");
    }
    await assertMarketplacePartners(db, cart.merchantId, item.sellerMerchantId, variant.product.categoryId);
  }
  if (item.stockReservationId) {
    const reservation = await db.stockReservation.findUnique({ where: { id: item.stockReservationId } });
    if (!reservation || reservation.variantId !== line.variantId || reservation.cartId !== item.id || reservation.quantity !== line.quantity) {
      throw new ConflictException("marketplace_reservation_binding_invalid");
    }
    if (reservation.status === "CONFIRMED") throw new ConflictException("marketplace_stock_already_consumed");
    if (next > 0 && (reservation.status !== "ACTIVE" || reservation.expiresAt <= new Date())) {
      throw new ConflictException("marketplace_reservation_expired");
    }
    if (reservation.status === "ACTIVE") {
      if (!reservation.stockId) throw new ConflictException("marketplace_reservation_stock_missing");
      const stock = await db.productStock.findUniqueOrThrow({ where: { id: reservation.stockId } });
      if (stock.variantId !== line.variantId) throw new ConflictException("marketplace_reservation_binding_invalid");
      const delta = next - reservation.quantity;
      if (stock.reserved < reservation.quantity || stock.quantity - stock.reserved < delta) throw new ConflictException("marketplace_insufficient_stock");
      const updated = await db.productStock.updateMany({ where: { id: stock.id, reserved: stock.reserved,
        quantity: { gte: stock.reserved + delta } }, data: { reserved: { increment: delta } } });
      if (updated.count !== 1) throw new ConflictException("marketplace_insufficient_stock");
      await db.stockReservation.update({ where: { id: reservation.id }, data: next === 0 ? { status: "RELEASED" } : { quantity: next } });
    }
  } else if (next > 0 && variant && !["digital", "service"].includes(variant.product.type)) {
    throw new ConflictException("marketplace_reservation_required");
  }
  if (next === 0) {
    await db.crossStoreLineItem.delete({ where: { id: item.id } });
    cart.items = cart.items.filter(candidate => candidate !== line);
    return;
  }
  const split = commissions.calculate({ itemPriceCents: line.unitPriceCents, quantity: next, commissionRateBps: item.commissionRateBps });
  await db.crossStoreLineItem.update({ where: { id: item.id }, data: { quantity: next, commissionCents: split.commissionCents, sellerNetCents: split.sellerNetCents } });
  line.quantity = next;
}

/** Read-time validation before constructing a buyer checkout from persisted lines. */
export async function marketplaceCartAllocations(db: Db, host: string, cartRef: string, lines: StorefrontCartItem[]) {
  const records = await db.crossStoreLineItem.findMany({ where: { hostMerchantId: host, checkoutSessionId: cartRef } });
  const marketLines = lines.filter(line => line.marketplace);
  if (records.length !== marketLines.length || new Set(marketLines.map(line => line.marketplace!.lineItemId)).size !== records.length) {
    throw new ConflictException("marketplace_cart_binding_invalid");
  }
  const allocations = new Map<string, CrossStoreLineItem>();
  for (const line of marketLines) {
    const item = records.find(record => record.id === line.marketplace!.lineItemId);
    if (!item || item.orderId || item.sourceVariantId !== line.variantId || item.sellerMerchantId !== line.marketplace!.sellerMerchantId ||
        item.federatedProductId !== line.marketplace!.federatedProductId || item.quantity !== line.quantity || item.unitPriceCents !== line.unitPriceCents ||
        item.commissionCents + item.sellerNetCents !== line.quantity * line.unitPriceCents || !item.termsJson) {
      throw new ConflictException("marketplace_cart_binding_invalid");
    }
    if (item.stockReservationId) {
      const stock = await db.stockReservation.findUnique({ where: { id: item.stockReservationId } });
      if (!stock || stock.cartId !== item.id || stock.variantId !== line.variantId || stock.quantity !== line.quantity ||
          stock.status !== "ACTIVE" || stock.expiresAt <= new Date()) throw new ConflictException("marketplace_reservation_expired");
    }
    allocations.set(line.variantId, { lineItemId: item.id, sourceVariantId: line.variantId,
      stockReservationId: item.stockReservationId ?? undefined, federatedProductId: item.federatedProductId,
      sourceMerchantId: item.sellerMerchantId, quantity: item.quantity, unitPriceCents: item.unitPriceCents,
      providerFeePolicy: (item.termsJson as { providerFeePolicy?: typeof MARKETPLACE_PROVIDER_FEE_POLICY }).providerFeePolicy,
      totalCents: item.quantity * item.unitPriceCents, commissionCents: item.commissionCents, sellerNetCents: item.sellerNetCents });
  }
  return allocations;
}

@Injectable()
export class PrismaMarketplaceCartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(input: { merchantId: string; checkoutSessionId: string; sellerMerchantId: string; federatedProductId: string; sourceVariantId?: string; quantity: number }) {
    quantity(input.quantity);
    return withStorefrontCart(this.prisma, input.merchantId, input.checkoutSessionId, async (tx, cart) => {
      await assertMarketplaceCartMutable(tx, cart);
      if (cart.discount || cart.freeShipping || cart.couponCode) throw new ConflictException("marketplace_discount_allocation_required");
      const projection = await tx.federatedProduct.findUnique({ where: { id: input.federatedProductId } });
      if (!projection || projection.sourceMerchantId !== input.sellerMerchantId) throw new NotFoundException("marketplace_product_unavailable");
      // Query by relation: intentional cross-merchant catalog read, never a
      // tenant-middleware-rewritten Product query or a client-authored price.
      const variants = await tx.productVariant.findMany({ where: { ...(input.sourceVariantId ? { id: input.sourceVariantId } : {}),
        productId: projection.sourceProductId, isActive: true, product: { merchantId: input.sellerMerchantId, isActive: true, deletedAt: null } },
        select: { id: true }, take: 2 });
      if (variants.length !== 1) throw new ConflictException("marketplace_variant_selection_required");
      const variantId = variants[0]!.id;
      await lockVariant(tx, variantId);
      const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: {
        product: { include: { _count: { select: { variants: { where: { isActive: true } } } } } },
        price: true, stock: { orderBy: { id: "asc" } }, media: { orderBy: { order: "asc" }, take: 1 } } });
      if (variant.product.merchantId !== input.sellerMerchantId || variant.productId !== projection.sourceProductId ||
          !variant.isActive || !variant.product.isActive || variant.product.deletedAt || variant.price?.currency !== "BRL" ||
          !Number.isSafeInteger(variant.price.basePriceInCents) || variant.price.basePriceInCents <= 0) throw new ConflictException("marketplace_product_unavailable");
      // Required customizations must be selected through a modeled option flow.
      try { assertMarketplaceProductOptions(variant.product.metadata); resolveSelectedOptions(extractOptionGroups(variant.product.metadata), []); }
      catch { throw new ConflictException("marketplace_product_options_required"); }
      const { config, sellerConfig, sellerName } = await assertMarketplacePartners(tx, input.merchantId, input.sellerMerchantId, variant.product.categoryId);
      const existing = cart.items.find(line => line.variantId === variantId);
      if (existing) {
        if (existing.marketplace?.federatedProductId !== projection.id) throw new ConflictException("marketplace_cart_binding_invalid");
        await changeMarketplaceCartQuantity(tx, cart, existing, existing.quantity + input.quantity);
        return { lineItemId: existing.marketplace.lineItemId };
      }
      if (cart.items.length >= 100) throw new BadRequestException("cart_item_limit");
      const split = commissions.calculate({ itemPriceCents: variant.price.basePriceInCents, quantity: input.quantity, commissionRateBps: sellerConfig.commissionRateBps });
      if (split.totalCents > 2_147_483_647) throw new BadRequestException("cart_total_invalid");
      const id = `mli_${randomUUID()}`;
      let stockReservationId: string | undefined;
      if (!["digital", "service"].includes(variant.product.type)) {
        const stock = variant.stock.find(row => Number.isSafeInteger(row.quantity) && row.quantity >= 0
          && Number.isSafeInteger(row.reserved) && row.reserved >= 0 && row.quantity - row.reserved >= input.quantity);
        if (!stock) throw new ConflictException("marketplace_insufficient_stock");
        const result = await tx.productStock.updateMany({ where: { id: stock.id, reserved: stock.reserved, quantity: { gte: stock.reserved + input.quantity } }, data: { reserved: { increment: input.quantity } } });
        if (result.count !== 1) throw new ConflictException("marketplace_insufficient_stock");
        const reservation = await tx.stockReservation.create({ data: { variantId, stockId: stock.id, cartId: id, quantity: input.quantity, expiresAt: new Date(Date.now() + 30 * 60_000) } });
        stockReservationId = reservation.id;
      }
      await tx.crossStoreLineItem.create({ data: { id, hostMerchantId: input.merchantId, checkoutSessionId: input.checkoutSessionId,
        sellerMerchantId: input.sellerMerchantId, federatedProductId: projection.id, sourceVariantId: variantId, stockReservationId,
        quantity: input.quantity, unitPriceCents: variant.price.basePriceInCents, commissionRateBps: sellerConfig.commissionRateBps,
        commissionCents: split.commissionCents, sellerNetCents: split.sellerNetCents,
        termsJson: { returnWindowDays: config.returnWindowDays, payoutDelayDays: config.payoutDelayDays,
          chargebackWindowDays: config.chargebackWindowDays, providerFeePolicy: MARKETPLACE_PROVIDER_FEE_POLICY } } });
      const optionLabel = marketplaceVariantAttributesLabel(variant.attributes) || (variant.product._count.variants > 1 ? marketplaceVariantLabel(variant.attributes, variant.sku) : "");
      cart.items.push({ variantId, productId: variant.productId, categoryId: variant.product.categoryId ?? undefined,
        name: optionLabel ? `${variant.product.name} — ${optionLabel}` : variant.product.name,
        sku: variant.sku, quantity: input.quantity, unitPriceCents: variant.price.basePriceInCents,
        imageUrl: variant.media[0]?.url, marketplace: { lineItemId: id, sellerMerchantId: input.sellerMerchantId, sellerName, federatedProductId: projection.id } });
      assertMarketplaceDiscount(cart, cart.discount, cart.freeShipping);
      return { lineItemId: id };
    });
  }
}
