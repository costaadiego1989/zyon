import assert from "node:assert/strict";
import test from "node:test";
import { captureAiAuthority, readAiAuthority, matchesAiAuthority, createOwnContextReceipt, type AiConversationSnapshot } from "./whatsapp-ai-authority.js";

test("T51 original authority", async t => {
  const snapshot: AiConversationSnapshot = { merchantId: "merchant", configId: "config", whatsappSessionId: "session", deviceId: "META_CLOUD:config",
    buyerPhone: "+5511999999999", provider: "META_CLOUD", accountId: "100001", checkoutSessionId: "old-checkout", conversationId: "store-conversation", revision: "old-revision", binding: null };
  const token = captureAiAuthority(snapshot, "inbox");
  await t.test("initial absent binding captures immutable0 without inventing a binding identity", () => {
    assert.equal(token.bindingId, null);assert.equal(token.epoch, 0);assert.equal(token.inboxId, "inbox");
    assert.equal(token.checkoutSessionId, "old-checkout");assert.equal(token.conversationId, "store-conversation");
    assert.equal(token.revision, "old-revision");assert.ok(Object.isFrozen(token));assert.equal(snapshot.binding, null);
    assert.equal(matchesAiAuthority(snapshot, token), true);
  });
  await t.test("takeover and a later AI epoch never restore an old implicit0", () => {
    for (const binding of [{ id: "new-binding", epoch: 1, mode: "waiting_human" as const },
      { id: "new-binding", epoch: 2, mode: "human" as const }, { id: "new-binding", epoch: 3, mode: "ai" as const },
      { id: "new-binding", epoch: 0, mode: "ai" as const }]) assert.equal(matchesAiAuthority({ ...snapshot, binding }, token), false);
    assert.throws(() => captureAiAuthority({ ...snapshot, binding: { id: "binding", epoch: 1, mode: "waiting_human" } }, "inbox"), /whatsapp_ai_paused/);
  });
  await t.test("a bound AI capture retains its exact binding and epoch", () => {
    const current = { ...snapshot, binding: { id: "binding", epoch: 3, mode: "ai" as const } }, bound = captureAiAuthority(current, "inbox");
    assert.equal(matchesAiAuthority(current, bound), true);assert.equal(bound.bindingId, "binding");assert.equal(bound.epoch, 3);
    for (const binding of [null, { id: "other", epoch: 3, mode: "ai" as const }, { id: "binding", epoch: 4, mode: "ai" as const }, { id: "binding", epoch: 3, mode: "human" as const }])
      assert.equal(matchesAiAuthority({ ...current, binding }, bound), false);
  });
  await t.test("tenant/config/session/recipient/account and renewal context must remain original", () => {
    for (const patch of [{ merchantId: "foreign" }, { configId: "foreign" }, { whatsappSessionId: "foreign" }, { deviceId: "META_CLOUD:foreign" },
      { buyerPhone: "+5511888888888" }, { provider: "TWILIO" }, { accountId: "other-account" }, { checkoutSessionId: "renewed-checkout" },
      { conversationId: "renewed-conversation" }, { revision: "newer-revision" }]) assert.equal(matchesAiAuthority({ ...snapshot, ...patch }, token), false);
  });
  await t.test("missing, malformed or unversioned saved authority cannot mint current0", () => {
    for (const value of [undefined, null, {}, { ...token, version: undefined }, { ...token, epoch: 1 }, { ...token, epoch: "0" },
      { ...token, bindingId: null, epoch: 3 }, { ...token, inboxId: "" }, { ...token, origin: "operational" },
      { ...token, provider: ["TWILIO"] }, { ...token, provider: { toString: () => "META_CLOUD" } },
      { ...token, provider: { toString: () => { throw new Error("provider_coercion_forbidden"); } } }]) assert.equal(readAiAuthority(value), undefined);
    const restored = readAiAuthority(JSON.parse(JSON.stringify(token)));assert.deepEqual(restored, token);assert.ok(Object.isFrozen(restored));
  });
  await t.test("only an exact own-turn receipt permits its authorized checkout transition", () => {
    const target = { checkoutSessionId: "own-checkout", conversationId: snapshot.conversationId, revision: "own-result" };
    const current = { ...snapshot, ...target }, receipt = createOwnContextReceipt(token, target);
    assert.equal(matchesAiAuthority(current, token), false);assert.equal(matchesAiAuthority(current, token, receipt), true);
    assert.ok(Object.isFrozen(receipt));assert.ok(Object.isFrozen(receipt.authority));assert.ok(Object.isFrozen(receipt.from));assert.ok(Object.isFrozen(receipt.to));
    assert.equal(matchesAiAuthority({ ...current, revision: "next-turn" }, token, receipt), false);
    assert.equal(matchesAiAuthority({ ...current, checkoutSessionId: "renewal" }, token, receipt), false);
    for (const invalid of [true, { sessionApplied: true }, { ...receipt, inboxId: "other-inbox" }, { ...receipt, authority: { ...token, inboxId: "other-inbox" } },
      { ...receipt, from: { ...receipt.from, checkoutSessionId: "not-original" } }, { ...receipt, to: { ...target, revision: "not-current" } }])
      assert.equal(matchesAiAuthority(current, token, invalid), false);
  });
});
