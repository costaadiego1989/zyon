import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { StorefrontController } from "./storefront.controller.js";
import { UpdateBudgetRequestStatusUseCase } from "../../application/use-cases/update-budget-request-status.use-case.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";

test("budget and funnel admin handlers enforce AuthGuard even when legacy routes are enabled", async (t) => {
  const previous = process.env.ENABLE_LEGACY_ROUTES;
  process.env.ENABLE_LEGACY_ROUTES = "true";
  t.after(() => { if (previous === undefined) delete process.env.ENABLE_LEGACY_ROUTES; else process.env.ENABLE_LEGACY_ROUTES = previous; });
  for (const name of ["handleListBudgetRequests", "handleUpdateBudgetStatus", "getFunnel", "getFunnelSessions"] as const) {
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, StorefrontController.prototype[name]).includes(AuthGuard));
  }
  const calls: unknown[] = [];
  const controller = new StorefrontController(
    {} as never, {} as never, {} as never, {} as never, { execute: async (...args: unknown[]) => calls.push(args) } as never,
    {} as never, { execute: async (...args: unknown[]) => calls.push(args) } as never,
    { execute: async (...args: unknown[]) => calls.push(args) } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const request = { user: { merchantId: "merchant_a", userId: "user_a", role: "owner" } };
  await assert.rejects(() => controller.handleListBudgetRequests({}, "merchant_a"), /missing_authenticated_user/);
  await assert.rejects(() => controller.handleUpdateBudgetStatus({}, "budget_a", { status: "approved" }), /missing_authenticated_user/);
  await assert.rejects(() => controller.handleListBudgetRequests(request, "merchant_b"), /merchant_mismatch/);
  await assert.rejects(() => controller.getFunnel("merchant_b", request), /merchant_mismatch/);
  await assert.rejects(() => controller.getFunnelSessions("merchant_b", request), /merchant_mismatch/);
  assert.equal(calls.length, 0);
  await controller.handleListBudgetRequests(request);
  await controller.handleUpdateBudgetStatus(request, "budget_a", { status: "approved" });
  assert.deepEqual(calls, [["merchant_a"], ["merchant_a", "budget_a", "approved"]]);
});

test("budget mutation predicates on tenant atomically and foreign ids never mutate", async () => {
  const requests = [{ id: "budget_a", merchantId: "merchant_a", status: "pending" }];
  const mutations: unknown[] = [];
  const useCase = new UpdateBudgetRequestStatusUseCase({ budgetRequest: {
    updateMany: async (query: { where: { id: string; merchantId: string }; data: { status: string } }) => {
      mutations.push(query);
      const rows = requests.filter((row) => row.id === query.where.id && row.merchantId === query.where.merchantId);
      rows.forEach((row) => { row.status = query.data.status; });
      return { count: rows.length };
    },
  } } as never);
  await assert.rejects(() => useCase.execute("", "budget_a", "approved"), /merchant_id_required/);
  await assert.rejects(() => useCase.execute("merchant_a", "budget_a", "invalid" as never), /invalid_status/);
  assert.equal(mutations.length, 0);
  await assert.rejects(() => useCase.execute("merchant_b", "budget_a", "approved"), /budget_request_not_found/);
  assert.equal(requests[0]?.status, "pending");
  assert.deepEqual(await useCase.execute("merchant_a", "budget_a", "approved"), { id: "budget_a", status: "approved" });
  assert.equal(requests[0]?.status, "approved");
});

test("HTTP conversation aliases reject missing/foreign capability before reading, writing, or tracking", async () => {
  const capabilities = new RealtimeCapabilityService("test-realtime-secret-at-least-32-characters");
  const calls: unknown[] = [];
  const spy = { execute: async (...input: unknown[]) => calls.push(input) };
  const controller = new StorefrontController(
    {} as never, spy as never, spy as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
    { promptExperiment: { findFirst: async () => { calls.push("tracking"); return null; } } } as never,
    {} as never, capabilities,
  );
  await assert.rejects(() => controller.sendMessage("conv_a", { user_message: "hello", merchant_id: "merchant_a" }, {}), /invalid_conversation_token/);
  await assert.rejects(() => controller.getHistory("conv_a", {}), /invalid_conversation_token/);
  await assert.rejects(() => controller.trackEvent("conv_a", { event: "hello", merchant_id: "merchant_a" }, {}), /invalid_conversation_token/);
  const access = capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant_a", resourceId: "conv_a" });
  const request = { headers: { authorization: `Bearer ${access.token}` } };
  await assert.rejects(() => controller.getHistory("conv_b", request), /conversation_access_denied/);
  await assert.rejects(() => controller.sendMessage("conv_a", { user_message: "hello", merchant_id: "merchant_b" }, request), /conversation_access_denied/);
  await assert.rejects(() => controller.sendMessage("conv_a", { user_message: "hello", cart_id: "foreign_cart" }, request), /conversation_cart_mismatch/);
  assert.equal(calls.length, 0);
  await controller.sendMessage("conv_a", { user_message: "hello" }, request);
  await controller.getHistory("conv_a", request);
  await controller.trackEvent("conv_a", { event: "hello", merchant_id: "merchant_a" }, request);
  assert.deepEqual(calls, [
    [{ merchant_id: "merchant_a", conversation_id: "conv_a", user_message: "hello", cart_id: "conv_a", history: undefined }],
    [{ merchant_id: "merchant_a", conversation_id: "conv_a" }], "tracking",
  ]);
});
