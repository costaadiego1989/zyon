import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetOrderUseCase,
  ListOrdersUseCase,
} from "./operations-read.use-cases.js";
import type {
  OperationsReadRepository,
  OrderDetail,
  OrderSummary,
} from "../domain/ports/operations-read.repository.port.js";

describe("operational read models", () => {
  it("paginates orders with opaque cursors", async () => {
    const repository = new StubOperationsRepository();
    const list = new ListOrdersUseCase(repository);

    const first = await list.execute({ merchantId: "mrc_a", limit: 1 });
    assert.equal(first.data[0]?.id, "ord_2");
    assert.ok(first.nextCursor);

    const second = await list.execute({
      merchantId: "mrc_a",
      limit: 1,
      cursor: first.nextCursor!,
    });
    assert.equal(second.data[0]?.id, "ord_1");
  });

  it("does not expose orders from another tenant", async () => {
    const get = new GetOrderUseCase(new StubOperationsRepository());
    await assert.rejects(
      get.execute("mrc_b", "ord_1"),
      /order_not_found/,
    );
  });
});

class StubOperationsRepository implements OperationsReadRepository {
  private readonly orders: OrderDetail[] = [
    order("ord_2", "2026-06-15T12:00:02.000Z"),
    order("ord_1", "2026-06-15T12:00:01.000Z"),
  ];

  async listOrders(input: {
    merchantId: string;
    limit: number;
    cursor?: { occurredAt: string; id: string };
  }): Promise<OrderSummary[]> {
    if (input.merchantId !== "mrc_a") return [];
    return this.orders
      .filter(
        (row) =>
          !input.cursor ||
          row.completedAt < input.cursor.occurredAt ||
          (row.completedAt === input.cursor.occurredAt &&
            row.id < input.cursor.id),
      )
      .slice(0, input.limit);
  }

  async getOrder(merchantId: string, orderId: string) {
    return merchantId === "mrc_a"
      ? this.orders.find((row) => row.id === orderId)
      : undefined;
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

function order(id: string, completedAt: string): OrderDetail {
  return {
    id,
    sessionId: `session_${id}`,
    externalOrderId: `external_${id}`,
    status: "approved",
    totalMinor: 29990,
    currency: "BRL",
    customer: null,
    cart: {},
    completedAt,
    timeline: [],
  };
}
