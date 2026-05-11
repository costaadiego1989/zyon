import type { ShipmentEntity } from "../entities/shipment.entity.js";

export const SHIPMENT_REPOSITORY = Symbol("SHIPMENT_REPOSITORY");

export interface ShipmentRepository {
  save(shipment: ShipmentEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ShipmentEntity | null>;
  findByOrderId(orderId: string, merchantId: string): Promise<ShipmentEntity | null>;
  findByTrackingCode(trackingCode: string): Promise<ShipmentEntity | null>;
}
