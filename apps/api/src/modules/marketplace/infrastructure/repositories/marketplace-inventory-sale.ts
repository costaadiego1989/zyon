import type { CrossStoreLineItem, Prisma, PrismaClient } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import type { FrozenMarketplaceFunding } from "../../domain/services/marketplace-funding-budget.js";
import { PrismaInventorySaleRepository, type MarketplaceInventoryCommit } from "../../../inventory/infrastructure/repositories/prisma-inventory-sale.repository.js";
import type { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";

/** Variant locks are held by the caller. Explicit SQL scope permits checking the
 * seller allocation without borrowing the host's tenant identity. */
export async function assertMarketplaceInventoryStock(tx: Prisma.TransactionClient, merchantId: string,
  variantId: string, quantity: number, additionalReservation = 0) {
  const stocks = await tx.$queryRaw<Array<{ id: string; sku: string; quantity: number; reserved: number }>>`
    SELECT s.id, v.sku, s.quantity, s.reserved FROM product_stock s
    JOIN product_variants v ON v.id = s.variant_id JOIN products p ON p.id = v.product_id
    WHERE v.id = ${variantId} AND p.merchant_id = ${merchantId} ORDER BY s.id FOR UPDATE OF s`;
  if (stocks.length !== 1) throw new ConflictException("marketplace_inventory_catalog_stock_ambiguous");
  const stock = stocks[0]!;
  const locations = await tx.$queryRaw<Array<{ id: string; is_default: boolean }>>`
    SELECT id, is_default FROM inventory_locations WHERE merchant_id = ${merchantId} AND is_active = true ORDER BY id`;
  if (locations.length !== 1 || !locations[0]!.is_default) throw new ConflictException("marketplace_inventory_location_missing_or_ambiguous");
  const rows = await tx.$queryRaw<Array<{ id: string; quantity: number; reserved: number }>>`
    SELECT id, quantity, reserved FROM inventory_items WHERE merchant_id = ${merchantId}
      AND sku = ${stock.sku} AND location_id = ${locations[0]!.id} FOR UPDATE`;
  if (rows.length !== 1) throw new ConflictException("marketplace_inventory_item_missing");
  const row = rows[0]!;
  if (row.quantity !== stock.quantity || row.reserved < 0 || stock.reserved < 0 ||
      row.quantity - row.reserved < Math.max(quantity, stock.reserved + additionalReservation)) {
    throw new ConflictException("marketplace_inventory_catalog_balance_mismatch");
  }
  return { stockId: stock.id, sku: stock.sku };
}

/** Canonical participant receipts share the reservation/settlement transaction. */
export async function commitMarketplaceInventory(tx: Prisma.TransactionClient, items: CrossStoreLineItem[],
  instructions: FrozenMarketplaceFunding | undefined, paymentIntentId: string | undefined, orderId: string, purchasedAt: Date,
  tenantContext?: TenantContextService) {
  const payment = paymentIntentId ? await tx.paymentIntent.findUnique({ where: { id: paymentIntentId } }) : null;
  const checkout = payment && instructions && payment.merchantId === instructions.hostMerchantId
    ? await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: payment.merchantId, sessionId: payment.sessionId } } }) : null;
  const customer = checkout?.customer as { email?: unknown; fullName?: unknown; phone?: unknown } | null;
  const buyer = { ...(typeof customer?.email === "string" ? { buyerEmail: customer.email } : {}),
    ...(typeof customer?.fullName === "string" ? { buyerName: customer.fullName } : {}),
    ...(typeof customer?.phone === "string" ? { buyerPhone: customer.phone } : {}) };
  const allocations = new Map<string, { items: Array<{ sku: string; variantId: string; quantity: number }>; totalCents: number;
    commit: MarketplaceInventoryCommit }>();
  const add = async (merchantId: string, variantId: string, sku: string, quantity: number, totalCents: number, reservationId?: string) => {
    let allocation = allocations.get(merchantId);
    if (!allocation) { allocation = { items: [], totalCents: 0, commit: { consumedStocks: new Map(), nonStockVariants: new Set() } }; allocations.set(merchantId, allocation); }
    allocation.items.push({ sku, variantId, quantity }); allocation.totalCents += totalCents;
    if (reservationId) {
      const reservation = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.status !== "CONFIRMED" || reservation.variantId !== variantId || reservation.quantity !== quantity || !reservation.stockId) {
        throw new ConflictException("marketplace_inventory_reservation_not_confirmed");
      }
      if (allocation.commit.consumedStocks.has(variantId)) throw new ConflictException("marketplace_inventory_variant_ambiguous");
      allocation.commit.consumedStocks.set(variantId, { stockId: reservation.stockId, quantity });
    } else allocation.commit.nonStockVariants.add(variantId);
  };
  for (const item of items) {
    if (!item.sourceVariantId) throw new ConflictException("marketplace_inventory_variant_missing");
    const variants = await tx.$queryRaw<Array<{ sku: string; type: string }>>`
      SELECT v.sku, p.type FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = ${item.sourceVariantId} AND p.merchant_id = ${item.sellerMerchantId}`;
    if (variants.length !== 1 || (!item.stockReservationId && !["digital", "service"].includes(variants[0]!.type))) {
      throw new ConflictException("marketplace_inventory_variant_mismatch");
    }
    await add(item.sellerMerchantId, item.sourceVariantId, variants[0]!.sku, item.quantity,
      item.quantity * item.unitPriceCents, item.stockReservationId ?? undefined);
  }
  if (instructions) {
    const reservations = await tx.stockReservation.findMany({ where: { marketplaceFundingPlanId: paymentIntentId } });
    for (const item of instructions.hostStockItems ?? []) {
      const line = instructions.lines.find(line => line.lineItemId === item.lineItemId);
      if (!line) throw new ConflictException("marketplace_host_stock_identity_mismatch");
      const hold = reservations.find(row => row.cartId === item.lineItemId);
      if (item.requiresStock && !hold) throw new ConflictException("marketplace_host_stock_binding_missing");
      await add(instructions.hostMerchantId, item.variantId, item.sku, item.quantity, line.grossAmountCents, hold?.id);
    }
  }
  for (const [merchantId, allocation] of [...allocations].sort(([a], [b]) => a.localeCompare(b))) {
    const execute = () => new PrismaInventorySaleRepository(tx as PrismaClient).applyInTransaction(tx, {
      merchantId, orderId, items: allocation.items, totalCents: allocation.totalCents, timestamp: purchasedAt.toISOString(), ...buyer,
    }, allocation.commit);
    if (tenantContext) await tenantContext.run({ merchantId, userId: "marketplace-order", role: "system" }, execute);
    else await execute();
  }
}
