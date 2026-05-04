import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, completeOrderRequest } from "../../__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "./complete-order.use-case.js";
import type { PurchaseHistoryPort, RecordCheckoutPurchaseInput } from "../../domain/ports/purchase-history.port.js";

class RecordingPurchaseHistoryPort implements PurchaseHistoryPort {
  public records: RecordCheckoutPurchaseInput[] = [];

  async recordCheckoutPurchase(input: RecordCheckoutPurchaseInput): Promise<void> {
    this.records.push(input);
  }
}

test("CompleteOrderUseCase records order completion idempotently and emits once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  const useCase = new CompleteOrderUseCase(repository);

  const first = await useCase.execute(completeOrderRequest());
  const second = await useCase.execute(completeOrderRequest());

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(repository.listOutbox("mrc_1").filter((event) => event.event_type === "order.completed").length, 1);
});

test("CompleteOrderUseCase records completed checkout into buyer purchase history once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      cart: {
        currency: "BRL",
        total: 200,
        currentDiscount: 20,
        items: [{ sku: "sku_1", name: "Running Shoe", price: 200, quantity: 1 }]
      }
    })
  );
  const purchaseHistory = new RecordingPurchaseHistoryPort();
  const useCase = new CompleteOrderUseCase(repository, purchaseHistory);

  await useCase.execute(completeOrderRequest({ order_total: 180, accepted_offer_id: "offer_1" }));
  await useCase.execute(completeOrderRequest({ order_total: 180, accepted_offer_id: "offer_1" }));

  assert.equal(purchaseHistory.records.length, 1);
  assert.equal(purchaseHistory.records[0]?.merchantId, "mrc_1");
  assert.equal(purchaseHistory.records[0]?.globalUserId, "usr_1");
  assert.equal(purchaseHistory.records[0]?.discountAmount, 20);
  assert.deepEqual(purchaseHistory.records[0]?.items.map((item) => item.title), ["Running Shoe"]);
});
