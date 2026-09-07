import assert from "node:assert/strict";
import test from "node:test";
import { ManageMerchantNotificationInboxUseCase } from "./manage-merchant-notification-inbox.use-case.js";

test("keeps tenant-scoped notification reads and ignores an invalid since value", async () => {
  const calls: unknown[] = [];
  const useCase = new ManageMerchantNotificationInboxUseCase({
    list: async (...input) => { calls.push(input); return [{ id: "notice_a" }]; },
    markRead: async (...input) => { calls.push(input); },
    markAllRead: async (...input) => { calls.push(input); },
  });
  assert.deepEqual(await useCase.list("merchant_a", "invalid"), [{ id: "notice_a" }]);
  await useCase.markRead("merchant_a", "notice_a");
  await useCase.markAllRead("merchant_a");
  assert.deepEqual(calls, [["merchant_a", undefined], ["merchant_a", "notice_a"], ["merchant_a"]]);
});
