import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_ALERT_REPOSITORY, type InventoryAlertRepositoryPort, type AlertRow } from "../../domain/ports/inventory-alert-repository.port.js";

@Injectable()
export class PrismaInventoryAlertRepository implements InventoryAlertRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    merchantId: string;
    itemId: string;
    severity: string;
    message: string;
  }): Promise<AlertRow> {
    const alert = await this.prisma.inventoryAlert.create({
      data: {
        merchantId: data.merchantId,
        itemId: data.itemId,
        severity: data.severity,
        message: data.message,
      },
      include: { item: true },
    });

    return {
      id: alert.id,
      merchantId: alert.merchantId,
      itemId: alert.itemId,
      sku: alert.item.sku,
      productName: alert.item.productName,
      severity: alert.severity,
      message: alert.message,
      acknowledged: alert.acknowledged,
      createdAt: alert.createdAt,
      acknowledgedAt: alert.acknowledgedAt,
    };
  }

  async list(merchantId: string, acknowledged?: boolean): Promise<AlertRow[]> {
    const where: Record<string, any> = { merchantId };
    if (acknowledged !== undefined) where.acknowledged = acknowledged;

    const alerts = await this.prisma.inventoryAlert.findMany({
      where,
      include: { item: true },
      orderBy: { createdAt: "desc" },
    });

    return alerts.map((a) => ({
      id: a.id,
      merchantId: a.merchantId,
      itemId: a.itemId,
      sku: a.item.sku,
      productName: a.item.productName,
      severity: a.severity,
      message: a.message,
      acknowledged: a.acknowledged,
      createdAt: a.createdAt,
      acknowledgedAt: a.acknowledgedAt,
    }));
  }

  async acknowledge(merchantId: string, alertId: string): Promise<void> {
    await this.prisma.inventoryAlert.update({
      where: { id: alertId },
      data: { acknowledged: true, acknowledgedAt: new Date() },
    });
  }

  async existsOpen(merchantId: string, itemId: string, severity: string): Promise<boolean> {
    const count = await this.prisma.inventoryAlert.count({
      where: { merchantId, itemId, severity, acknowledged: false },
    });
    return count > 0;
  }
}
