import assert from "node:assert/strict";
import test from "node:test";
import { captureAiAuthority, createOwnContextReceipt } from "./whatsapp-ai-authority.js";
import { mergeWhatsAppTurnResponse } from "./whatsapp-turn-response.js";

const original = captureAiAuthority({ merchantId: "m", configId: "cfg", whatsappSessionId: "wa", deviceId: "META_CLOUD:cfg",
  buyerPhone: "+5511999999999", provider: "META_CLOUD", accountId: "10001", binding: null,
  checkoutSessionId: null, conversationId: "conv", revision: "" }, "inbox");
const own = createOwnContextReceipt(original, { checkoutSessionId: "checkout", conversationId: "conv", revision: "inbox" });

test("T51 immutable turn response", async t => {
  await t.test("catch and fallback preserve original authority and persisted context/effect receipts", () => {
    const effect = { version: 1, inboxId: original.inboxId, authority: original };
    const old = { aiAuthority: original, ownContextReceipt: own, aiEffectReceipt: effect, phase: "prepared" };
    const merged = mergeWhatsAppTurnResponse(old, { phase: "complete", purpose: "ai_suppressed" });
    assert.deepEqual(merged.aiAuthority, original);
    assert.deepEqual(merged.ownContextReceipt, own);
    assert.deepEqual(merged.aiEffectReceipt, effect);
    assert.equal(merged.phase, "complete");
  });
  await t.test("no save replaces the original epoch, anchor or receipt with current state", () => {
    const old = { aiAuthority: original, ownContextReceipt: own };
    for (const replacement of [{ ...original, epoch: 2, bindingId: "binding" }, { ...original, checkoutSessionId: "renewal" }])
      assert.throws(() => mergeWhatsAppTurnResponse(old, { aiAuthority: replacement }), /authority_conflict/);
    assert.throws(() => mergeWhatsAppTurnResponse(old, { ownContextReceipt: { ...own, to: { ...own.to, revision: "newer" } } }), /receipt_conflict/);
    assert.throws(() => mergeWhatsAppTurnResponse(old, { aiAuthority: null }), /authority_invalid/);
  });
  await t.test("malformed persisted authority cannot be rescued by a newly captured token", () => {
    assert.throws(() => mergeWhatsAppTurnResponse({ aiAuthority: { ...original, provider: ["META_CLOUD"] } }, { aiAuthority: original }), /authority_invalid/);
    assert.throws(() => mergeWhatsAppTurnResponse({}, { ownContextReceipt: own }), /authority_required/);
    assert.throws(() => mergeWhatsAppTurnResponse({ aiAuthority: original }, { aiEffectReceipt: { version: 1, inboxId: "other", authority: original } }), /effect_receipt_invalid/);
  });
  await t.test("signed callback receipts and sent proofs survive a stale worker copy", () => {
    const accepted = { index: 0, messageId: "wamid.1" };
    const receipt = { status: "read", messageId: "wamid.1" };
    const merged = mergeWhatsAppTurnResponse({ aiAuthority: original, receipts: [receipt], sent: [accepted] },
      { presentation: { messages: [] }, phase: "dispatching", dispatchingIndex: 0, sent: [] });
    assert.deepEqual(merged.receipts, [receipt]);
    assert.deepEqual(merged.sent, [accepted]);
    assert.equal(merged.phase, "prepared");
    assert.deepEqual(merged.aiAuthority, original);
  });
  await t.test("legacy response without authority keeps its exact commercial payload and cannot invent a receipt", () => {
    assert.deepEqual(mergeWhatsAppTurnResponse({}, { phase: "prepared", text: "existing" }), { phase: "prepared", text: "existing" });
    assert.throws(() => mergeWhatsAppTurnResponse({}, { aiEffectReceipt: { version: 1, inboxId: "inbox", authority: original } }), /authority_required/);
  });
});
