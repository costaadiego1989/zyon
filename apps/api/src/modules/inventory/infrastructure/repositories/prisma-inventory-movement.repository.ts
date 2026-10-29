import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_MOVEMENT_REPOSITORY, type InventoryMovementRepositoryPort, type MovementRow, type MovementListFilter } from "../../domain/ports/inventory-movement-repository.port.js";

@Injectable()
export class PrismaInventoryMovementRepository implements InventoryMovementRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async record(data: {
    merchantId: string;
    itemId: string;
    kind: string;
    quantity: number;
    reason?: string;
    externalRef?: string;
    source?: string;
    actorUserId?: string;
  }): Promise<MovementRow> {
    const movement = await this.prisma.inventoryMovement.create({
      data: {
        merchantId: data.merchantId,
        itemId: data.itemId,
        kind: data.kind as any,
        quantity: data.quantity,
        reason: data.reason,
        externalRef: data.externalRef,
        source: data.source ?? "native",
        actorUserId: data.actorUserId,
      },
      include: { item: true },
    });

    return {
      id: movement.id,
      merchantId: movement.merchantId,
      itemId: movement.itemId,
      sku: movement.item.sku,
      productName: movement.item.productName,
      kind: movement.kind,
      quantity: movement.quantity,
      reason: movement.reason,
      externalRef: movement.externalRef,
      source: movement.source,
      actorUserId: movement.actorUserId,
      createdAt: movement.createdAt,
    };
  }

  async list(filter: MovementListFilter): Promise<{ movements: MovementRow[]; total: number }> {
    const skip = ((filter.page ?? 1) - 1) * (filter.pageSize ?? 20);
    const take = filter.pageSize ?? 20;

    const whereClause: Record<string, any> = { merchantId: filter.merchantId };
    if (filter.itemId) whereClause.itemId = filter.itemId;
    if (filter.kind) whereClause.kind = filter.kind;
    if (filter.from || filter.to) {
      whereClause.createdAt = {};
      if (filter.from) whereClause.createdAt.gte = filter.from;
      if (filter.to) whereClause.createdAt.lte = filter.to;
    }

    const movements = await this.prisma.inventoryMovement.findMany({
      where: whereClause,
      include: { item: true },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    const total = await this.prisma.inventoryMovement.count({ where: whereClause });

    return {
      movements: movements.map((m) => ({
        id: m.id,
        merchantId: m.merchantId,
        itemId: m.itemId,
        sku: m.item.sku,
        productName: m.item.productName,
        kind: m.kind,
        quantity: m.quantity,
        reason: m.reason,
        externalRef: m.externalRef,
        source: m.source,
        actorUserId: m.actorUserId,
        createdAt: m.createdAt,
      })),
      total,
    };
  }
}
