import type { ShipmentEntity } from "../entities/shipment.entity.js";

export const SHIPMENT_REPOSITORY = Symbol("SHIPMENT_REPOSITORY");

export interface ShipmentRepository {
  save(shipment: ShipmentEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ShipmentEntity | null>;
  findByOrderId(orderId: string, merchantId: string): Promise<ShipmentEntity | null>;
  /**
   * P2 fix: scoped by merchantId to enforce the tenant boundary invariant.
   * The tracking-code lookup is used by the webhook ingest path; merchantId
   * must be resolved from an authenticated context before calling this method.
   */
  findByTrackingCode(trackingCode: string, merchantId: string): Promise<ShipmentEntity | null>;
}
