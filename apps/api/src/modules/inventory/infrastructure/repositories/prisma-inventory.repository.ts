import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient, InventoryMovementKind } from "@prisma/client";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort, type InventoryItemRow, type InventoryListFilter, type InventorySummary } from "../../domain/ports/inventory-repository.port.js";
import { computeStockStatus } from "../../domain/values/stock-status.js";
import { lockCatalogMerchant } from "../../../../shared/persistence/catalog-stock-ledger.js";
import { reconcileStockAlert } from "./reconcile-stock-alert.js";

@Injectable()
export class PrismaInventoryRepository implements InventoryRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async recordMovementAtomic(data: { merchantId: string; itemId: string; kind: string; quantity: number; reason?: string; externalRef?: string; source?: string; actorUserId?: string }, delta: number): Promise<InventoryItemRow> {
    return this.prisma.$transaction(async tx => {
      await lockCatalogMerchant(tx, data.merchantId);
      const initial = await tx.inventoryItem.findFirst({ where: { id: data.itemId, merchantId: data.merchantId }, select: { sku: true } });
      if (!initial) throw new NotFoundException("inventory_item_not_found");
      // Same lock order as catalog writers: merchant, variant, inventory item.
      await tx.$queryRaw`SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ${initial.sku} AND p.merchant_id = ${data.merchantId} ORDER BY v.id FOR UPDATE OF v`;
      await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${data.itemId} AND merchant_id = ${data.merchantId} FOR UPDATE`;
      const item = await tx.inventoryItem.findFirst({ where: { id: data.itemId, merchantId: data.merchantId }, include: { location: true } });
      if (!item) throw new NotFoundException("inventory_item_not_found");
      const quantity = item.quantity + delta;
      if (!Number.isSafeInteger(quantity) || quantity < item.reserved || quantity < 0 || quantity > 2_147_483_647) throw new ConflictException("stock_quantity_below_reserved");
      const variants = await tx.productVariant.findMany({ where: { sku: item.sku, product: { merchantId: data.merchantId, deletedAt: null } }, include: { stock: true, product: true } });
      if (variants.length > 1) throw new ConflictException("stock_sku_ambiguous");
      const variant = variants[0];
      if (variant && !["digital", "service"].includes(variant.product.type)) {
        const locations = await tx.inventoryLocation.findMany({ where: { merchantId: data.merchantId, isActive: true }, select: { id: true, isDefault: true }, take: 2 });
        if (locations.length !== 1 || !locations[0]?.isDefault || locations[0].id !== item.locationId) throw new ConflictException("stock_location_required");
        if (variant.stock.length !== 1) throw new ConflictException("stock_warehouse_required");
        if (quantity < variant.stock[0]!.reserved) throw new ConflictException("stock_quantity_below_reserved");
        const updated = await tx.productStock.updateMany({ where: { id: variant.stock[0]!.id, variantId: variant.id, reserved: { lte: quantity } }, data: { quantity } });
        if (updated.count !== 1) throw new ConflictException("stock_quantity_below_reserved");
      }
      const updated = await tx.inventoryItem.update({ where: { id: item.id, merchantId: data.merchantId }, data: { quantity }, include: { location: true } });
      await tx.inventoryMovement.create({ data: { ...data, kind: data.kind as InventoryMovementKind, quantity: data.kind === "ADJUSTMENT" ? delta : data.quantity } });
      await reconcileStockAlert(tx, data.merchantId, item.id);
      return { ...updated, locationName: updated.location.name, salePriceCents: updated.salePriceCents ?? null };
    });
  }

  async list(filter: InventoryListFilter): Promise<{ items: InventoryItemRow[]; total: number }> {
    const skip = ((filter.page ?? 1) - 1) * (filter.pageSize ?? 20);
    const take = filter.pageSize ?? 20;

    const whereClause: Record<string, any> = { merchantId: filter.merchantId };
    if (filter.locationId) whereClause.locationId = filter.locationId;
    if (filter.search) {
      whereClause.OR = [
        { sku: { contains: filter.search.trim(), mode: "insensitive" } },
        { productName: { contains: filter.search.trim(), mode: "insensitive" } },
      ];
    }

    const items = await this.prisma.inventoryItem.findMany({
      where: whereClause,
      include: { location: true },
      skip,
      take,
    });

    const total = await this.prisma.inventoryItem.count({ where: whereClause });

    const mapped = items
      .map((item) => ({
        id: item.id,
        merchantId: item.merchantId,
        sku: item.sku,
        productName: item.productName,
        variantName: item.variantName,
        locationId: item.locationId,
        locationName: item.location.name,
        quantity: item.quantity,
        reserved: item.reserved,
        reorderPoint: item.reorderPoint,
        lowStockThreshold: item.lowStockThreshold,
        avgCostCents: item.avgCostCents,
        salePriceCents: item.salePriceCents ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }))
      .filter((item) => {
        if (!filter.status) return true;
        const status = computeStockStatus(item.quantity, item.reserved, item.lowStockThreshold);
        return status === filter.status;
      });

    return { items: mapped, total };
  }

  async findById(merchantId: string, id: string): Promise<InventoryItemRow | null> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, merchantId },
      include: { location: true },
    });
    if (!item) return null;
    return {
      id: item.id,
      merchantId: item.merchantId,
      sku: item.sku,
      productName: item.productName,
      variantName: item.variantName,
      locationId: item.locationId,
      locationName: item.location.name,
      quantity: item.quantity,
      reserved: item.reserved,
      reorderPoint: item.reorderPoint,
      lowStockThreshold: item.lowStockThreshold,
      avgCostCents: item.avgCostCents,
        salePriceCents: item.salePriceCents ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async findBySku(merchantId: string, sku: string, locationId: string): Promise<InventoryItemRow | null> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { merchantId, sku, locationId },
      include: { location: true },
    });
    if (!item) return null;
    return {
      id: item.id,
      merchantId: item.merchantId,
      sku: item.sku,
      productName: item.productName,
      variantName: item.variantName,
      locationId: item.locationId,
      locationName: item.location.name,
      quantity: item.quantity,
      reserved: item.reserved,
      reorderPoint: item.reorderPoint,
      lowStockThreshold: item.lowStockThreshold,
      avgCostCents: item.avgCostCents,
        salePriceCents: item.salePriceCents ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async upsert(
    merchantId: string,
    data: {
      sku: string;
      productName: string;
      variantName?: string;
      locationId: string;
      quantity: number;
      avgCostCents?: number;
      salePriceCents?: number;
    },
  ): Promise<InventoryItemRow> {
    const item = await this.prisma.inventoryItem.upsert({
      where: { merchantId_sku_locationId: { merchantId, sku: data.sku, locationId: data.locationId } },
      update: { quantity: data.quantity, productName: data.productName, variantName: data.variantName, avgCostCents: data.avgCostCents, salePriceCents: data.salePriceCents },
      create: {
        merchantId,
        sku: data.sku,
        productName: data.productName,
        variantName: data.variantName,
        locationId: data.locationId,
        quantity: data.quantity,
        avgCostCents: data.avgCostCents,
        salePriceCents: data.salePriceCents,
      },
      include: { location: true },
    });
    return {
      id: item.id,
      merchantId: item.merchantId,
      sku: item.sku,
      productName: item.productName,
      variantName: item.variantName,
      locationId: item.locationId,
      locationName: item.location.name,
      quantity: item.quantity,
      reserved: item.reserved,
      reorderPoint: item.reorderPoint,
      lowStockThreshold: item.lowStockThreshold,
      avgCostCents: item.avgCostCents,
        salePriceCents: item.salePriceCents ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  async adjustQuantity(merchantId: string, itemId: string, delta: number): Promise<InventoryItemRow> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, merchantId },
      include: { location: true },
    });
    if (!item) throw new Error("Item not found");

    const updated = await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { quantity: { increment: delta } },
      include: { location: true },
    });

    return {
      id: updated.id,
      merchantId: updated.merchantId,
      sku: updated.sku,
      productName: updated.productName,
      variantName: updated.variantName,
      locationId: updated.locationId,
      locationName: updated.location.name,
      quantity: updated.quantity,
      reserved: updated.reserved,
      reorderPoint: updated.reorderPoint,
      lowStockThreshold: updated.lowStockThreshold,
      avgCostCents: updated.avgCostCents,
      salePriceCents: updated.salePriceCents ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async adjustReserved(merchantId: string, itemId: string, delta: number): Promise<InventoryItemRow> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, merchantId },
      include: { location: true },
    });
    if (!item) throw new Error("Item not found");

    const updated = await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { reserved: { increment: delta } },
      include: { location: true },
    });

    return {
      id: updated.id,
      merchantId: updated.merchantId,
      sku: updated.sku,
      productName: updated.productName,
      variantName: updated.variantName,
      locationId: updated.locationId,
      locationName: updated.location.name,
      quantity: updated.quantity,
      reserved: updated.reserved,
      reorderPoint: updated.reorderPoint,
      lowStockThreshold: updated.lowStockThreshold,
      avgCostCents: updated.avgCostCents,
      salePriceCents: updated.salePriceCents ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async setReorderPoint(merchantId: string, itemId: string, point: number): Promise<void> {
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { reorderPoint: point },
    });
  }

  async setLowStockThreshold(merchantId: string, itemId: string, threshold: number): Promise<void> {
    await this.prisma.inventoryItem.update({
      where: { id: itemId },
      data: { lowStockThreshold: threshold },
    });
  }

  async getSummary(merchantId: string): Promise<InventorySummary> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { merchantId },
    });

    const lowStockCount = items.filter((item) => {
      const available = item.quantity - item.reserved;
      return item.lowStockThreshold != null && available <= item.lowStockThreshold;
    }).length;

    const outOfStockCount = items.filter((item) => item.quantity - item.reserved <= 0).length;

    const totalValueCents = items.reduce((sum, item) => {
      const price = item.salePriceCents ?? item.avgCostCents ?? 0;
      return sum + price * item.quantity;
    }, 0);

    return {
      totalSkus: items.length,
      lowStockCount,
      outOfStockCount,
      totalValueCents,
    };
  }

  async findItemsBelowThreshold(merchantId: string): Promise<InventoryItemRow[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { merchantId },
      include: { location: true },
    });

    return items
      .filter((item) => {
        const available = item.quantity - item.reserved;
        return item.lowStockThreshold != null && available <= item.lowStockThreshold;
      })
      .map((item) => ({
        id: item.id,
        merchantId: item.merchantId,
        sku: item.sku,
        productName: item.productName,
        variantName: item.variantName,
        locationId: item.locationId,
        locationName: item.location.name,
        quantity: item.quantity,
        reserved: item.reserved,
        reorderPoint: item.reorderPoint,
        lowStockThreshold: item.lowStockThreshold,
        avgCostCents: item.avgCostCents,
        salePriceCents: item.salePriceCents ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }
}
