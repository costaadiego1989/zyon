import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { PaymentIntentConflictError } from "../src/modules/payment/domain/payment-persistence.js";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServiceTestRuntime } from "./service-test-runtime.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { ownedAsaasCancellation } from "./asaas-owned-cancellation.fixture.js";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { CancelCheckoutPaymentUseCase } from "../src/modules/payment/application/cancel-checkout-payment.use-case.js";
import { CancelPaymentIntentUseCase } from "../src/modules/payment/application/cancel-payment-intent.use-case.js";

// Direct canonical cancellation/journal SQL proof, not HTTP buyer authentication,
// a live PSP cancellation or complete storefront/WhatsApp S5 acceptance.
test("S5 Asaas strict card cancellation real owned SQL journal", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const replacementRefused = (error: unknown) => error instanceof PaymentIntentConflictError || error instanceof ConflictException && error.message === "payment_cancellation_pending";
  const runtime = await createServiceTestRuntime({ local: true }); let db: PrismaClient | undefined;
  try {
    db = new PrismaClient({ datasources: { db: { url: runtime.db.prismaUrl } } }); const prisma = db;
    assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM synthetic_native_marker`, [{ run_id: runtime.db.runId }]);
    const payments = new PrismaPaymentRepository(prisma), sessions = new PrismaCheckoutRepository(prisma);
    async function fixture() {
      const merchantId = "cancel_" + randomUUID().replaceAll("-", ""), sessionId = "session_" + randomUUID().replaceAll("-", ""), buyerId = "buyer_" + randomUUID().replaceAll("-", "");
      await prisma.merchant.create({ data: { id: merchantId, name: "Owned cancellation fixture" } });
      await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: buyerId, conversationId: "conversation_" + sessionId,
        cart: { source: "checkout", currency: "BRL", total: 50, items: [] }, customer: { email: "buyer@example.test", email_verified: true } } });
      const intent = PaymentIntentEntity.create({ merchantId, sessionId, method: "card", amountCents: 5000, currency: "BRL", idempotencyKey: "original" });
      const transport = ownedAsaasCancellation({ merchantId, sessionId, intentId: intent.id }, "card");
      intent.prepareCreation(transport.input); intent.claimCreation("owned-create", new Date()); intent.completeCreation("owned-create"); intent.markRequiresAction({ providerPaymentId: transport.providerId }); await payments.saveIntent({ intent });
      const useCase = new CancelCheckoutPaymentUseCase(payments, new CancelPaymentIntentUseCase(payments, sessions, transport.router));
      const buyer = { globalUserId: buyerId, customer: { email: "buyer@example.test", email_verified: true as const } };
      const current = async () => (await payments.getIntentById(merchantId, intent.id))!.snapshot();
      const next = () => PaymentIntentEntity.create({ merchantId, sessionId, method: "pix", amountCents: 5000, currency: "BRL", idempotencyKey: "replacement" });
      transport.state.beforeCall = async () => { if (transport.calls.at(-1)?.method === "DELETE") assert.ok((await current()).creation?.cancellation?.mutationAttemptedAt); };
      const events = () => prisma.outboxMessage.findMany({ where: { merchantId, eventType: "payment.status.changed", causationId: intent.id }, select: { eventId: true, eventType: true, payload: true, causationId: true }, orderBy: { eventId: "asc" } });
      return { merchantId, sessionId, intent, transport, useCase, buyer, current, next, events, cancel: () => useCase.execute(merchantId, sessionId, buyer) };
    }
    await t.test("confirmed original unpaid card cancellation commits once and permits the replacement Pix journal", async () => {
      const f = await fixture(); f.transport.success(); await f.cancel(); assert.equal((await f.current()).status, "cancelled"); assert.equal((await f.events()).length, 1);
      const before = await f.events(); await f.cancel(); assert.deepEqual(await f.events(), before); assert.deepEqual(f.transport.calls.map(call => call.method), ["GET", "GET", "DELETE", "GET"]);
      await payments.saveIntent({ intent: f.next() }); assert.equal((await payments.listForSession(f.merchantId, f.sessionId)).length, 2);
    });
    await t.test("unknown DELETE persists the first-attempt marker, blocks new journal and retries GET only", async () => {
      const f = await fixture(); f.transport.enqueue(f.transport.body()); f.transport.enqueue(f.transport.body()); f.transport.enqueue({ errors: [] }, 500);
      await assert.rejects(f.cancel(), /checkout_payment_cancellation_unconfirmed/); const first = await f.current(); assert.equal(first.status, "requires_action"); assert.ok(first.creation?.cancellation?.mutationAttemptedAt);
      await assert.rejects(payments.saveIntent({ intent: f.next() }), replacementRefused); assert.equal((await payments.listForSession(f.merchantId, f.sessionId)).length, 1);
      f.transport.enqueue(f.transport.body()); await assert.rejects(f.cancel(), /checkout_payment_cancellation_unconfirmed/);
      assert.equal(f.transport.calls.filter(call => call.method === "DELETE").length, 1); assert.equal((await f.current()).creation?.cancellation?.mutationAttemptedAt, first.creation?.cancellation?.mutationAttemptedAt);
      assert.deepEqual(await f.events(), []);
    });
    await t.test("a real outbox failure rolls back cancelled journal and event while preserving the pre-DELETE marker and replacement fence", async () => {
      const f = await fixture(); assert.match(f.intent.id, /^[A-Za-z0-9_-]+$/); f.transport.success();
      await prisma.$executeRawUnsafe("CREATE FUNCTION s5_cancellation_outbox_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.causation_id='" + f.intent.id + "' AND NEW.event_type='payment.status.changed' THEN RAISE EXCEPTION 'owned_s5_cancellation_outbox_failure'; END IF; RETURN NEW; END $$");
      await prisma.$executeRawUnsafe("CREATE TRIGGER s5_cancellation_outbox_fail BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION s5_cancellation_outbox_fail()");
      try {
        await assert.rejects(f.cancel(), /owned_s5_cancellation_outbox_failure/);
        const current = await f.current(); assert.equal(current.status, "requires_action"); assert.ok(current.creation?.cancellation?.mutationAttemptedAt);
        assert.notEqual(current.creation?.cancellation?.state, "cancelled"); assert.deepEqual(await f.events(), []);
        await assert.rejects(payments.saveIntent({ intent: f.next() }), replacementRefused); assert.equal((await payments.listForSession(f.merchantId, f.sessionId)).length, 1);
        assert.equal(f.transport.calls.filter(call => call.method === "DELETE").length, 1);
        // No fabricated lease expiry or immediate successful replay: the real
        // in-flight journal remains uncertain until normal canonical recovery.
      } finally { await prisma.$executeRawUnsafe("DROP TRIGGER s5_cancellation_outbox_fail ON outbox_messages"); await prisma.$executeRawUnsafe("DROP FUNCTION s5_cancellation_outbox_fail()"); }
    });
    await t.test("foreign buyer denial leaves persisted journal/events unchanged and makes no provider call", async () => {
      const f = await fixture(), before = await f.current(); await assert.rejects(f.useCase.execute(f.merchantId, f.sessionId, { ...f.buyer, globalUserId: "foreign" }), /payment_cancellation_buyer_mismatch/);
      assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), []); assert.equal(f.transport.calls.length, 0);
    });
    assert.equal(runtime.evidence().providerCalls, 0); assert.equal(runtime.evidence().authOverrides, false); assert.equal(runtime.evidence().repositoryOverrides, false);
  } finally {
    const errors: unknown[] = []; try { await db?.$disconnect(); } catch (error) { errors.push(error); }
    try { await runtime.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_asaas_cancellation_native_cleanup_failed");
    assert.deepEqual(runtime.cleanupEvidence(), { appClosed: true, remainingContainers: 0, remainingBridgeSockets: 0 });
  }
});
