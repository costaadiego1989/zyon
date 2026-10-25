import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { AcceptMarketplaceReturnUseCase as AcceptUseCase } from "./accept-marketplace-return.use-case.js";

function AcceptMarketplaceReturnUseCase(repo: any, register?: any, marketplace?: any) {
  return new AcceptUseCase(repo, register, marketplace, { preview: async () => ({ amountCents: 1000 }),
    execute: async () => ({ status: "REFUND_PROCESSING" }) } as any);
}

test("ordinary approval executes the durable refund and reports the provider's actual outcome", async () => {
  const sequence: string[] = [];
  const useCase = new AcceptUseCase({ findById: async () => ({ id: "r", orderId: "o", status: "REQUESTED", items: [] }),
    updateStatus: async () => { sequence.push("approved"); } } as any, undefined, undefined, {
    preview: async () => { sequence.push("original-payment-proven"); }, execute: async () => { sequence.push("refund");
      return { status: "REFUND_COMPLETED", refund: { status: "COMPLETED", amountInCents: 1333 } }; } } as any);
  const result = await useCase.execute({ merchantId: "host", returnId: "r" });
  assert.equal(result.status, "REFUND_COMPLETED"); assert.equal(result.refund?.amountInCents, 1333);
  assert.deepEqual(sequence, ["original-payment-proven", "approved", "refund"]);
});
test("approval fails before changing status when the original payment cannot be proven", async () => {
  const useCase = new AcceptUseCase({ findById: async () => ({ id: "r", status: "REQUESTED" }),
    updateStatus: async () => assert.fail("unproven payment approved") } as any, undefined, undefined,
    { preview: async () => { throw Error("approved_payment_not_found"); }, execute: async () => assert.fail("PSP called") } as any);
  await assert.rejects(useCase.execute({ merchantId: "host", returnId: "r" }), /approved_payment_not_found/);
});

test("does not acknowledge return approval when financial cancellation fails", async () => {
  const writes: unknown[] = [];
  const repo = { findById: async () => ({ id: "return", orderId: "order", status: "REQUESTED", createdAt: new Date(), items: [{ variantId: "item", quantity: 1 }] }),
    updateStatus: async (...args: unknown[]) => { writes.push(args); } };
  const useCase = AcceptMarketplaceReturnUseCase(repo as any, { execute: async (input: any) => {
    assert.equal(input.merchantId, "host");
    throw new Error("database unavailable");
  } } as any);
  await assert.rejects(useCase.execute({ merchantId: "host", returnId: "return" }), /database unavailable/);
  assert.deepEqual(writes, []);
});

test("continues own-store returns with no matching marketplace settlement", async () => {
  const writes: unknown[] = [];
  const useCase = AcceptMarketplaceReturnUseCase({
    findById: async () => ({ id: "return", orderId: "order", status: "REQUESTED", createdAt: new Date(), items: [{ variantId: "own-item", quantity: 1 }] }),
    updateStatus: async (...args: unknown[]) => { writes.push(args); },
  } as any, { execute: async () => { throw new NotFoundException("no_marketplace_settlement_for_return"); } } as any);
  const result = await useCase.execute({ merchantId: "host", returnId: "return" });
  assert.equal(result.status, "REFUND_PROCESSING");
  assert.deepEqual(writes, [["return", "REFUND_PROCESSING", "REQUESTED"]]);
});

test("does not approve a return when a settlement was skipped", async () => {
  const uc = AcceptMarketplaceReturnUseCase({ findById: async () => ({ id: "return", orderId: "order", status: "REQUESTED", createdAt: new Date(), items: [{ variantId: "item", quantity: 1 }] }),
    updateStatus: async () => assert.fail("incomplete cancellation approved") } as any,
    { execute: async () => ({ updated: [], skipped: [{ settlementId: "settlement", reason: "pending" }] }) } as any);
  await assert.rejects(uc.execute({ merchantId: "host", returnId: "return" }), /cancellation_incomplete/);
});

test("cannot reopen completed, cancelled or rejected returns", async () => {
  for (const status of ["REFUND_COMPLETED", "CANCELLED", "REJECTED", "INSPECTED_FAIL"]) {
    const uc = AcceptMarketplaceReturnUseCase({ findById: async () => ({ id: "return", status }),
      updateStatus: async () => assert.fail("terminal return reopened") } as any,
      { execute: async () => assert.fail("terminal return changed finances") } as any);
    await assert.rejects(uc.execute({ merchantId: "host", returnId: "return" }), /current_status/);
  }
});
