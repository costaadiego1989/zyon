import { Injectable } from "@nestjs/common";
import { ShipmentEntity } from "../../domain/entities/shipment.entity.js";
import type { ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";

@Injectable()
export class InMemoryShipmentRepository implements ShipmentRepository {
  private readonly store = new Map<string, ShipmentEntity>();

  async save(shipment: ShipmentEntity): Promise<void> {
    this.store.set(shipment.id, shipment);
  }

  async findById(id: string, merchantId: string): Promise<ShipmentEntity | null> {
    const s = this.store.get(id);
    if (!s || s.merchant_id !== merchantId) return null;
    return s;
  }

  async findByOrderId(orderId: string, merchantId: string): Promise<ShipmentEntity | null> {
    for (const s of this.store.values()) {
      if (s.snapshot().order_id === orderId && s.merchant_id === merchantId) return s;
    }
    return null;
  }

  async listByMerchant(input: {
    merchantId: string;
    limit: number;
    cursor?: string;
    orderId?: string;
    status?: string;
  }) {
    const items = Array.from(this.store.values())
      .filter((s) => s.merchant_id === input.merchantId)
      .filter((s) => !input.orderId || s.snapshot().order_id === input.orderId)
      .filter((s) => !input.status || s.snapshot().status === input.status)
      .sort(
        (a, b) =>
          new Date(b.snapshot().created_at).getTime() -
          new Date(a.snapshot().created_at).getTime(),
      );

    const start = 0;
    const data = items.slice(start, start + input.limit);
    const hasMore = items.length > start + input.limit;

    return {
      data,
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              id: data[data.length - 1].id,
              createdAt: data[data.length - 1].snapshot().created_at,
            }),
          ).toString("base64")
        : null,
    };
  }

  // P2 fix: scoped by merchantId to enforce tenant boundary invariant.
  async findByTrackingCode(trackingCode: string, merchantId: string): Promise<ShipmentEntity | null> {
    for (const s of this.store.values()) {
      if (s.snapshot().tracking_code === trackingCode && s.merchant_id === merchantId) return s;
    }
    return null;
  }
}

