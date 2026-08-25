import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_REPOSITORY, type InventoryRepositoryPort, type InventoryItemRow, type InventoryListFilter, type InventorySummary } from "../../domain/ports/inventory-repository.port.js";
import { computeStockStatus } from "../../domain/values/stock-status.js";

@Injectable()
export class PrismaInventoryRepository implements InventoryRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async list(filter: InventoryListFilter): Promise<{ items: InventoryItemRow[]; total: number }> {
    const skip = ((filter.page ?? 1) - 1) * (filter.pageSize ?? 20);
    const take = filter.pageSize ?? 20;

    const whereClause: Record<string, any> = { merchantId: filter.merchantId };
    if (filter.locationId) whereClause.locationId = filter.locationId;
    if (filter.search) {
      whereClause.OR = [
        { sku: { contains: filter.search, mode: "insensitive" as any } },
        { productName: { contains: filter.search, mode: "insensitive" as any } },
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
        salePriceCents: (item as any).salePriceCents ?? null,
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
        salePriceCents: (item as any).salePriceCents ?? null,
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
        salePriceCents: (item as any).salePriceCents ?? null,
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
        salePriceCents: (item as any).salePriceCents ?? null,
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
      salePriceCents: (updated as any).salePriceCents ?? null,
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
      salePriceCents: (updated as any).salePriceCents ?? null,
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
      const price = (item as any).salePriceCents ?? item.avgCostCents ?? 0;
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
        salePriceCents: (item as any).salePriceCents ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }
}
