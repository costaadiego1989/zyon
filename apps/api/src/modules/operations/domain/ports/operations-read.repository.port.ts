export const OPERATIONS_READ_REPOSITORY = Symbol(
  "OPERATIONS_READ_REPOSITORY",
);

export interface OperationsCursor {
  occurredAt: string;
  id: string;
}

export interface OrderSummary {
  id: string;
  sessionId: string;
  externalOrderId: string;
  status: string;
  totalMinor: number;
  currency: string;
  acceptedOfferId?: string;
  trackingCode?: string;
  customer: Record<string, unknown> | null;
  cart: Record<string, unknown>;
  completedAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  /** Payment method used (pix, credit_card, boleto, crypto) */
  paymentMethod?: string;
  /** Payment provider (asaas, stripe, mercado_pago) */
  paymentProvider?: string;
  /** When the payment was confirmed */
  paidAt?: string;
  /** C1 fix: ISO timestamp of last event processed for this order */
  lastEventAt?: string;
}

export interface OrderTimelineEntry {
  id: string;
  type: string;
  status?: string;
  description?: string;
  occurredAt: string;
  data?: Record<string, unknown>;
}

export interface OrderDetail extends OrderSummary {
  timeline: OrderTimelineEntry[];
  commerceOrderId?: string;
  paymentStatus?: string;
}

export interface CustomerSummary {
  id: string;
  profile: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  purchaseHistory: Array<{
    orderId: string;
    currency: string;
    totalMinor: number;
    discountMinor: number;
    items: unknown;
    completedAt: string;
  }>;
}

export interface PaymentSummary {
  id: string;
  sessionId: string;
  amountMinor: number;
  approvedAmountMinor?: number;
  currency: string;
  method: string;
  status: string;
  providerReference?: string;
  commerceOrderId?: string;
  acceptedOfferId?: string;
  statusHistory: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface OperationsReadRepository {
  listOrders(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<OrderSummary[]>;
  getOrder(
    merchantId: string,
    orderId: string,
  ): Promise<OrderDetail | undefined>;
  getOrderByExternalId(
    merchantId: string,
    externalOrderId: string,
  ): Promise<OrderDetail | undefined>;
  listCustomers(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<CustomerSummary[]>;
  getCustomer(
    merchantId: string,
    customerId: string,
  ): Promise<CustomerDetail | undefined>;
  listPayments(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<PaymentSummary[]>;
  getPayment(
    merchantId: string,
    paymentId: string,
  ): Promise<PaymentSummary | undefined>;
}
