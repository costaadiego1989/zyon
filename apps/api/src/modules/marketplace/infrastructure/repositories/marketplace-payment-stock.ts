import { assertMarketplaceProductOptions } from "../../domain/services/marketplace-product-options.js";
import { assertMarketplaceInventoryStock } from "./marketplace-inventory-sale.js";
import { ConflictException } from "@nestjs/common";
import type { CrossStoreLineItem, Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import type { FrozenMarketplaceFunding } from "../../domain/services/marketplace-funding-budget.js";

/** The funding plan and these bindings commit before any provider charge. */
export async function bindMarketplacePaymentStock(tx: Prisma.TransactionClient, paymentIntentId: string, items: CrossStoreLineItem[],
  instructions: FrozenMarketplaceFunding, cart: Cart) {
  const own = cart.items.filter(item => !item.marketplace), frozen = instructions.hostStockItems ?? [];
  if (frozen.length !== own.length || new Set(frozen.map(row => row.variantId)).size !== frozen.length ||
      frozen.some(row => !own.some(item => row.lineItemId === `host:${item.sku}` && row.variantId === item.variantId &&
        row.sku === item.sku && row.quantity === item.quantity && Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 99))) {
    throw new ConflictException("marketplace_host_stock_identity_mismatch");
  }
  for (const merchantId of [...new Set([instructions.hostMerchantId, ...items.map(item => item.sellerMerchantId)])].sort()) {
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  }
  for (const variantId of [...new Set([...items.flatMap(item => item.sourceVariantId ? [item.sourceVariantId] : []),
    ...frozen.map(item => item.variantId)])].sort()) {
    await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`;
  }
  for (const item of frozen) {
    const variant = await tx.productVariant.findFirst({ where: { id: item.variantId, product: { merchantId: instructions.hostMerchantId } }, include: { product: true } });
    if (!variant || !variant.isActive || !variant.product.isActive || variant.product.deletedAt || variant.sku !== item.sku ||
        item.requiresStock !== !["digital", "service"].includes(variant.product.type)) throw new ConflictException("marketplace_payment_variant_unavailable");
    assertMarketplaceProductOptions(variant.product.metadata, own.find(line => line.variantId === item.variantId)?.selected_options);
    if (!item.requiresStock) continue;
    const stocks = await tx.productStock.findMany({ where: { variantId: item.variantId }, orderBy: { id: "asc" } });
    const stock = stocks.find(row => row.quantity - row.reserved >= item.quantity);
    if (!stock) throw new ConflictException("marketplace_insufficient_host_stock");
    await assertMarketplaceInventoryStock(tx, instructions.hostMerchantId, item.variantId, item.quantity, item.quantity);
    const changed = await tx.productStock.updateMany({ where: { id: stock.id, reserved: stock.reserved, quantity: { gte: stock.reserved + item.quantity } },
      data: { reserved: { increment: item.quantity } } });
    if (changed.count !== 1) throw new ConflictException("marketplace_insufficient_host_stock");
    await tx.stockReservation.create({ data: { variantId: variant.id, stockId: stock.id, cartId: item.lineItemId,
      quantity: item.quantity, expiresAt: new Date(Date.now() + 30 * 60_000), marketplaceFundingPlanId: paymentIntentId } });
  }
  for (const item of items) {
    const variant = item.sourceVariantId ? await tx.productVariant.findUnique({ where: { id: item.sourceVariantId },
      include: { product: true } }) : null;
    if (!variant || variant.product.merchantId !== item.sellerMerchantId || !variant.isActive ||
        !variant.product.isActive || variant.product.deletedAt) throw new ConflictException("marketplace_payment_variant_unavailable");
    assertMarketplaceProductOptions(variant.product.metadata, cart.items.find(line => line.marketplace?.lineItemId === item.id)?.selected_options);
    if (!item.stockReservationId) {
      if (!["digital", "service"].includes(variant.product.type)) throw new ConflictException("marketplace_reservation_required");
      continue;
    }
    const reservation = await tx.stockReservation.findUnique({ where: { id: item.stockReservationId } });
    if (!reservation || reservation.cartId !== item.id || reservation.variantId !== variant.id ||
        reservation.quantity !== item.quantity || !reservation.stockId) throw new ConflictException("marketplace_reservation_binding_invalid");
    if (reservation.marketplaceFundingPlanId) throw new ConflictException("marketplace_reservation_payment_already_bound");
    if (reservation.status !== "ACTIVE" || reservation.expiresAt <= new Date()) throw new ConflictException("marketplace_reservation_expired");
    const stock = await tx.productStock.findUnique({ where: { id: reservation.stockId } });
    if (!stock || stock.variantId !== variant.id || stock.reserved < item.quantity || stock.quantity < stock.reserved) {
      throw new ConflictException("marketplace_reservation_stock_invalid");
    }
    await assertMarketplaceInventoryStock(tx, item.sellerMerchantId, variant.id, item.quantity);
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { marketplaceFundingPlanId: paymentIntentId } });
  }
}

/** Caller holds the cart lock and locks every seller and host variant in one order. */
export async function consumeMarketplaceHostStock(tx: Prisma.TransactionClient, paymentIntentId: string, instructions: FrozenMarketplaceFunding) {
  const ownLines = instructions.lines.filter(line => line.sellerMerchantId === instructions.hostMerchantId);
  const frozen = instructions.hostStockItems ?? [];
  if (ownLines.length !== frozen.length || frozen.some(item => !ownLines.some(line => line.lineItemId === item.lineItemId))) {
    throw new ConflictException("marketplace_host_stock_identity_mismatch");
  }
  const reservations = await tx.stockReservation.findMany({ where: { marketplaceFundingPlanId: paymentIntentId,
    cartId: { in: frozen.map(item => item.lineItemId) } } });
  if (reservations.length !== frozen.filter(item => item.requiresStock).length) throw new ConflictException("marketplace_host_stock_binding_missing");
  for (const item of frozen.filter(row => row.requiresStock)) {
    const matches = reservations.filter(row => row.cartId === item.lineItemId);
    const reservation = matches[0];
    if (matches.length !== 1 || reservation.variantId !== item.variantId || reservation.quantity !== item.quantity || !reservation.stockId) {
      throw new ConflictException("marketplace_reservation_binding_invalid");
    }
    if (reservation.status === "CONFIRMED") continue;
    if (reservation.status !== "ACTIVE") throw new ConflictException("marketplace_paid_stock_reconciliation_required");
    const stock = await tx.productStock.updateMany({ where: { id: reservation.stockId, variantId: item.variantId,
      reserved: { gte: item.quantity }, quantity: { gte: item.quantity } },
      data: { reserved: { decrement: item.quantity }, quantity: { decrement: item.quantity } } });
    if (stock.count !== 1) throw new ConflictException("marketplace_paid_stock_reconciliation_required");
    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED" } });
  }
}

/** A delayed approval may consume held stock only for its original full payment. */
export async function assertMarketplaceStockPayment(tx: Prisma.TransactionClient, paymentIntentId: string, host: string, cart: string, providerPaymentId: string,
  completedDelivery = false) {
  const plan = await tx.marketplaceFundingPlan.findUnique({ where: { paymentIntentId }, include: { payment: true } });
  const paidStatus = plan?.payment.status === "approved" || (completedDelivery &&
    ["refunded", "chargeback_pending", "chargeback_won", "chargeback_lost"].includes(plan?.payment.status ?? ""));
  if (!plan || plan.hostMerchantId !== host || plan.checkoutSessionId !== cart || plan.payment.providerPaymentId !== providerPaymentId ||
      !paidStatus || plan.payment.approvedAmountCents !== plan.amountCents) {
    throw new ConflictException("marketplace_reservation_payment_mismatch");
  }
}
