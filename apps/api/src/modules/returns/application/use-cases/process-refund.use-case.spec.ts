import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProcessRefundUseCase } from "./process-refund.use-case.js";
import { ReturnEntity, type ReturnStatus } from "../../domain/entities/return.entity.js";

function setup(status: ReturnStatus = "INSPECTED_PASS") {
  const entity = new ReturnEntity({ id: "r", merchantId: "merchant-b", orderId: "o", buyerId: "buyer", status,
    reason: "DEFECTIVE", createdAt: new Date(), updatedAt: new Date(), items: [{ id: "i", returnId: "r", variantId: "v", quantity: 3 }] });
  const repo = {
    findById: async (merchantId: string, id: string) => merchantId === entity.merchantId && id === entity.id ? entity : null,
    updateStatus: async () => assert.fail("must not mutate return status without a refund provider"),
    saveRefund: async () => assert.fail("must not record an invented amount or completed refund"),
    updateRefundStatus: async () => assert.fail("must not claim completion without provider evidence"),
  };
  return { useCase: new ProcessRefundUseCase(repo as any), entity };
}

describe("Returns refund provider gate", () => {
  it("returns an explicit unavailable response and keeps the original amount/status untouched, including concurrent retries", async () => {
    for (const status of ["INSPECTED_PASS", "REFUND_PROCESSING"] as const) {
      const { useCase, entity } = setup(status);
      await Promise.all([1, 2, 3].map(() => assert.rejects(useCase.execute("merchant-b", "r"),
        (error: any) => error.getStatus() === 503 && error.getResponse().code === "refund_provider_unavailable")));
      assert.equal(entity.status, status);
      assert.equal(entity.refund, undefined);
    }
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
