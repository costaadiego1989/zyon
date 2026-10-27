import test from "node:test";
import assert from "node:assert/strict";
import { checkoutSession, completeOrderRequest } from "./checkout-test-fixtures.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import { UpdateOrderTrackingUseCase } from "../application/use-cases/update-order-tracking.use-case.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";

test("UpdateOrderTrackingUseCase attaches tracking after completion and notifies buyer once", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(
    checkoutSession({
      customer: { fullName: "Ana", phone: "11999998888" }
    })
  );
  await new CompleteOrderUseCase(repository, repository, repository).execute(completeOrderRequest());

  const useCase = new UpdateOrderTrackingUseCase(repository, repository, repository);
  const first = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    external_order_id: "ord_1",
    tracking_code: " BR123456789AA "
  });
  const second = await useCase.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    external_order_id: "ord_1",
    tracking_code: "BR123456789AA"
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(first.order.trackingCode, "BR123456789AA");
  assert.equal(repository.getCompletedOrder("mrc_1", "chk_1", "ord_1")?.trackingCode, "BR123456789AA");
  assert.equal(repository.listOutbox("mrc_1").filter((event) => event.event_type === "order.tracking.updated").length, 1);
  const whatsappEvents = repository
    .listOutbox("mrc_1")
    .filter((event) => event.event_type === "whatsapp.message.requested");
  assert.equal(whatsappEvents.length, 1);
  assert.equal(whatsappEvents[0]?.payload.tracking_code, "BR123456789AA");
});

test("UpdateOrderTrackingUseCase rejects empty tracking code", async () => {
  const repository = new InMemoryCheckoutRepository();
  repository.saveSession(checkoutSession());
  await new CompleteOrderUseCase(repository, repository, repository).execute(completeOrderRequest());

  await assert.rejects(
    () =>
      new UpdateOrderTrackingUseCase(repository, repository, repository).execute({
        merchant_id: "mrc_1",
        session_id: "chk_1",
        external_order_id: "ord_1",
        tracking_code: " "
      }),
    /tracking_code_required/
  );
});
