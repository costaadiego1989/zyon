import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  CustomerDetail,
  CustomerSummary,
  OperationsCursor,
  OperationsReadRepository,
  OrderDetail,
  OrderSummary,
  OrderTimelineEntry,
  PaymentSummary,
} from "../domain/ports/operations-read.repository.port.js";

export class PrismaOperationsReadRepository
  implements OperationsReadRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async listOrders(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<OrderSummary[]> {
    const rows = await this.prisma.completedOrder.findMany({
      where: {
        merchantId: input.merchantId,
        ...cursorWhere("completedAt", input.cursor),
      },
      include: {
        session: { select: { customer: true, cart: true } },
      },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return rows.map(toOrderSummary);
  }

  async getOrder(
    merchantId: string,
    orderId: string,
  ): Promise<OrderDetail | undefined> {
    const row = await this.prisma.completedOrder.findFirst({
      where: { id: orderId, merchantId },
      include: {
        session: {
          select: {
            customer: true,
            cart: true,
            events: { orderBy: { occurredAt: "asc" } },
          },
        },
      },
    });
    if (!row) return undefined;

    const [payments, shipment] = await Promise.all([
      this.prisma.paymentIntent.findMany({
        where: { merchantId, sessionId: row.sessionId },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.shipment.findFirst({
        where: { merchantId, externalOrderId: row.externalOrderId },
        include: { trackingEvents: { orderBy: { occurredAt: "asc" } } },
      }),
    ]);

    const timeline: OrderTimelineEntry[] = [
      ...row.session.events.map((event) => ({
        id: event.id,
        type: "checkout",
        status: event.eventName,
        occurredAt: event.occurredAt.toISOString(),
      })),
      ...payments.flatMap((payment) =>
        paymentHistory(payment.id, payment.statusHistory),
      ),
      ...(shipment?.trackingEvents ?? []).map((event) => ({
        id: event.id,
        type: "tracking",
        status: event.status,
        description: event.description,
        occurredAt: event.occurredAt.toISOString(),
        data: {
          location: event.location,
          tracking_code: event.trackingCode,
        },
      })),
      {
        id: `completed:${row.id}`,
        type: "order",
        status: "approved",
        occurredAt: row.completedAt.toISOString(),
      },
      ...(row.cancelledAt
        ? [
            {
              id: `cancelled:${row.id}`,
              type: "order",
              status: "cancelled",
              description: row.cancellationReason ?? undefined,
              occurredAt: row.cancelledAt.toISOString(),
            },
          ]
        : []),
    ].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
    const commercePayment = [...payments]
      .reverse()
      .find((payment) => Boolean(payment.commerceOrderId));

    return {
      ...toOrderSummary(row),
      timeline,
      commerceOrderId: commercePayment?.commerceOrderId ?? undefined,
      paymentStatus: commercePayment?.status,
    };
  }

  async listCustomers(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<CustomerSummary[]> {
    const cursorAt = input.cursor
      ? new Date(input.cursor.occurredAt)
      : undefined;
    const cursorFilter =
      cursorAt && input.cursor
        ? Prisma.sql`AND (
            "updated_at" < ${cursorAt}
            OR ("updated_at" = ${cursorAt} AND "global_user_id" < ${input.cursor.id})
          )`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON ("global_user_id")
          "global_user_id",
          "customer",
          "created_at",
          "updated_at"
        FROM "checkout_sessions"
        WHERE "merchant_id" = ${input.merchantId}
        ORDER BY "global_user_id", "updated_at" DESC
      ) AS "latest_customers"
      WHERE TRUE
      ${cursorFilter}
      ORDER BY "updated_at" DESC, "global_user_id" DESC
      LIMIT ${input.limit}
    `);
    return rows.map(toCustomerSummary);
  }

  async getCustomer(
    merchantId: string,
    customerId: string,
  ): Promise<CustomerDetail | undefined> {
    const session = await this.prisma.checkoutSession.findFirst({
      where: { merchantId, globalUserId: customerId },
      orderBy: { updatedAt: "desc" },
    });
    if (!session) return undefined;
    const [first, purchases] = await Promise.all([
      this.prisma.checkoutSession.findFirst({
        where: { merchantId, globalUserId: customerId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      this.prisma.buyerPurchaseRecord.findMany({
        where: { merchantId, globalUserId: customerId },
        orderBy: { completedAt: "desc" },
        take: 100,
      }),
    ]);
    return {
      id: customerId,
      profile: sanitizeCustomer(session.customer),
      firstSeenAt: (first?.createdAt ?? session.createdAt).toISOString(),
      lastSeenAt: session.updatedAt.toISOString(),
      purchaseHistory: purchases.map((purchase) => ({
        orderId: purchase.orderId,
        currency: purchase.currency,
        totalMinor: toMinor(purchase.totalAmount),
        discountMinor: toMinor(purchase.discountAmount),
        items: purchase.items,
        completedAt: purchase.completedAt.toISOString(),
      })),
    };
  }

  async listPayments(input: {
    merchantId: string;
    limit: number;
    cursor?: OperationsCursor;
  }): Promise<PaymentSummary[]> {
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        merchantId: input.merchantId,
        ...cursorWhere("updatedAt", input.cursor),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return rows.map(toPaymentSummary);
  }

  async getPayment(
    merchantId: string,
    paymentId: string,
  ): Promise<PaymentSummary | undefined> {
    const row = await this.prisma.paymentIntent.findFirst({
      where: { id: paymentId, merchantId },
    });
    return row ? toPaymentSummary(row) : undefined;
  }
}

type CustomerRow = {
  global_user_id: string;
  customer: unknown;
  created_at: Date;
  updated_at: Date;
};

function cursorWhere(
  field: "completedAt" | "updatedAt",
  cursor?: OperationsCursor,
): Record<string, unknown> {
  if (!cursor) return {};
  const occurredAt = new Date(cursor.occurredAt);
  return {
    OR: [
      { [field]: { lt: occurredAt } },
      { [field]: occurredAt, id: { lt: cursor.id } },
    ],
  };
}

function toOrderSummary(row: {
  id: string;
  sessionId: string;
  externalOrderId: string;
  orderTotal: number;
  currency: string;
  status: string;
  acceptedOfferId: string | null;
  trackingCode: string | null;
  completedAt: Date;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  session: { customer: unknown; cart: unknown };
}): OrderSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    externalOrderId: row.externalOrderId,
    status: row.status === "cancelled" ? "cancelled" : "approved",
    totalMinor: toMinor(row.orderTotal),
    currency: row.currency,
    acceptedOfferId: row.acceptedOfferId ?? undefined,
    trackingCode: row.trackingCode ?? undefined,
    customer: sanitizeCustomer(row.session.customer),
    cart: normalizeObject(row.session.cart),
    completedAt: row.completedAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString(),
    cancellationReason: row.cancellationReason ?? undefined,
  };
}

function toCustomerSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.global_user_id,
    profile: sanitizeCustomer(row.customer),
    firstSeenAt: row.created_at.toISOString(),
    lastSeenAt: row.updated_at.toISOString(),
  };
}

function toPaymentSummary(row: {
  id: string;
  sessionId: string;
  amountCents: number;
  approvedAmountCents: number | null;
  currency: string;
  method: string;
  status: string;
  providerPaymentId: string | null;
  commerceOrderId: string | null;
  statusHistory: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PaymentSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    amountMinor: row.amountCents,
    approvedAmountMinor: row.approvedAmountCents ?? undefined,
    currency: row.currency,
    method: row.method,
    status: row.status,
    providerReference: row.providerPaymentId ?? undefined,
    commerceOrderId: row.commerceOrderId ?? undefined,
    statusHistory: Array.isArray(row.statusHistory) ? row.statusHistory : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function paymentHistory(
  paymentId: string,
  value: unknown,
): OrderTimelineEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.status !== "string" ||
      typeof record.occurredAt !== "string"
    ) {
      return [];
    }
    return [{
      id: `${paymentId}:${index}`,
      type: "payment",
      status: record.status,
      description:
        typeof record.reason === "string" ? record.reason : undefined,
      occurredAt: record.occurredAt,
    }];
  });
}

function sanitizeCustomer(value: unknown): Record<string, unknown> {
  const customer = normalizeObject(value);
  const allowed = [
    "externalCustomerId",
    "email",
    "email_verified",
    "recognized_buyer",
    "phone",
    "phone_verified",
    "address_verified",
    "isReturning",
    "fullName",
    "address",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => customer[key] !== undefined)
      .map((key) => [toSnakeCase(key), customer[key]]),
  );
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toMinor(value: number): number {
  return Math.round(value * 100);
}
