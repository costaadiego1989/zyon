import assert from "node:assert/strict";
import { test } from "node:test";
import { ReopenEmbedCheckoutUseCase } from "./reopen-embed-checkout.use-case.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";

function fixture() {
  const session = checkoutSession({ merchantId: "merchant", sessionId: "session", globalUserId: "buyer" });
  const buyer = { globalUserId: "buyer", customer: { email: "buyer@example.test", email_verified: true as const } };
  let guard = 0, cancelled = 0, edits = 0, uncertain = false;
  const sessions = { getSession: async () => session, assertBuyerEditAllowed: async () => { guard++; },
    reopenForBuyerEdit: async () => { edits++; return session; } };
  const cancel = { execute: async (merchantId: string, sessionId: string, verified: typeof buyer) => {
    assert.equal(merchantId, "merchant"); assert.equal(sessionId, "session"); assert.deepEqual(verified, buyer);
    cancelled++; if (uncertain) throw Error("checkout_payment_cancellation_unconfirmed");
  } };
  const useCase = new ReopenEmbedCheckoutUseCase(sessions as never, cancel as never, { platformFeeBrl: .99 } as never);
  return { session, buyer, useCase, counts: () => ({ guard, cancelled, edits }), uncertain: () => { uncertain = true; } };
}
test("editing passes the verified buyer to the durable cancellation service before any checkout mutation", async () => {
  const f = fixture(); await f.useCase.execute("merchant", "session", "payment", f.buyer);
  assert.deepEqual(f.counts(), { guard: 1, cancelled: 1, edits: 1 });
});
test("foreign merchant/session/buyer cannot cancel or reopen", async () => {
  const f = fixture();
  for (const [merchant, session, buyer] of [["foreign", "session", f.buyer], ["merchant", "foreign", f.buyer],
    ["merchant", "session", { ...f.buyer, globalUserId: "foreign" }]] as const) {
    await assert.rejects(f.useCase.execute(merchant, session, "payment", buyer), /buyer_mismatch/);
  }
  assert.deepEqual(f.counts(), { guard: 0, cancelled: 0, edits: 0 });
});
test("unknown cancellation never edits totals or releases the checkout", async () => {
  const f = fixture(), before = structuredClone(f.session); f.uncertain();
  await assert.rejects(f.useCase.execute("merchant", "session", "payment", f.buyer), /unconfirmed/);
  assert.equal(f.counts().edits, 0); assert.deepEqual(f.session, before);
});
