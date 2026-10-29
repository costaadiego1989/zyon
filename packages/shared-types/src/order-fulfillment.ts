export type FulfillmentProductType = "physical" | "digital" | "service" | "food";
export type FulfillmentStrategy = "carrier" | "pickup" | "local_delivery" | "digital" | "scheduled_service" | "service";
export type FulfillmentStage = "awaiting_payment" | "not_started" | "in_progress" | "partial" | "completed" | "cancelled" | "review";
export interface FulfillmentSchedule {
  slotId: string; startsAt: string; endsAt: string; timeZone: string; durationMinutes: number;
}
export interface OrderFulfillmentUnit {
  id: string; lineId: string; sku: string; variantId: string; name: string;
  productType: FulfillmentProductType; strategy: FulfillmentStrategy;
  quantity: number; completedQuantity: number; status: string;
  selectedOptions: Array<{ group_name: string; item_name: string; price_modifier: number }>;
  schedule?: FulfillmentSchedule; requiredChannels?: string[];
  attention?: string; shipmentId?: string;
}
export interface FulfillmentAllowedAction {
  action: string; label: string; targetStatus: string; targetStage: FulfillmentStage;
  requiresProof: boolean;
}
export interface OrderFulfillmentSummary {
  schemaVersion: 1; version: number; stage: FulfillmentStage; completedQuantity: number;
  totalQuantity: number; units: Array<OrderFulfillmentUnit & { allowedActions: FulfillmentAllowedAction[]; blockedReason?: string }>;
}
