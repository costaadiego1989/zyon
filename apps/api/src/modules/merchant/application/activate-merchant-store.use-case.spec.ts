import assert from "node:assert/strict";
import test from "node:test";
import { ActivateMerchantStoreUseCase } from "./activate-merchant-store.use-case.js";

test("activating a permitted store issues a session scoped to that store", async () => {
  const activationCalls: unknown[] = [];
  const issueCalls: unknown[] = [];
  const useCase = new ActivateMerchantStoreUseCase(
    { activate: async (...input: unknown[]) => { activationCalls.push(input); return { merchantId: "store_2", role: "admin" }; } } as never,
    { issue: async (...input: unknown[]) => { issueCalls.push(input); return "session-for-store-2"; }, expiresIn: () => 3600 } as never,
  );

  const response = await useCase.execute({ userId: "user_1", merchantId: "store_1", email: "owner@example.test", role: "owner", authVersion: 3 }, "store_2");
  assert.equal(response.merchant_id, "store_2");
  assert.equal(response.access_token, "session-for-store-2");
  assert.deepEqual(activationCalls, [[{ userId: "user_1", merchantId: "store_1", role: "owner" }, "store_2"]]);
  assert.deepEqual(issueCalls, [[{ userId: "user_1", merchantId: "store_2", email: "owner@example.test", role: "admin", authVersion: 3 }, 3]]);
});
