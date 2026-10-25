import type { ShipmentStatus } from "../../../domain/integrations.types.js";

const ALLOWED_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "pending",
  "label_generated",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled"
];

export function normalizeShipmentStatus(value: string | undefined, fallback: ShipmentStatus): ShipmentStatus {
  return ALLOWED_SHIPMENT_STATUSES.includes(value as ShipmentStatus) ? value as ShipmentStatus : fallback;
}

export function parseIsoDateOrNow(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
