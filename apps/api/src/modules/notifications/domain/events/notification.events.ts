export type NotificationEventType =
  | "ORDER_CONFIRMATION"
  | "ORDER_SHIPPED"
  | "ORDER_DELIVERED"
  | "RETURN_APPROVED"
  | "RETURN_RECEIVED";

export interface OrderConfirmationEvent {
  type: "ORDER_CONFIRMATION";
  merchantId: string;
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
  buyerPhone?: string;
  orderNumber: string;
  items: Array<{
    name: string;
    quantity: number;
    price: string;
  }>;
  total: string;
  currency?: string;
}

export interface OrderShippedEvent {
  type: "ORDER_SHIPPED";
  merchantId: string;
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
  buyerPhone?: string;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
}

export interface OrderDeliveredEvent {
  type: "ORDER_DELIVERED";
  merchantId: string;
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
  buyerPhone?: string;
}

export interface ReturnApprovedEvent {
  type: "RETURN_APPROVED";
  merchantId: string;
  returnId: string;
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
  refundAmount?: string;
  currency?: string;
}

export interface ReturnReceivedEvent {
  type: "RETURN_RECEIVED";
  merchantId: string;
  returnId: string;
  orderId: string;
  buyerEmail: string;
  buyerName?: string;
}

export type NotificationEvent =
  | OrderConfirmationEvent
  | OrderShippedEvent
  | OrderDeliveredEvent
  | ReturnApprovedEvent
  | ReturnReceivedEvent;
