import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { InventorySaleRepositoryPort } from "../../domain/ports/inventory-sale.repository.port.js";
import type { AppliedInventorySale, SaleCompletedEvent } from "../../domain/events/sale-completed.event.js";
import { inventorySaleFingerprint, inventorySaleId, validateInventorySale, validId } from "../../domain/events/inventory-sale.validation.js";

export const INVENTORY_SALE_JOBS = {
  erp: "inventory.sale.erp_sync_requested",
  crm: "inventory.sale.crm_sync_requested",
  webhook: "inventory.sale.webhook_requested",
} as const;

/** Inventory is an operational projection. This writer does not mutate catalog reservations. */
export class PrismaInventorySaleRepository implements InventorySaleRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async apply(raw: SaleCompletedEvent): Promise<AppliedInventorySale> {
    const event = validateInventorySale(raw);
    const receiptId = inventorySaleId(event.merchantId, event.orderId);
    const payloadHash = inventorySaleFingerprint(event);
    return this.prisma.$transaction(async tx => {
      // Merchant lock orders concurrent sales consistently; item row locks also serialize
      // with other inventory quantity writers. No lock crosses a provider request.
      const merchant = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${event.merchantId} FOR UPDATE`;
      if (!merchant.length) throw new Error("inventory_merchant_not_found");
      const existing = await tx.inventorySaleReceipt.findUnique({ where: { merchantId_orderId: { merchantId: event.merchantId, orderId: event.orderId } } });
      if (existing) {
        if (existing.payloadHash !== payloadHash) throw new Error("inventory_sale_idempotency_conflict");
        return this.toApplied(existing, true);
      }
      const items: AppliedInventorySale["items"] = [];
      const usedItemIds = new Set<string>();
      for (const line of event.items) {
        const locations = await tx.inventoryLocation.findMany({ where: { merchantId: event.merchantId, isActive: true,
          ...(line.locationId ? { id: line.locationId } : { isDefault: true }) }, select: { id: true }, take: 2 });
        if (locations.length !== 1) throw new Error("inventory_location_missing_or_ambiguous");
        const locationId = locations[0]!.id;
        const rows = await tx.$queryRaw<Array<{ id: string; quantity: number; reserved: number; low_stock_threshold: number | null }>>`
          SELECT i.id, i.quantity, i.reserved, i.low_stock_threshold FROM inventory_items i
          JOIN inventory_locations l ON l.id = i.location_id AND l.merchant_id = i.merchant_id
          WHERE i.merchant_id = ${event.merchantId} AND i.sku = ${line.sku} AND i.location_id = ${locationId}
          AND l.is_active = true FOR UPDATE OF i`;
        if (rows.length !== 1) throw new Error("inventory_item_not_found");
        const row = rows[0]!;
        // Two distinct variant/location representations resolving to one inventory row
        // are ambiguous: caller must aggregate into an authoritative SKU allocation.
        if (usedItemIds.has(row.id)) throw new Error("inventory_sale_duplicate_allocation");
        usedItemIds.add(row.id);
        if (row.quantity < 0 || row.reserved < 0 || row.quantity - row.reserved < line.quantity) throw new Error("inventory_insufficient_available_stock");
        const changed = await tx.inventoryItem.updateMany({ where: { id: row.id, merchantId: event.merchantId,
          locationId, quantity: row.quantity, reserved: row.reserved }, data: { quantity: { decrement: line.quantity } } });
        if (changed.count !== 1) throw new Error("inventory_stock_changed");
        await tx.inventoryMovement.create({ data: { merchantId: event.merchantId, itemId: row.id, kind: "EXIT", quantity: line.quantity,
          reason: "sale_completed", externalRef: event.orderId, source: "commerce" } });
        const remainingQuantity = row.quantity - line.quantity;
        if (row.low_stock_threshold !== null && remainingQuantity - row.reserved <= row.low_stock_threshold) {
          const existingAlert = await tx.inventoryAlert.findFirst({ where: { merchantId: event.merchantId, itemId: row.id, acknowledged: false } });
          if (!existingAlert) await tx.inventoryAlert.create({ data: { merchantId: event.merchantId, itemId: row.id,
            severity: remainingQuantity === row.reserved ? "critical" : "warning", message: `Low inventory after sale: ${remainingQuantity - row.reserved} units (${line.sku})` } });
        }
        items.push({ itemId: row.id, sku: line.sku, locationId, quantity: line.quantity, remainingQuantity });
      }
      const result = { stockDecrementedCount: items.length, items };
      await tx.inventorySaleReceipt.create({ data: { id: receiptId, merchantId: event.merchantId, orderId: event.orderId, payloadHash,
        payload: event as unknown as Prisma.InputJsonValue, result: result as unknown as Prisma.InputJsonValue } });
      for (const [kind, eventType] of Object.entries(INVENTORY_SALE_JOBS)) {
        await tx.outboxMessage.create({ data: { eventId: randomUUID(), eventType, schemaVersion: 1,
          merchantId: event.merchantId, occurredAt: new Date(event.timestamp), correlationId: receiptId, causationId: event.orderId,
          producer: "inventory", payload: { version: 1, receiptId, kind }, status: "pending" } });
      }
      return { receiptId, event, ...result, idempotent: false };
    });
  }

  async findReceipt(merchantId: string, receiptId: string): Promise<AppliedInventorySale | undefined> {
    if (!validId(merchantId) || !validId(receiptId)) throw new Error("inventory_receipt_identity_required");
    const receipt = await this.prisma.inventorySaleReceipt.findFirst({ where: { id: receiptId, merchantId } });
    return receipt ? this.toApplied(receipt, true) : undefined;
  }
  private toApplied(row: { id: string; payload: unknown; result: unknown }, idempotent: boolean): AppliedInventorySale {
    const event = validateInventorySale(row.payload as SaleCompletedEvent);
    const result = row.result as Pick<AppliedInventorySale, "stockDecrementedCount" | "items">;
    return { receiptId: row.id, event, ...result, idempotent };
  }
}
