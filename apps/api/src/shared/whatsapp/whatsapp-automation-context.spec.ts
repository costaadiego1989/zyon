import assert from "node:assert/strict";
import test from "node:test";
import { readNormalCheckoutSourceProjection } from "../persistence/storefront-normal-checkout-read.js";
import { captureAiAuthority } from "../../modules/whatsapp-channel/domain/services/whatsapp-ai-authority.js";
import { currentWhatsAppExecution, withWhatsAppExecution, withoutWhatsAppExecutionForVerifiedOperation, startWhatsAppRequest,
  admitWhatsAppEffectInTransaction, withWhatsAppPaymentCreation, startWhatsAppPaymentRequest, type WhatsAppExecution, type WhatsAppRequestScope } from "./whatsapp-automation-context.js";

function execution(merchantId: string): WhatsAppExecution {
  const authority = captureAiAuthority({ merchantId, configId: merchantId + "-config", whatsappSessionId: merchantId + "-session", deviceId: "META_CLOUD:" + merchantId + "-config",
    buyerPhone: "+5511999999999", provider: "META_CLOUD", accountId: "synthetic-account", checkoutSessionId: null, conversationId: "conversation", revision: "", binding: null }, merchantId + "-inbox");
  return { authority, admitEffect: async () => {}, admitDelivery: async () => {}, startRequest: async (_scope, start) => start() };
}

test("T51 execution provenance", async t => {
  await t.test("a current turn retains its original capability through async work and restores it after failure", async () => {
    const frame = execution("merchant-a");
    assert.equal(currentWhatsAppExecution(), undefined);
    await assert.rejects(withWhatsAppExecution(frame, async () => {
      await Promise.resolve();assert.equal(currentWhatsAppExecution()?.authority, frame.authority);
      assert.ok(Object.isFrozen(currentWhatsAppExecution()));
      throw new Error("synthetic_turn_failure");
    }), /synthetic_turn_failure/);
    assert.equal(currentWhatsAppExecution(), undefined);
  });
  await t.test("a fallback cannot replace the active frame even with a newly parsed equal-looking snapshot", async () => {
    const frame = execution("merchant-a");
    await withWhatsAppExecution(frame, async () => {
      assert.equal(withWhatsAppExecution(frame, () => currentWhatsAppExecution()), frame);
      for (const replacement of [execution("merchant-a"), execution("merchant-b"), { ...frame }])
        assert.throws(() => withWhatsAppExecution(replacement, () => "forbidden"), /whatsapp_execution_replace_forbidden/);
      assert.equal(currentWhatsAppExecution(), frame);
    });
  });
  await t.test("a verified operational branch does not clear its parallel AI sibling or adopt another epoch on return", async () => {
    const frame = execution("merchant-a");
    await withWhatsAppExecution(frame, async () => {
      const results = await Promise.all([
        withoutWhatsAppExecutionForVerifiedOperation(async () => { await Promise.resolve();return currentWhatsAppExecution(); }),
        (async () => { await Promise.resolve();return currentWhatsAppExecution()?.authority; })(),
      ]);
      assert.deepEqual(results, [undefined, frame.authority]);assert.equal(currentWhatsAppExecution(), frame);
    });
  });
  await t.test("concurrent merchant conversations do not inherit one another's automation authority", async () => {
    const a = execution("merchant-a"), b = execution("merchant-b");
    const results = await Promise.all([a, b].map(frame => withWhatsAppExecution(frame, async () => {
      await Promise.resolve();return { merchantId: currentWhatsAppExecution()?.authority.merchantId, inboxId: currentWhatsAppExecution()?.authority.inboxId };
    })));
    assert.deepEqual(results, [{ merchantId: "merchant-a", inboxId: "merchant-a-inbox" }, { merchantId: "merchant-b", inboxId: "merchant-b-inbox" }]);
  });
  await t.test("a mutable or serialized buyer object is not an execution capability", () => {
    const frame = execution("merchant-a");
    assert.throws(() => withWhatsAppExecution({ ...frame, authority: { ...frame.authority } }, () => "forbidden"), /whatsapp_execution_invalid/);
    const serialized = JSON.parse(JSON.stringify(frame));
    assert.throws(() => withWhatsAppExecution(serialized, () => "forbidden"), /whatsapp_execution_invalid/);
  });
  await t.test("unrelated operational or storefront work keeps its original request result outside a WhatsApp frame", async () => {
    const result = await startWhatsAppRequest({ kind: "model", merchantId: "independent-store" }, async () => ({ accepted: "existing-server-operation" }));
    assert.deepEqual(result, { accepted: "existing-server-operation" });assert.equal(currentWhatsAppExecution(), undefined);
  });
  await t.test("an active AI effect cannot claim that an independent root client belongs to its transaction", async () => {
    const frame = execution("merchant-a");
    await withWhatsAppExecution(frame, async () => {
      const rootLike = { $transaction: async () => "independent-write" };
      await assert.rejects(Reflect.apply(admitWhatsAppEffectInTransaction, undefined, [rootLike, "merchant-a"]), /whatsapp_effect_transaction_required/);
    });
  });
  await t.test("the actual normal source reader admits the original turn before taking its merchant lock", async () => {
    const frame = execution("merchant-a"), observed: string[] = [];
    frame.admitEffect = async () => { observed.push("identity");throw new Error("whatsapp_ai_turn_suppressed"); };
    const tx = { $executeRaw: async () => { observed.push("merchant");return 1; }, $queryRaw: async () => [] };
    await withWhatsAppExecution(frame, async () => {
      await assert.rejects(Reflect.apply(readNormalCheckoutSourceProjection, undefined,
        [tx, { merchantId: "merchant-a", cartId: "cart-a" }]), /whatsapp_ai_turn_suppressed/);
    });
    assert.deepEqual(observed, ["identity"]);
  });
  await t.test("the final PSP request retains the original durable intent and creation lease across preparation", async () => {
    const frame = execution("merchant-a"), seen: WhatsAppRequestScope[] = [];
    frame.startRequest = async (scope, start) => { seen.push(scope); return start(); };
    await withWhatsAppExecution(frame, () => withWhatsAppPaymentCreation({ merchantId: "merchant-a", intentId: "intent-1", sessionId: "checkout-1", creationLeaseToken: "lease-1" }, async () => {
      await Promise.resolve();
      assert.equal(await startWhatsAppPaymentRequest("merchant-a", async () => "SDK-start"), "SDK-start");
      assert.equal(currentWhatsAppExecution(), frame);
    }));
    assert.deepEqual(seen, [{ kind: "payment", merchantId: "merchant-a", intentId: "intent-1", sessionId: "checkout-1", creationLeaseToken: "lease-1" }]);
  });
  await t.test("another merchant or a nested new creation lease cannot replace the original PSP claim", async () => {
    const frame = execution("merchant-a");let starts = 0;
    await withWhatsAppExecution(frame, () => withWhatsAppPaymentCreation({ merchantId: "merchant-a", intentId: "intent-1", sessionId: "checkout-1", creationLeaseToken: "lease-1" }, async () => {
      assert.throws(() => startWhatsAppPaymentRequest("merchant-b", async () => { starts++; }), /whatsapp_ai_turn_suppressed/);
      assert.throws(() => withWhatsAppPaymentCreation({ merchantId: "merchant-a", intentId: "intent-1", sessionId: "checkout-1", creationLeaseToken: "new-lease" }, () => { starts++; }), /whatsapp_ai_turn_suppressed/);
      assert.equal(starts, 0);
    }));
  });
  await t.test("verified operational reconciliation clears only its own branch and never lends its exemption to the AI sibling", async () => {
    const frame = execution("merchant-a"), seen: WhatsAppRequestScope[] = [];
    frame.startRequest = async (scope, start) => { seen.push(scope); return start(); };
    await withWhatsAppExecution(frame, () => withWhatsAppPaymentCreation({ merchantId: "merchant-a", intentId: "intent-1", sessionId: "checkout-1", creationLeaseToken: "lease-1" }, async () => {
      await Promise.all([
        withoutWhatsAppExecutionForVerifiedOperation(() => startWhatsAppPaymentRequest("operational-other", async () => "canonical-recovery")),
        startWhatsAppPaymentRequest("merchant-a", async () => "original-AI"),
      ]);
      await startWhatsAppPaymentRequest("merchant-a", async () => "original-AI-after-reconcile");
    }));
    assert.equal(seen.length, 2);
    assert.ok(seen.every(scope => scope.kind === "payment" && scope.creationLeaseToken === "lease-1" && scope.merchantId === "merchant-a"));
  });
});
