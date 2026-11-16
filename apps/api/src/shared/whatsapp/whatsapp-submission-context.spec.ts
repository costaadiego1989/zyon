import test from "node:test";
import assert from "node:assert/strict";
import { captureAiAuthority } from "../../modules/whatsapp-channel/domain/services/whatsapp-ai-authority.js";
import { withWhatsAppSubmission, currentWhatsAppSubmissionScope, startWhatsAppRequest,
  withWhatsAppExecution, withoutWhatsAppExecutionForVerifiedOperation, admitWhatsAppEffectInTransaction,
  withWhatsAppEffectTransaction, type WhatsAppSubmission, type WhatsAppExecution, type WhatsAppRequestScope } from "./whatsapp-automation-context.js";

const scope = Object.freeze({ kind: "whatsapp" as const, merchantId: "merchant", configId: "config", deviceId: "META_CLOUD:config",
  provider: "META_CLOUD", accountId: "90001001", recipient: "+5511999999999" });
const frame = (start: WhatsAppSubmission["startRequest"]): WhatsAppSubmission => ({ requestScope: scope, startRequest: start });
const allow = (): WhatsAppSubmission => frame(async <T>(_actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>) => start());
function ai(): WhatsAppExecution {
  return { authority: captureAiAuthority({ merchantId: scope.merchantId, configId: scope.configId, whatsappSessionId: "session", deviceId: scope.deviceId,
    buyerPhone: scope.recipient, provider: scope.provider, accountId: scope.accountId, checkoutSessionId: "checkout", conversationId: "conversation", revision: "", binding: null }, "inbox"),
    admitEffect: async () => {}, admitDelivery: async () => {}, startRequest: async <T>(_actual: WhatsAppRequestScope, start: () => Promise<T>) => start() };
}

test("operator submission retains its exact server scope across asynchronous preparation", async () => {
  let admitted = 0, started = 0;
  const original = frame(async <T>(actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>) => {
    assert.deepEqual(actual, scope); admitted++; return start();
  });
  const result = await withWhatsAppSubmission(original, async () => {
    await Promise.resolve(); assert.equal(currentWhatsAppSubmissionScope(), scope);
    return startWhatsAppRequest(scope, async () => { started++; return "local-accepted"; });
  });
  assert.equal(result, "local-accepted"); assert.equal(admitted, 1); assert.equal(started, 1); assert.equal(currentWhatsAppSubmissionScope(), undefined);
});
test("a refused original submission never starts its provider request", async () => {
  let started = 0;
  const original = frame(async () => { throw new Error("canonical_epoch_or_lease_changed"); });
  await assert.rejects(withWhatsAppSubmission(original, () => startWhatsAppRequest(scope, async () => { started++; })), /canonical_epoch_or_lease_changed/);
  assert.equal(started, 0);
});
test("operator and AI authorities cannot replace each other or coexist", () => {
  assert.throws(() => withWhatsAppExecution(ai(), () => withWhatsAppSubmission(allow(), () => {})), /whatsapp_submission_suppressed/);
  assert.throws(() => withWhatsAppSubmission(allow(), () => withWhatsAppExecution(ai(), () => {})), /whatsapp_execution_invalid/);
});
test("nested work cannot swap the original submission capability", () => {
  const original = allow(); assert.equal(withWhatsAppSubmission(original, () => withWhatsAppSubmission(original, () => 42)), 42);
  assert.throws(() => withWhatsAppSubmission(original, () => withWhatsAppSubmission(allow(), () => {})), /whatsapp_submission_suppressed/);
});
test("operator submission cannot authorize model requests payment requests or ordinary tool writes", async () => {
  let started = 0, writes = 0;
  for (const kind of ["model", "payment"] as const)
    assert.throws(() => withWhatsAppSubmission(allow(), () => startWhatsAppRequest({ kind, merchantId: scope.merchantId }, async () => { started++; })), /whatsapp_submission_suppressed/);
  await assert.rejects(withWhatsAppSubmission(allow(), () => Reflect.apply(admitWhatsAppEffectInTransaction, undefined, [{}, scope.merchantId])), /whatsapp_submission_suppressed/);
  assert.throws(() => withWhatsAppSubmission(allow(), () => Reflect.apply(withWhatsAppEffectTransaction, undefined,
    [{}, scope.merchantId, async () => { writes++; }])), /whatsapp_submission_suppressed/);
  assert.equal(started, 0); assert.equal(writes, 0);
});
test("canonical verified operations retain independent authority without erasing the caller frame", async () => {
  let admitted = 0;
  const original = frame(async <T>(_actual: Extract<WhatsAppRequestScope, { kind: "whatsapp" }>, start: () => Promise<T>) => { admitted++; return start(); });
  await withWhatsAppSubmission(original, async () => {
    await withoutWhatsAppExecutionForVerifiedOperation(() => startWhatsAppRequest({ kind: "payment", merchantId: scope.merchantId }, async () => "historical-payment-result"));
    await startWhatsAppRequest(scope, async () => "human-request"); assert.equal(currentWhatsAppSubmissionScope(), scope);
  });
  assert.equal(admitted, 1);
});
test("ordinary requests retain their original behavior and a JSON origin flag cannot install authority", async () => {
  assert.equal(await startWhatsAppRequest(scope, async () => 17), 17);
  const raw = JSON.parse('{"origin":"human","requestScope":{"kind":"whatsapp"}}');
  assert.throws(() => Reflect.apply(withWhatsAppSubmission, undefined, [raw, () => {}]), /whatsapp_submission_suppressed/);
  assert.equal(currentWhatsAppSubmissionScope(), undefined);
});
