import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

const MAX_PER_RUN = 50;

interface CartItemLike {
  sku?: string;
  name?: string;
  quantity?: number;
}

interface CartLike {
  items?: CartItemLike[];
}

@Injectable()
export class ScanConsumableReordersUseCase {
  private readonly logger = new Logger(ScanConsumableReordersUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient
  ) {}

  async execute(): Promise<{ processed: number; scheduled: number }> {
    const prisma = this.prisma as any;
    const now = new Date();

    // Build a map of consumable SKUs -> { productName, reorderCycleDays }
    const consumableMap = await this.loadConsumableSkus(prisma);
    if (consumableMap.size === 0) {
      return { processed: 0, scheduled: 0 };
    }

    // Fetch recent completed orders with their session cart
    const orders = await prisma.completedOrder.findMany({
      where: { status: "approved" },
      orderBy: { completedAt: "desc" },
      take: 500,
      include: { session: true },
    });

    let scheduled = 0;
    let processed = 0;

    for (const order of orders) {
      if (scheduled >= MAX_PER_RUN) break;
      const cart = (order.session?.cart ?? null) as CartLike | null;
      const items = cart?.items ?? [];

      for (const item of items) {
        if (scheduled >= MAX_PER_RUN) break;
        const sku = item.sku;
        if (!sku) continue;
        const consumable = consumableMap.get(sku);
        if (!consumable) continue;

        processed++;

        const dueDate = new Date(
          order.completedAt.getTime() + consumable.reorderCycleDays * 24 * 60 * 60 * 1000
        );
        if (dueDate > now) continue;

        // Skip if a reorder message already exists for this order + product
        const existing = await this.messages.findByOrderId(order.merchantId, order.externalOrderId);
        const alreadySent = existing.some(
          (m) => m.type === "reorder" && (m.metadata as any)?.sku === sku
        );
        if (alreadySent) continue;

        try {
          await this.messages.create({
            merchantId: order.merchantId,
            buyerId: order.session?.globalUserId ?? order.sessionId,
            orderId: order.externalOrderId,
            type: "reorder",
            channel: "whatsapp",
            sendAt: new Date(),
            productName: consumable.productName ?? item.name ?? undefined,
            metadata: {
              sku,
              reorderCycleDays: consumable.reorderCycleDays,
              orderCompletedAt: order.completedAt.toISOString(),
              reorderLink: `/reorder?sku=${encodeURIComponent(sku)}`,
            },
          });
          scheduled++;
        } catch (err) {
          this.logger.error(
            `reorder: failed for order ${order.externalOrderId} sku ${sku}`,
            { error: err instanceof Error ? err.message : String(err) }
          );
        }
      }
    }

    if (scheduled > 0) {
      this.logger.log(`consumable reorder scanner: scheduled ${scheduled} messages`);
    }

    return { processed, scheduled };
  }

  private async loadConsumableSkus(
    prisma: any
  ): Promise<Map<string, { productName: string | null; reorderCycleDays: number }>> {
    const map = new Map<string, { productName: string | null; reorderCycleDays: number }>();

    const products = await prisma.product.findMany({
      where: { isActive: true, metadata: { not: null } },
      include: { variants: { select: { sku: true } } },
    });

    for (const product of products) {
      const meta = (product.metadata ?? {}) as Record<string, unknown>;
      if (meta.consumable !== true) continue;
      const cycle = Number(meta.reorderCycleDays);
      if (!Number.isFinite(cycle) || cycle <= 0) continue;

      for (const variant of product.variants ?? []) {
        if (variant.sku) {
          map.set(variant.sku, { productName: product.name, reorderCycleDays: cycle });
        }
      }
    }

    return map;
  }
}
