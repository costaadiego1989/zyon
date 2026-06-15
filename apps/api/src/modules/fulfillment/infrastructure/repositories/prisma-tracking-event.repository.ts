import type { Prisma, PrismaClient } from "@prisma/client";
import {
  TrackingEventEntity,
  type TrackingEventSnapshot,
} from "../../domain/entities/tracking-event.entity.js";
import type { TrackingEventRepository } from "../../domain/ports/tracking-event-repository.port.js";
import type { ShipmentStatus } from "../../domain/entities/shipment.entity.js";

export class PrismaTrackingEventRepository implements TrackingEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(event: TrackingEventEntity): Promise<void> {
    const snapshot = event.snapshot();
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: snapshot.shipment_id },
      select: {
        merchantId: true,
        trackingCode: true,
      },
    });
    if (!shipment) throw new Error("shipment_not_found_for_tracking_event");

    await this.prisma.trackingEvent.upsert({
      where: { id: snapshot.id },
      create: {
        id: snapshot.id,
        merchantId: shipment.merchantId,
        shipmentId: snapshot.shipment_id,
        trackingCode: shipment.trackingCode,
        status: snapshot.status,
        description: snapshot.description,
        location: snapshot.location,
        carrierRaw: snapshot.carrier_raw as Prisma.InputJsonValue,
        occurredAt: new Date(snapshot.occurred_at),
      },
      update: {},
    });
  }

  async findByShipment(
    shipmentId: string,
  ): Promise<TrackingEventEntity[]> {
    const rows = await this.prisma.trackingEvent.findMany({
      where: { shipmentId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map((row) =>
      TrackingEventEntity.rehydrate({
        id: row.id,
        shipment_id: row.shipmentId,
        status: row.status as ShipmentStatus,
        description: row.description,
        location: row.location,
        carrier_raw: asRecord(row.carrierRaw),
        occurred_at: row.occurredAt.toISOString(),
      }),
    );
  }
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
