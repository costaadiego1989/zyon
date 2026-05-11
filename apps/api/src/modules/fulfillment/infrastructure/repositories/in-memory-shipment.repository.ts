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

  async findByTrackingCode(trackingCode: string): Promise<ShipmentEntity | null> {
    for (const s of this.store.values()) {
      if (s.snapshot().tracking_code === trackingCode) return s;
    }
    return null;
  }
}
