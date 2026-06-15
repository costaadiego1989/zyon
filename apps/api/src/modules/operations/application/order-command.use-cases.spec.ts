import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommerceOrderPort } from "@aacp/commerce-adapters";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import type { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import type {
  OperationsReadRepository,
  OrderDetail,
} from "../domain/ports/operations-read.repository.port.js";
import {
  CancelOrderUseCase,
  CreateOrderFromPaymentUseCase,
} from "./order-command.use-cases.js";

describe("CancelOrderUseCase", () => {
  it("cancels the provider order, persists status and emits a tenant webhook", async () => {
    const checkout = completedOrderRepository();
    const commerce = new FakeCommerceOrderPort();
    const published: Array<Record<string, unknown>> = [];
    const useCase = new CancelOrderUseCase(
      new StubOperationsRepository(),
      checkout,
      commerce,
      {
        publish: async (event: Record<string, unknown>) => {
          published.push(event);
          return [];
        },
      } as unknown as TenantWebhookPublisher,
    );

    const result = await useCase.execute({
      merchantId: "mrc_a",
      orderId: "ord_1",
      reason: "Customer requested cancellation",
      restock: true,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.provider_cancellation_requested, true);
    assert.equal(result.payment_action_required, "refund_separately");
    assert.equal(commerce.cancelled.length, 1);
    assert.equal(
      checkout.getCompletedOrder("mrc_a", "session_1", "external_1")
        ?.status,
      "cancelled",
    );
    assert.equal(published[0]?.eventType, "order.cancelled");
  });

  it("does not expose or mutate an order from another tenant", async () => {
    const checkout = completedOrderRepository();
    const commerce = new FakeCommerceOrderPort();
    const useCase = new CancelOrderUseCase(
      new StubOperationsRepository(),
      checkout,
      commerce,
      { publish: async () => [] } as unknown as TenantWebhookPublisher,
    );

    await assert.rejects(
      useCase.execute({
        merchantId: "mrc_b",
        orderId: "ord_1",
        reason: "Customer request",
      }),
      /order_not_found/,
    );
    assert.equal(commerce.cancelled.length, 0);
  });
});

describe("CreateOrderFromPaymentUseCase", () => {
  it("materializes an approved tenant payment and returns the same order idempotently", async () => {
    const checkout = completedOrderRepository(false);
    const readRepository = new PaymentBackedOperationsRepository(checkout);
    const useCase = new CreateOrderFromPaymentUseCase(
      readRepository,
      new CompleteOrderUseCase(checkout, checkout, checkout),
    );

    const first = await useCase.execute({
      merchantId: "mrc_a",
      paymentId: "pay_int_approved",
    });
    const second = await useCase.execute({
      merchantId: "mrc_a",
      paymentId: "pay_int_approved",
    });

    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(first.order.externalOrderId, "pay_provider_1");
    assert.equal(first.order.totalMinor, 29_990);
  });

  it("rejects a payment that is not approved", async () => {
    const checkout = completedOrderRepository(false);
    const readRepository = new PaymentBackedOperationsRepository(
      checkout,
      "requires_action",
    );
    const useCase = new CreateOrderFromPaymentUseCase(
      readRepository,
      new CompleteOrderUseCase(checkout, checkout, checkout),
    );

    await assert.rejects(
      useCase.execute({
        merchantId: "mrc_a",
        paymentId: "pay_int_approved",
      }),
      /payment_not_approved/,
    );
  });
});

class FakeCommerceOrderPort implements CommerceOrderPort {
  readonly cancelled: Array<Record<string, unknown>> = [];

  async createPendingOrder() {
    return { commerceOrderId: "draft_1" };
  }

  async markOrderPaid() {}

  async cancelOrder(input: {
    merchantId: string;
    commerceOrderId: string;
    reason: string;
    notifyCustomer?: boolean;
    restock?: boolean;
  }) {
    this.cancelled.push(input);
  }
}

class StubOperationsRepository implements OperationsReadRepository {
  async getOrder(
    merchantId: string,
    orderId: string,
  ): Promise<OrderDetail | undefined> {
    if (merchantId !== "mrc_a" || orderId !== "ord_1") return undefined;
    return {
      id: "ord_1",
      sessionId: "session_1",
      externalOrderId: "external_1",
      status: "approved",
      totalMinor: 29_990,
      currency: "BRL",
      customer: null,
      cart: {},
      completedAt: "2026-06-15T12:00:00.000Z",
      commerceOrderId: "draft_1",
      paymentStatus: "approved",
      timeline: [],
    };
  }

  async getOrderByExternalId() {
    return undefined;
  }

  async listOrders() {
    return [];
  }

  async listCustomers() {
    return [];
  }

  async getCustomer() {
    return undefined;
  }

  async listPayments() {
    return [];
  }

  async getPayment() {
    return undefined;
  }
}

class PaymentBackedOperationsRepository
  implements OperationsReadRepository
{
  constructor(
    private readonly checkout: InMemoryCheckoutRepository,
    private readonly paymentStatus = "approved",
  ) {}

  async getPayment(merchantId: string, paymentId: string) {
    if (
      merchantId !== "mrc_a" ||
      paymentId !== "pay_int_approved"
    ) {
      return undefined;
    }
    return {
      id: paymentId,
      sessionId: "session_1",
      amountMinor: 29_990,
      approvedAmountMinor: 29_990,
      currency: "BRL",
      method: "pix",
      status: this.paymentStatus,
      providerReference: "pay_provider_1",
      commerceOrderId: "draft_1",
      statusHistory: [],
      createdAt: "2026-06-15T12:00:00.000Z",
      updatedAt: "2026-06-15T12:01:00.000Z",
    };
  }

  async getOrderByExternalId(
    merchantId: string,
    externalOrderId: string,
  ): Promise<OrderDetail | undefined> {
    const order = this.checkout.findCompletedOrderByExternalOrderId(
      merchantId,
      externalOrderId,
    );
    return order
      ? {
          id: "ord_created",
          sessionId: order.sessionId,
          externalOrderId: order.externalOrderId,
          status: order.status ?? "approved",
          totalMinor: Math.round(order.orderTotal * 100),
          currency: order.currency,
          customer: null,
          cart: {},
          completedAt: order.completedAt,
          timeline: [],
        }
      : undefined;
  }

  async getOrder() {
    return undefined;
  }

  async listOrders() {
    return [];
  }

  async listCustomers() {
    return [];
  }

  async getCustomer() {
    return undefined;
  }

  async listPayments() {
    return [];
  }
}

function completedOrderRepository(withOrder = true) {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession({
    merchantId: "mrc_a",
    sessionId: "session_1",
    globalUserId: "usr_1",
    conversationId: "cnv_1",
    cart: {
      currency: "BRL",
      total: 299.9,
      items: [
        {
          sku: "sku_1",
          name: "Enterprise Kit",
          price: 299.9,
          quantity: 1,
        },
      ],
    },
    customer: {
      email: "buyer@example.com",
      fullName: "Buyer",
    },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-06-15T12:00:00.000Z",
  });
  if (withOrder) {
    repository.saveCompletedOrder({
      merchantId: "mrc_a",
      sessionId: "session_1",
      externalOrderId: "external_1",
      orderTotal: 299.9,
      currency: "BRL",
      status: "approved",
      completedAt: "2026-06-15T12:00:00.000Z",
    });
  }
  return repository;
}
