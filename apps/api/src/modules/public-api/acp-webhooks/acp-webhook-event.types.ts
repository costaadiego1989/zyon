export const ACP_ORDER_EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.fulfilled",
] as const;

export type AcpOrderEventType = (typeof ACP_ORDER_EVENT_TYPES)[number];

export type AcpOrderStatus =
  | "created"
  | "paid"
  | "shipped"
  | "delivered"
  | "canceled";

export type AcpFulfillmentStatus = "pending" | "shipped" | "delivered";

export interface AcpLineItem {
  id: string;
  quantity: number;
}

export interface AcpBuyer {
  email?: string;
}

export interface AcpOrderEventData {
  order_id: string;
  status: AcpOrderStatus;
  amount_cents: number;
  currency: string;
  line_items: AcpLineItem[];
  confirmation_url?: string;
  buyer?: AcpBuyer;
  fulfillment_status: AcpFulfillmentStatus;
}

export interface AcpOrderEventEnvelope {
  id: string;
  type: AcpOrderEventType;
  created_at: string;
  merchant_id: string;
  data: AcpOrderEventData;
}

export interface AcpWebhookSubscriptionPublic {
  subscription_id: string;
  url: string;
  events: AcpOrderEventType[];
  created_at: string;
}

export interface AcpWebhookSubscriptionCreated extends AcpWebhookSubscriptionPublic {
  secret: string;
}

export function isAcpOrderEventType(value: unknown): value is AcpOrderEventType {
  return (
    typeof value === "string" &&
    (ACP_ORDER_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function isAcpOrderStatus(value: unknown): value is AcpOrderStatus {
  return (
    typeof value === "string" &&
    ["created", "paid", "shipped", "delivered", "canceled"].includes(value)
  );
}

export function isAcpFulfillmentStatus(
  value: unknown,
): value is AcpFulfillmentStatus {
  return (
    typeof value === "string" &&
    ["pending", "shipped", "delivered"].includes(value)
  );
}
