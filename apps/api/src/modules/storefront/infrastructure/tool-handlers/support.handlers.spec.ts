import assert from "node:assert/strict";
import test from "node:test";
import { createSupportHandlers } from "./support.handlers.js";

test("FAQ never turns example payment, delivery or returns promises into merchant policy", async () => {
  for (const faqItems of [null, [], [{ question: "Há retirada?", answer: "Retirada somente na loja A." }]]) {
    const handlers = createSupportHandlers({ prisma: { supportSetting: { findUnique: async (args: any) => {
      assert.equal(args.where.merchantId, "merchant-a");
      return { faqItems };
    } } }, supportHandoff: {} } as any, { merchantId: "merchant-a", sessionId: "conversation-a" });
    assert.deepEqual(await handlers.getFaq({}), { faqs: faqItems ?? [] });
  }
});
