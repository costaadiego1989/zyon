import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { PaymentProviderPort, CreateProviderPaymentOutput } from "../domain/ports/payment-provider.port.js";
import type { SavePaymentIntentInput } from "../domain/ports/payment-repository.port.js";
import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";
import { captureAiAuthority } from "../../whatsapp-channel/domain/services/whatsapp-ai-authority.js";
import { currentWhatsAppExecution, withWhatsAppExecution, startWhatsAppPaymentRequest, withoutWhatsAppExecutionForVerifiedOperation,
  WhatsAppAiSuppressedError, type WhatsAppExecution } from "../../../shared/whatsapp/whatsapp-automation-context.js";

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function prepared() {
  const intent = PaymentIntentEntity.create({ merchantId: "merchant_recovery", sessionId: "session_recovery", idempotencyKey: "original-key", amountCents: 300, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId: "merchant_recovery", sessionId: "session_recovery", intentId: intent.id,
    amountCents: 300, currency: "BRL", method: "pix", providerIdempotencyKey: "original-provider-key", provider: "asaas", asaasCustomerId: "customer-owned" });
  return intent;
}
function frame(isObsolete: () => boolean): WhatsAppExecution {
  const authority = captureAiAuthority({ merchantId: "merchant_recovery", configId: "config", whatsappSessionId: "wa-session", deviceId: "META_CLOUD:config",
    buyerPhone: "+5511999999999", provider: "META_CLOUD", accountId: "100001", checkoutSessionId: "session_recovery", conversationId: "conversation", revision: "", binding: null }, "inbox-original");
  return { authority, admitEffect: async () => {}, admitDelivery: async () => {}, startRequest: async (_scope, start) => {
    if (isObsolete()) throw new WhatsAppAiSuppressedError();
    return start();
  } };
}
class ProbeRepository extends InMemoryPaymentRepository {
  readonly writes: Array<{ state: string | undefined; aiContext: boolean }> = [];
  override async saveIntent(input: SavePaymentIntentInput): Promise<void> {
    this.writes.push({ state: input.intent.snapshot().creation?.state, aiContext: !!currentWhatsAppExecution() });
    return super.saveIntent(input);
  }
}
const providerResult: CreateProviderPaymentOutput = { providerPaymentId: "payment-original", status: "requires_action", buyerFacingPayload: { qrCodeCopyPaste: "synthetic-pix" } };

test("T51 payment continuation keeps canonical creation authority", async t => {
  await t.test("a provider request already started persists exactly once after takeover without lending its exemption to the AI", async () => {
    const repo = new ProbeRepository(), intent = prepared(), started = deferred<void>(), finish = deferred<CreateProviderPaymentOutput>();
    await repo.saveIntent({ intent });let obsolete = false, posts = 0;
    const provider: PaymentProviderPort = { createPayment: input => startWhatsAppPaymentRequest(input.merchantId, () => { posts++;started.resolve();return finish.promise; }) };
    const execute = withWhatsAppExecution(frame(() => obsolete), async () => {
      const saved = await new ResumePaymentCreationService(repo, provider).execute(intent);
      assert.equal(saved.providerPaymentId, providerResult.providerPaymentId);assert.equal(saved.status, "requires_action");
      assert.equal(saved.amountCents, 300);assert.equal(saved.creation?.input.providerIdempotencyKey, "original-provider-key");
      await assert.rejects(startWhatsAppPaymentRequest("merchant_recovery", async () => { posts++; }), /whatsapp_ai_turn_suppressed/);
    });
    try { await started.promise;obsolete = true; }
    finally { finish.resolve(providerResult); }
    await execute;
    assert.equal(posts, 1);assert.equal(repo.capturedEvents.length, 1);
    assert.ok(repo.writes.some(write => write.state === "in_flight" && write.aiContext));
    assert.ok(repo.writes.some(write => write.state === "complete" && !write.aiContext));
  });
  await t.test("takeover during credentials prevents the final PSP start and recovery never creates a second charge", async () => {
    const repo = new ProbeRepository(), intent = prepared(), preparing = deferred<void>(), release = deferred<void>();
    await repo.saveIntent({ intent });let obsolete = false, posts = 0, recoveries = 0;
    const provider: PaymentProviderPort = {
      createPayment: async input => { preparing.resolve();await release.promise;return startWhatsAppPaymentRequest(input.merchantId, async () => { posts++;return providerResult; }); },
      recoverPayment: async () => { assert.equal(currentWhatsAppExecution(), undefined); recoveries++;return null; },
    };
    const execute = withWhatsAppExecution(frame(() => obsolete), () => new ResumePaymentCreationService(repo, provider).execute(intent));
    try { await preparing.promise;obsolete = true; }
    finally { release.resolve(); }
    await assert.rejects(execute, /payment_creation_uncertain/);
    const uncertain = (await repo.getIntentById(intent.snapshot().merchantId, intent.id))!;
    assert.equal(uncertain.snapshot().creation?.state, "uncertain");assert.ok(uncertain.snapshot().creation?.firstAttemptAt);
    assert.equal(uncertain.snapshot().providerPaymentId, undefined);assert.equal(posts, 0);
    await withWhatsAppExecution(frame(() => true), () => new ResumePaymentCreationService(repo, provider).execute(uncertain));
    assert.equal(posts, 0);assert.equal(recoveries, 1);
  });
  await t.test("a late result cannot clear the fence using another worker's newer creation lease", async () => {
    const repo = new ProbeRepository(), intent = prepared(), started = deferred<void>(), finish = deferred<CreateProviderPaymentOutput>();
    await repo.saveIntent({ intent });let obsolete = false;
    const provider: PaymentProviderPort = { createPayment: () => { started.resolve();return finish.promise; } };
    const execute = withWhatsAppExecution(frame(() => obsolete), () => new ResumePaymentCreationService(repo, provider).execute(intent));
    await started.promise;
    await withoutWhatsAppExecutionForVerifiedOperation(async () => {
      const winner = (await repo.getIntentById(intent.snapshot().merchantId, intent.id))!;
      winner.markCreationUncertain(winner.snapshot().creation!.leaseToken!, "controlled-recovery");await repo.saveIntent({ intent: winner });
      assert.equal(winner.claimCreation("newer-worker-lease", new Date()), "recover");await repo.saveIntent({ intent: winner });
    });
    obsolete = true;finish.resolve(providerResult);
    const saved = await execute;
    assert.equal(saved.creation?.leaseToken, "newer-worker-lease");assert.equal(saved.status, "pending");
    assert.equal(saved.providerPaymentId, undefined);assert.equal(repo.capturedEvents.length, 0);
  });
});
