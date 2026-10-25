import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { extractOptionGroups } from "../../../storefront/domain/food-options.js";
import { serviceScheduleFromMetadata } from "../../../catalog/domain/services/service-schedule.js";

export interface MetaCatalogOrder { catalog_id: string; product_items: Array<{ product_retailer_id: string; quantity: number; item_price?: string; currency?: string }> }

@Injectable()
export class MetaCatalogOrderAdapter {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async resolve(merchantId: string, catalogId: string | undefined, order: MetaCatalogOrder) {
    if (!catalogId || catalogId !== order.catalog_id || !Array.isArray(order.product_items) || !order.product_items.length || order.product_items.length > 30) return undefined;
    const lines: Array<{ variantId: string; quantity: number }> = [];
    for (const item of order.product_items) {
      if (typeof item.product_retailer_id !== "string" || item.product_retailer_id.length > 200 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) return undefined;
      const variants = await this.prisma.productVariant.findMany({ where: { isActive: true, product: { merchantId, isActive: true },
        OR: [{ sku: item.product_retailer_id }, { id: item.product_retailer_id }] }, include: { product: true }, take: 2 });
      if (variants.length !== 1) return undefined;
      const variant = variants[0];
      if (extractOptionGroups(variant.product.metadata).some(g => g.required) || serviceScheduleFromMetadata(variant.product.metadata) !== undefined) return undefined;
      lines.push({ variantId: variant.id, quantity: item.quantity });
    }
    return lines;
  }
}
