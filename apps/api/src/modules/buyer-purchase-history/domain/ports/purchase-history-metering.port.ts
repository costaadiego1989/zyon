export const PURCHASE_HISTORY_METERING_PORT = Symbol("PURCHASE_HISTORY_METERING_PORT");

export type PurchaseHistoryMeteringEventType =
  | "purchase_history.imported_order"
  | "purchase_history.context_used"
  | "negotiation.history_enriched";

export interface PurchaseHistoryMeteringEvent {
  eventType: PurchaseHistoryMeteringEventType;
  merchantId: string;
  globalUserId?: string;
  merchantCustomerId?: string;
  units: number;
  metadata?: Record<string, unknown>;
}

export interface PurchaseHistoryMeteringPort {
  record(event: PurchaseHistoryMeteringEvent): Promise<void>;
}
