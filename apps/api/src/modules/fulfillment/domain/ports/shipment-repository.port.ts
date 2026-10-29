import type { ShipmentEntity } from "../entities/shipment.entity.js";

export const SHIPMENT_REPOSITORY = Symbol("SHIPMENT_REPOSITORY");

export type ListShipmentsInput = {
  merchantId: string;
  limit: number;
  cursor?: string;
  orderId?: string;
  status?: string;
};

export type ListShipmentsResult = {
  data: ShipmentEntity[];
  nextCursor: string | null;
};

export interface ShipmentRepository {
  save(shipment: ShipmentEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<ShipmentEntity | null>;
  findByOrderId(orderId: string, merchantId: string): Promise<ShipmentEntity | null>;
  listByMerchant(input: ListShipmentsInput): Promise<ListShipmentsResult>;
  /**
   * P2 fix: scoped by merchantId to enforce the tenant boundary invariant.
   * The tracking-code lookup is used by the webhook ingest path; merchantId
   * must be resolved from an authenticated context before calling this method.
   */
  findByTrackingCode(trackingCode: string, merchantId: string): Promise<ShipmentEntity | null>;
  /**
   * Resolves a carrier-owned label identifier after the carrier webhook has
   * already been authenticated. The carrier label id is globally assigned by
   * the provider, so this avoids trusting a tenant id supplied in its payload.
   */
  findByCarrierTrackingCode(carrierKey: string, trackingCode: string): Promise<ShipmentEntity | null>;
}
