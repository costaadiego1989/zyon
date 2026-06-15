import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommerceOrderPort } from "@aacp/commerce-adapters";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import type { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import type {
  OperationsReadRepository,
  OrderDetail,
} from "../domain/ports/operations-read.repository.port.js";
import { CancelOrderUseCase } from "./order-command.use-cases.js";

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

function completedOrderRepository() {
  const repository = new InMemoryCheckoutRepository();
  repository.saveCompletedOrder({
    merchantId: "mrc_a",
    sessionId: "session_1",
    externalOrderId: "external_1",
    orderTotal: 299.9,
    currency: "BRL",
    status: "approved",
    completedAt: "2026-06-15T12:00:00.000Z",
  });
  return repository;
}
