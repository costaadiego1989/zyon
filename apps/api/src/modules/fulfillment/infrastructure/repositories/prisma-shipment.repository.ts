import type { PrismaClient } from "@prisma/client";
import {
  ShipmentEntity,
  type ShipmentSnapshot,
  type ShipmentStatus,
} from "../../domain/entities/shipment.entity.js";
import type { ShipmentRepository } from "../../domain/ports/shipment-repository.port.js";

export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(shipment: ShipmentEntity): Promise<void> {
    const snapshot = shipment.snapshot();
    await this.prisma.shipment.upsert({
      where: { id: snapshot.id },
      create: {
        id: snapshot.id,
        merchantId: snapshot.merchant_id,
        // sessionId is a schema legacy field; use order_id as best proxy.
        sessionId: snapshot.order_id,
        externalOrderId: snapshot.order_id,
        carrier: snapshot.carrier_key,
        trackingCode: persistedTrackingCode(snapshot),
        trackingUrl: snapshot.label_url,
        status: snapshot.status,
        createdAt: new Date(snapshot.created_at),
        updatedAt: new Date(snapshot.updated_at),
        estimatedEta: toDate(snapshot.estimated_eta),
        deliveredAt: toDate(snapshot.delivered_at),
      },
      update: {
        carrier: snapshot.carrier_key,
        trackingCode: persistedTrackingCode(snapshot),
        trackingUrl: snapshot.label_url,
        status: snapshot.status,
        updatedAt: new Date(snapshot.updated_at),
        estimatedEta: toDate(snapshot.estimated_eta),
        deliveredAt: toDate(snapshot.delivered_at),
      },
    });
  }

  async findById(
    id: string,
    merchantId: string,
  ): Promise<ShipmentEntity | null> {
    const row = await this.prisma.shipment.findFirst({
      where: { id, merchantId },
    });
    return row ? ShipmentEntity.rehydrate(toSnapshot(row)) : null;
  }

  async findByOrderId(
    orderId: string,
    merchantId: string,
  ): Promise<ShipmentEntity | null> {
    const row = await this.prisma.shipment.findFirst({
      where: { externalOrderId: orderId, merchantId },
    });
    return row ? ShipmentEntity.rehydrate(toSnapshot(row)) : null;
  }

  // P2 fix: scoped by merchantId to enforce tenant boundary invariant.
  async findByTrackingCode(
    trackingCode: string,
    merchantId: string,
  ): Promise<ShipmentEntity | null> {
    if (!trackingCode || trackingCode.startsWith("pending:")) return null;
    const row = await this.prisma.shipment.findFirst({
      where: { trackingCode, merchantId },
    });
    return row ? ShipmentEntity.rehydrate(toSnapshot(row)) : null;
  }
}

type ShipmentRow = {
  id: string;
  merchantId: string;
  externalOrderId: string;
  carrier: string;
  trackingCode: string;
  trackingUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  estimatedEta: Date | null;
  deliveredAt: Date | null;
};

function toSnapshot(row: ShipmentRow): ShipmentSnapshot {
  return {
    id: row.id,
    merchant_id: row.merchantId,
    order_id: row.externalOrderId,
    carrier_key: row.carrier,
    tracking_code: row.trackingCode.startsWith("pending:")
      ? null
      : row.trackingCode,
    status: row.status as ShipmentStatus,
    label_url: row.trackingUrl,
    // P3 deferred: dispatched_at column not present in schema.prisma (frozen).
    // Cannot persist dispatched_at until schema migration is unblocked.
    dispatched_at: null,
    delivered_at: row.deliveredAt?.toISOString() ?? null,
    estimated_eta: row.estimatedEta?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function persistedTrackingCode(snapshot: ShipmentSnapshot): string {
  return snapshot.tracking_code ?? `pending:${snapshot.id}`;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}
