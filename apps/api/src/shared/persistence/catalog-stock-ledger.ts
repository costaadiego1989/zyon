import type { Prisma } from "@prisma/client";
import { reconcileStockAlert } from "../../modules/inventory/infrastructure/repositories/reconcile-stock-alert.js";

export async function lockCatalogMerchant(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  const merchants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
  if (merchants.length !== 1) throw new Error("inventory_merchant_not_found");
}

/** The caller holds the merchant lock before any variant/stock lock (as sales do). */
export async function syncCatalogStockLedger(
  tx: Prisma.TransactionClient,
  input: { merchantId: string; variantId: string; quantity?: number; source: string; externalRef?: string },
): Promise<void> {
  if (input.quantity !== undefined && (!Number.isSafeInteger(input.quantity) || input.quantity < 0 || input.quantity > 2_147_483_647)) {
    throw new Error("invalid_stock_quantity");
  }
  const variants = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE v.id = ${input.variantId} AND p.merchant_id = ${input.merchantId} FOR UPDATE OF v`;
  if (variants.length !== 1) throw new Error("variant_not_found");
  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId }, include: { product: true, price: true, stock: true },
  });
  if (!variant || variant.product.merchantId !== input.merchantId) throw new Error("variant_not_found");
  // Downloads and services have no physical warehouse, movement or low-stock alert.
  if (variant.product.type === "digital" || variant.product.type === "service") return;
  if (variant.stock.length !== 1) throw new Error("stock_warehouse_required");
  const stock = variant.stock[0]!;

  let locations = await tx.inventoryLocation.findMany({ where: { merchantId: input.merchantId, isActive: true }, take: 2 });
  if (!locations.length) {
    locations = [await tx.inventoryLocation.create({
      data: { merchantId: input.merchantId, name: "Estoque principal", kind: "warehouse", isDefault: true },
    })];
  }
  // There is no ProductStock -> InventoryLocation mapping yet. An implicit
  // quantity must never overwrite an arbitrary warehouse or an aggregate.
  if (locations.length !== 1 || !locations[0]!.isDefault) throw new Error("stock_location_required");
  const locationId = locations[0]!.id;
  const key = { merchantId: input.merchantId, sku: variant.sku, locationId };
  const items = await tx.$queryRaw<Array<{ id: string; quantity: number; reserved: number }>>`
    SELECT id, quantity, reserved FROM inventory_items WHERE merchant_id = ${input.merchantId}
      AND sku = ${variant.sku} AND location_id = ${locationId} FOR UPDATE`;
  const existing = items[0];
  const quantity = input.quantity ?? existing?.quantity ?? stock.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity < stock.reserved || quantity < (existing?.reserved ?? 0)) {
    throw new Error("stock_quantity_below_reserved");
  }
  const item = await tx.inventoryItem.upsert({
    where: { merchantId_sku_locationId: key },
    create: { ...key, productName: variant.product.name, quantity,
      avgCostCents: variant.price?.costInCents, salePriceCents: variant.price?.basePriceInCents },
    update: { productName: variant.product.name, quantity,
      avgCostCents: variant.price?.costInCents, salePriceCents: variant.price?.basePriceInCents },
  });
  const delta = quantity - (existing?.quantity ?? 0);
  if (delta !== 0) {
    await tx.inventoryMovement.create({ data: {
      merchantId: input.merchantId, itemId: item.id,
      kind: existing ? "ADJUSTMENT" : "ENTRY", quantity: delta,
      reason: existing ? "Atualização de saldo do catálogo" : "Cadastro de produto",
      source: input.source, externalRef: input.externalRef,
    } });
  }
  if (stock.quantity !== quantity) {
    const projected = await tx.productStock.updateMany({
      where: { id: stock.id, variantId: input.variantId, reserved: { lte: quantity } }, data: { quantity },
    });
    if (projected.count !== 1) throw new Error("stock_quantity_below_reserved");
  }
  await reconcileStockAlert(tx, input.merchantId, item.id);
}
