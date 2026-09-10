import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessRefundUseCase } from "./process-refund.use-case.js";
import { ReturnEntity, type ReturnStatus } from "../../domain/entities/return.entity.js";
import type { RefundOrderPaymentResult } from "../../../payment/application/services/refund-payment.service.js";

function setup(
  status: ReturnStatus = "INSPECTED_PASS",
  refund: RefundOrderPaymentResult = { refunded: true, amountCents: 1_000, paymentIntentId: "pay_1", providerRefundId: "refund_1" },
  persistedRefund?: { providerRefundId?: string; paymentIntentId?: string; status: string; amountInCents: number },
  reconciliation: { state: "succeeded" | "pending" | "failed" | "unknown" } = { state: "unknown" },
) {
  let currentStatus = status;
  let currentRefund: any = persistedRefund
    ? { id: "refund", returnId: "r", createdAt: new Date(), ...persistedRefund }
    : undefined;
  const entity = () => new ReturnEntity({ id: "r", merchantId: "merchant-b", orderId: "o", buyerId: "buyer", status: currentStatus,
    reason: "DEFECTIVE", createdAt: new Date(), updatedAt: new Date(), items: [{ id: "i", returnId: "r", variantId: "v", quantity: 3 }], refund: currentRefund });
  const calls = {
    statuses: [] as Array<[string, string]>,
    started: [] as Array<{ returnId: string; paymentIntentId?: string; providerRefundId?: string; status: string; amountInCents: number }>,
    saved: [] as Array<{ returnId: string; paymentIntentId?: string; providerRefundId?: string; status: string; amountInCents: number }>,
    refundStatuses: [] as Array<[string, string]>,
    providerRequests: 0,
    reconciliationRequests: 0,
    reconciliationInputs: [] as any[],
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
      currentRefund = { id: "refund", ...input, createdAt: new Date() };
      return currentRefund;
    },
    updateRefundStatus: async (returnId: string, nextStatus: string) => {
      calls.refundStatuses.push([returnId, nextStatus]);
      currentRefund = currentRefund ? { ...currentRefund, status: nextStatus, processedAt: new Date() } : currentRefund;
    },
  };
  const refundPayment = {
    refundOrderPayment: async () => { calls.providerRequests += 1; return refund; },
    reconcileRefundPayment: async (input: unknown) => { calls.reconciliationRequests += 1; calls.reconciliationInputs.push(input); return reconciliation; },
  };
  return { useCase: new ProcessRefundUseCase(repo as any, refundPayment as any), calls };
}

describe("Returns refund settlement", () => {
  it("leaves a pending provider refund processing and does not claim completion", async () => {
    const { useCase, calls } = setup("INSPECTED_PASS", {
      refunded: false, amountCents: 1_000, paymentIntentId: "pay_pending", providerRefundId: "refund_pending", reason: "provider_refund_pending",
    });

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_PROCESSING");
    assert.deepEqual(calls.saved, [{ returnId: "r", paymentIntentId: "pay_pending", providerRefundId: "refund_pending", status: "PENDING", amountInCents: 1_000 }]);
    assert.deepEqual(calls.refundStatuses, []);
    assert.deepEqual(calls.statuses, [["r", "REFUND_PROCESSING"]]);
  });

  it("marks a return completed only after a succeeded provider refund", async () => {
    const { useCase, calls } = setup();

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_COMPLETED");
    assert.deepEqual(calls.saved, [{ returnId: "r", paymentIntentId: "pay_1", providerRefundId: "refund_1", status: "COMPLETED", amountInCents: 1_000 }]);
    assert.deepEqual(calls.refundStatuses, [["r", "COMPLETED"]]);
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
  it("issues the first refund after marketplace acceptance leaves REFUND_PROCESSING without a durable attempt", async () => {
    const { useCase, calls } = setup("REFUND_PROCESSING", {
      refunded: false,
      amountCents: 1_000,
      paymentIntentId: "pay_pending",
      providerRefundId: "refund_pending",
      reason: "provider_refund_pending",
    });

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_PROCESSING");
    assert.equal(calls.providerRequests, 1);
    assert.deepEqual(calls.saved, [{ returnId: "r", paymentIntentId: "pay_pending", providerRefundId: "refund_pending", status: "PENDING", amountInCents: 1_000 }]);
  });
  it("does not reissue a pending refund after the explicit marketplace action is retried", async () => {
    const { useCase, calls } = setup("REFUND_PROCESSING", {
      refunded: false,
      amountCents: 1_000,
      paymentIntentId: "pay_pending",
      providerRefundId: "refund_pending",
      reason: "provider_refund_pending",
    });

    await useCase.execute("merchant-b", "r");
    await useCase.execute("merchant-b", "r");

    assert.equal(calls.providerRequests, 1);
    assert.equal(calls.reconciliationRequests, 1);
  });
  it("completes a known pending provider refund without another provider POST", async () => {
    const { useCase, calls } = setup(
      "REFUND_PROCESSING",
      undefined as any,
      { providerRefundId: "re_1", paymentIntentId: "pay_1", status: "PENDING", amountInCents: 1_000 },
      { state: "succeeded" },
    );

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_COMPLETED");
    assert.equal(calls.providerRequests, 0);
    assert.equal(calls.reconciliationRequests, 1);
    assert.deepEqual(calls.reconciliationInputs, [{ merchantId: "merchant-b", externalOrderId: "o", providerRefundId: "re_1", paymentIntentId: "pay_1", refundReference: "return:r" }]);
    assert.deepEqual(calls.refundStatuses, [["r", "COMPLETED"]]);
    assert.deepEqual(calls.statuses, [["r", "REFUND_COMPLETED"]]);
  });
  it("reconciles an uncertain submission without a provider refund id and never posts again", async () => {
    const { useCase, calls } = setup(
      "REFUND_PROCESSING",
      undefined as any,
      { paymentIntentId: "pay_1", status: "PENDING", amountInCents: 1_000 },
      { state: "succeeded" },
    );

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_COMPLETED");
    assert.equal(calls.providerRequests, 0);
    assert.deepEqual(calls.reconciliationInputs, [{ merchantId: "merchant-b", externalOrderId: "o", providerRefundId: "pending:return:r", paymentIntentId: "pay_1", refundReference: "return:r" }]);
  });
  it("records a terminal provider failure without issuing a replacement refund", async () => {
    const { useCase, calls } = setup(
      "REFUND_PROCESSING",
      undefined as any,
      { providerRefundId: "re_1", status: "PENDING", amountInCents: 1_000 },
      { state: "failed" },
    );

    const result = await useCase.execute("merchant-b", "r");

    assert.equal(result.status, "REFUND_PROCESSING");
    assert.equal(calls.providerRequests, 0);
    assert.equal(calls.reconciliationRequests, 1);
    assert.deepEqual(calls.refundStatuses, [["r", "FAILED"]]);
  });
  it("allows an operator to reconcile a failed attempt again without issuing another refund", async () => {
    const { useCase, calls } = setup(
      "REFUND_PROCESSING",
      undefined as any,
      { providerRefundId: "re_1", status: "FAILED", amountInCents: 1_000 },
      { state: "unknown" },
    );

    await useCase.execute("merchant-b", "r");

    assert.equal(calls.providerRequests, 0);
    assert.equal(calls.reconciliationRequests, 1);
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
