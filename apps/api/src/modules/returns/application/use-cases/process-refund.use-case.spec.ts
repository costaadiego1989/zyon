import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessRefundUseCase } from "./process-refund.use-case.js";
import { ReturnEntity, type ReturnStatus } from "../../domain/entities/return.entity.js";
import type { RefundOrderPaymentResult } from "../../../payment/application/services/refund-payment.service.js";

function setup(
  status: ReturnStatus = "INSPECTED_PASS",
  refund: RefundOrderPaymentResult = { refunded: true, amountCents: 1_000, paymentIntentId: "pay_1", providerRefundId: "refund_1" },
) {
  let currentStatus = status;
  const entity = () => new ReturnEntity({ id: "r", merchantId: "merchant-b", orderId: "o", buyerId: "buyer", status: currentStatus,
    reason: "DEFECTIVE", createdAt: new Date(), updatedAt: new Date(), items: [{ id: "i", returnId: "r", variantId: "v", quantity: 3 }] });
  const calls = {
    statuses: [] as Array<[string, string]>,
    started: [] as Array<{ returnId: string; paymentIntentId?: string; status: string; amountInCents: number }>,
    saved: [] as Array<{ returnId: string; paymentIntentId?: string; status: string; amountInCents: number }>,
    completed: [] as string[],
    providerRequests: 0,
  };
  const repo = {
    findById: async (merchantId: string, id: string) => merchantId === "merchant-b" && id === "r" ? entity() : null,
    updateStatus: async (returnId: string, nextStatus: ReturnStatus) => {
      calls.statuses.push([returnId, nextStatus]);
      currentStatus = nextStatus;
    },
    beginRefund: async (input: { returnId: string; paymentIntentId?: string; status: string; amountInCents: number }) => {
      calls.started.push(input);
      return true;
    },
    saveRefund: async (input: { returnId: string; paymentIntentId?: string; status: string; amountInCents: number }) => {
      calls.saved.push(input);
      return { id: "refund", ...input, createdAt: new Date() };
    },
    updateRefundStatus: async (returnId: string) => { calls.completed.push(returnId); },
  };
  const refundPayment = { refundOrderPayment: async () => { calls.providerRequests += 1; return refund; } };
  return { useCase: new ProcessRefundUseCase(repo as any, refundPayment as any), calls };
}

describe("Returns refund settlement", () => {
  it("leaves a pending provider refund processing and does not claim completion", async () => {
    const { useCase, calls } = setup("INSPECTED_PASS", {
      refunded: false, amountCents: 1_000, paymentIntentId: "pay_pending", providerRefundId: "refund_pending", reason: "provider_refund_pending",
    });

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_PROCESSING");
    assert.deepEqual(calls.saved, [{ returnId: "r", paymentIntentId: "pay_pending", status: "PENDING", amountInCents: 1_000 }]);
    assert.deepEqual(calls.completed, []);
    assert.deepEqual(calls.statuses, [["r", "REFUND_PROCESSING"]]);
  });

  it("marks a return completed only after a succeeded provider refund", async () => {
    const { useCase, calls } = setup();

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_COMPLETED");
    assert.deepEqual(calls.saved, [{ returnId: "r", paymentIntentId: "pay_1", status: "COMPLETED", amountInCents: 1_000 }]);
    assert.deepEqual(calls.completed, ["r"]);
    assert.deepEqual(calls.statuses, [["r", "REFUND_PROCESSING"], ["r", "REFUND_COMPLETED"]]);
  });
  it("does not issue a second provider refund when another request holds the durable attempt", async () => {
    const { useCase, calls } = setup("REFUND_PROCESSING");
    (useCase as any).returnRepo.beginRefund = async () => false;

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_PROCESSING");
    assert.equal(calls.providerRequests, 0);
    assert.deepEqual(calls.saved, []);
  });
  it("does not reveal another merchant's return", async () => {
    const { useCase } = setup();
    await assert.rejects(useCase.execute("merchant-a", "r"), (error: any) => error.getStatus() === 404);
  });
  it("still rejects returns that are not eligible for a refund", async () => {
    const { useCase } = setup("REQUESTED");
    await assert.rejects(useCase.execute("merchant-b", "r"), (error: any) => error.getStatus() === 400);
  });
});
