import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { CompletedOrderStatus } from "@zyon/shared-types";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import {
  COMMERCE_ORDER_PORT,
  type CommerceOrderPort,
} from "../../commerce/domain/ports/commerce-order.port.js";
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from "../../checkout/domain/ports/order.repository.port.js";
import { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import {
  OPERATIONS_READ_REPOSITORY,
  type OperationsReadRepository,
} from "../domain/ports/operations-read.repository.port.js";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from "../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class CancelOrderUseCase {
  private readonly logger = new Logger(CancelOrderUseCase.name);

  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly readRepository: OperationsReadRepository,
    @Inject(ORDER_REPOSITORY)
    private readonly orders: OrderRepository,
    @Inject(COMMERCE_ORDER_PORT)
    private readonly commerce: CommerceOrderPort,
    private readonly webhooks: TenantWebhookPublisher,
  ) {}

  async execute(input: {
    merchantId: string;
    orderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }) {
    const merchantId = required(input.merchantId, "merchant_id");
    const orderId = required(input.orderId, "order_id");
    const reason = required(input.reason, "cancellation_reason").slice(0, 500);
    const order = await this.readRepository.getOrder(merchantId, orderId);
    if (!order) throw new NotFoundException("order_not_found");

    // C2 fix: idempotency guard — if already cancelled, return cached result
    if (order.status === "cancelled") {
      return cancellationResponse(order, true, false, null);
    }

    // P1 fix: commit the local status change FIRST so the system stays
    // consistent even if the provider call fails or the process crashes
    // between the two operations.
    const cancelledAt = new Date().toISOString();
    const cancelled = await this.orders.cancelCompletedOrder({
      merchantId,
      sessionId: order.sessionId,
      externalOrderId: order.externalOrderId,
      reason,
      cancelledAt,
    });
    if (!cancelled) throw new NotFoundException("order_not_found");

    // C2 fix: if another request already cancelled (race condition), return idempotently
    if (cancelled.idempotent) {
      return cancellationResponse(
        { ...order, status: "cancelled", cancelledAt: cancelled.order.cancelledAt, cancellationReason: cancelled.order.cancellationReason },
        true,
        false,
        null,
      );
    }

    // C3 fix: wrap provider call in try-catch; emit retry event on failure
    let providerCancellationRequested = false;
    let providerError: string | null = null;
    if (order.commerceOrderId) {
      if (!this.commerce.cancelOrder) {
        throw new BadRequestException(
          "commerce_order_cancellation_not_supported",
        );
      }
      try {
        await this.commerce.cancelOrder({
          merchantId,
          commerceOrderId: order.commerceOrderId,
          reason,
          notifyCustomer: input.notifyCustomer,
          restock: input.restock,
        });
        providerCancellationRequested = true;
      } catch (error) {
        // C3: do NOT throw — local cancellation is committed; publish retry event
        providerError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[CancelOrder] provider cancellation failed for order=${orderId}: ${providerError}`,
        );
        await this.webhooks.publish({
          merchantId,
          eventType: "order.cancellation_provider_failed",
          data: {
            order_id: orderId,
            external_order_id: order.externalOrderId,
            commerce_order_id: order.commerceOrderId,
            error: providerError,
          },
        });
      }
    }

    // M1 fix: emit audit-grade webhook for cancellation (who/why/when)
    await this.webhooks.publish({
      merchantId,
      eventType: "order.cancelled",
      occurredAt: cancelled.order.cancelledAt,
      data: {
        order: {
          id: order.id,
          external_order_id: order.externalOrderId,
          session_id: order.sessionId,
          status: "cancelled",
          cancellation_reason: reason,
          cancelled_at: cancelled.order.cancelledAt,
        },
      },
    });

    return cancellationResponse(
      {
        ...order,
        status: "cancelled",
        cancelledAt: cancelled.order.cancelledAt,
        cancellationReason: cancelled.order.cancellationReason,
      },
      false,
      providerCancellationRequested,
      providerError,
    );
  }
}

@Injectable()
export class UpdateOrderStatusUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly readRepository: OperationsReadRepository,
    @Inject(ORDER_REPOSITORY)
    private readonly orders: OrderRepository,
    private readonly webhooks: TenantWebhookPublisher,
    @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus: DomainEventBus,
  ) {}

  async execute(input: {
    merchantId: string;
    orderId: string;
    status: string;
  }) {
    const merchantId = required(input.merchantId, "merchant_id");
    const orderId = required(input.orderId, "order_id");
    const status = normalizeOrderStatus(input.status);
    const order = await this.readRepository.getOrder(merchantId, orderId);
    if (!order) throw new NotFoundException("order_not_found");

    if (!canTransitionOrderStatus(order.status, status)) {
      throw new BadRequestException("order_status_transition_invalid");
    }

    const updated = await this.orders.updateCompletedOrderStatus({
      merchantId,
      sessionId: order.sessionId,
      externalOrderId: order.externalOrderId,
      status,
    });
    if (!updated) throw new NotFoundException("order_not_found");

    const eventType = status === "cancelled" ? "order.cancelled" : "order.approved";
    await this.webhooks.publish({
      merchantId,
      eventType,
      data: {
        order: {
          id: order.id,
          external_order_id: order.externalOrderId,
          session_id: order.sessionId,
          status,
        },
      },
    });

    // Emit domain events for notification system (email via Resend, WhatsApp)
    const customerData = order.customer as { email?: string; full_name?: string; phone?: string } | null;
    const buyerEmail = customerData?.email ?? "";
    const buyerName = customerData?.full_name;
    const buyerPhone = customerData?.phone;

    if (status === "shipped") {
      await this.eventBus.publish({
        eventType: "order.shipped",
        merchantId,
        payload: {
          type: "ORDER_SHIPPED",
          merchantId,
          orderId: order.id,
          buyerEmail,
          buyerName,
          buyerPhone,
          trackingNumber: order.trackingCode,
        },
      });
    } else if (status === "delivered") {
      await this.eventBus.publish({
        eventType: "order.delivered",
        merchantId,
        payload: {
          type: "ORDER_DELIVERED",
          merchantId,
          orderId: order.id,
          buyerEmail,
          buyerName,
          buyerPhone,
        },
      });
    }

    return {
      id: order.id,
      external_order_id: order.externalOrderId,
      status,
      changed: order.status !== status,
    };
  }
}

@Injectable()
export class CreateOrderFromPaymentUseCase {
  constructor(
    @Inject(OPERATIONS_READ_REPOSITORY)
    private readonly readRepository: OperationsReadRepository,
    private readonly completeOrder: CompleteOrderUseCase,
  ) {}

  async execute(input: { merchantId: string; paymentId: string }) {
    const merchantId = required(input.merchantId, "merchant_id");
    const paymentId = required(input.paymentId, "payment_id");
    const payment = await this.readRepository.getPayment(
      merchantId,
      paymentId,
    );
    if (!payment) throw new NotFoundException("payment_not_found");
    if (payment.status !== "approved") {
      throw new ConflictException("payment_not_approved");
    }
    if (!payment.providerReference) {
      throw new ConflictException("payment_provider_reference_missing");
    }

    const existing = await this.readRepository.getOrderByExternalId(
      merchantId,
      payment.providerReference,
    );
    if (existing) return { order: existing, idempotent: true };

    const completion = await this.completeOrder.execute({
      merchant_id: merchantId,
      session_id: payment.sessionId,
      external_order_id: payment.providerReference,
      order_total:
        (payment.approvedAmountMinor ?? payment.amountMinor) / 100,
      currency: payment.currency as Parameters<
        CompleteOrderUseCase["execute"]
      >[0]["currency"],
      accepted_offer_id: payment.acceptedOfferId,
    });
    const order = await this.readRepository.getOrderByExternalId(
      merchantId,
      payment.providerReference,
    );
    if (!order) throw new NotFoundException("order_not_found_after_creation");
    return { order, idempotent: completion.idempotent };
  }
}

const ORDER_STATUS_TRANSITIONS: Record<CompletedOrderStatus, CompletedOrderStatus[]> = {
  pending: ["paid", "cancelled"],
  approved: ["paid", "shipped", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: [],
  cancelled: [],
  returned: [],
};

function canTransitionOrderStatus(from: string, to: CompletedOrderStatus): boolean {
  if (from === to) return true;
  const allowed = ORDER_STATUS_TRANSITIONS[from as CompletedOrderStatus];
  return allowed ? allowed.includes(to) : false;
}

function normalizeOrderStatus(value: string): CompletedOrderStatus {
  const status = required(value, "status") as CompletedOrderStatus;
  if (!Object.prototype.hasOwnProperty.call(ORDER_STATUS_TRANSITIONS, status)) {
    throw new BadRequestException("order_status_invalid");
  }
  return status;
}

function cancellationResponse(
  order: {
    id: string;
    externalOrderId: string;
    status: string;
    cancelledAt?: string;
    cancellationReason?: string;
    paymentStatus?: string;
  },
  idempotent: boolean,
  providerCancellationRequested: boolean,
  providerError: string | null,
) {
  return {
    id: order.id,
    external_order_id: order.externalOrderId,
    status: order.status,
    cancelled_at: order.cancelledAt ?? null,
    cancellation_reason: order.cancellationReason ?? null,
    idempotent,
    provider_cancellation_requested: providerCancellationRequested,
    provider_error: providerError ? { message: providerError } : null,
    payment_action_required:
      order.paymentStatus === "approved" ? "refund_separately" : null,
  };
}

function required(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${code}_required`);
  return normalized;
}
