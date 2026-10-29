import type { Prisma } from "@prisma/client";
import { computeStockStatus } from "../../domain/values/stock-status.js";

/** Called inside the stock writer transaction, or by the periodic monitor. */
export async function reconcileStockAlert(tx: Prisma.TransactionClient, merchantId: string, itemId: string, now = new Date()) {
  await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${itemId} AND merchant_id = ${merchantId} FOR UPDATE`;
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, merchantId } });
  if (!item) return null;
  const status = computeStockStatus(item.quantity, item.reserved, item.lowStockThreshold);
  const existing = await tx.inventoryAlert.findFirst({ where: { merchantId, itemId, resolvedAt: null } });
  if (status === "in_stock") {
    if (existing) {
      await tx.inventoryAlert.update({ where: { id: existing.id }, data: { resolvedAt: now, acknowledged: true, acknowledgedAt: existing.acknowledgedAt ?? now } });
      await tx.merchantNotification.updateMany({ where: { merchantId, type: "inventory_alert",
        metadata: { path: ["inventoryAlertId"], equals: existing.id } }, data: { read: true } });
    }
    return null;
  }
  const severity = status === "out_of_stock" ? "critical" : "warning";
  const available = item.quantity - item.reserved;
  const message = status === "out_of_stock" ? `Estoque esgotado: ${item.productName} (${item.sku})`
    : `Estoque baixo: ${item.productName}, ${available} unidades disponíveis (${item.sku})`;
  const escalated = existing?.severity === "warning" && severity === "critical";
  const alert = existing
    ? await tx.inventoryAlert.update({ where: { id: existing.id }, data: { severity, message,
        ...(escalated ? { acknowledged: false, acknowledgedAt: null } : {}) } })
    : await tx.inventoryAlert.create({ data: { merchantId, itemId, severity, message } });
  // Acknowledging an unresolved issue does not re-notify every polling cycle.
  if (!alert.acknowledged) {
    await tx.merchantNotification.upsert({
      where: { id: `stock:${alert.id}` }, update: { body: message, title: severity === "critical" ? "Produto sem estoque" : "Estoque abaixo do limite",
        ...(escalated ? { read: false } : {}) },
      create: { id: `stock:${alert.id}`, merchantId, type: "inventory_alert",
        title: severity === "critical" ? "Produto sem estoque" : "Estoque abaixo do limite", body: message,
        metadata: { inventoryAlertId: alert.id, itemId, sku: item.sku } },
    });
  }
  return alert;
}
