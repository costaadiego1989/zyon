import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPaymentRepository } from "../infrastructure/prisma-payment.repository.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { CancelPaymentIntentUseCase } from "./cancel-payment-intent.use-case.js";
import type { PaymentProviderPort } from "../domain/ports/payment-provider.port.js";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
describe("durable cancellation (disposable loopback PostgreSQL, simulated PSP)", { skip: !databaseUrl }, () => {
  let prisma: PrismaClient;
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "5433");
    assert.match(url.pathname, /^\/zyon_cancel_qa_20261006_[a-f0-9]{10}$/);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } }, transactionOptions: { maxWait: 30000, timeout: 15000 } });
    await prisma.$connect();
  });
  after(async () => { await prisma?.$disconnect(); });
  async function fixture() {
    const merchantId = `qa_cancel_${randomUUID()}`, sessionId = `session_${randomUUID()}`, repository = new PrismaPaymentRepository(prisma);
    await prisma.merchant.create({ data: { id: merchantId, name: "Isolated cancellation QA" } });
    const cart = { items: [], subtotal: 1947, total: 1947 };
    await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "buyer", conversationId: "qa", cart, createdAt: new Date(), updatedAt: new Date() } });
    const session = { merchantId, sessionId, globalUserId: "buyer", cart };
    const intent = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: "create", amountCents: 1947, currency: "BRL", method: "pix" });
    intent.prepareCreation({ provider: "mercadopago", providerAccountFingerprint: "fixture-account", merchantId, sessionId, intentId: intent.id, amountCents: 1947, currency: "BRL", method: "pix" });
    intent.claimCreation("first", new Date()); intent.markRequiresAction({ providerPaymentId: "1234" }); intent.completeCreation("first");
    intent.setBuyerFacingPayload({ qrCodeCopyPaste: "fixture-only" }); await repository.saveIntent({ intent });
    const request = { merchantId, sessionId, intentId: intent.id, idempotencyKey: "cancel", buyer: { globalUserId: "buyer", customer: { email: "qa@example.test", email_verified: true as const } } };
    let mutations = 0;
    const provider: PaymentProviderPort = { createPayment: async () => assert.fail("no payment creation"), readCancellationStatus: async () => ({ state: "pending" }),
      cancelPendingPayment: async () => { mutations++; return { state: "cancelled" }; } };
    const service = () => new CancelPaymentIntentUseCase(new PrismaPaymentRepository(prisma), { getSession: async () => session } as never, provider);
    const latest = async () => (await new PrismaPaymentRepository(prisma).getIntentById(merchantId, intent.id))!;
    const another = () => { const next = PaymentIntentEntity.create({ merchantId, sessionId, idempotencyKey: randomUUID(), amountCents: 1947, currency: "BRL", method: "pix" });
      next.prepareCreation({ ...intent.snapshot().creation!.input, intentId: next.id }); return next; };
    return { repository, session, intent, request, provider, service, latest, another, mutations: () => mutations };
  }
  async function seedHistoricalReady(intent: PaymentIntentEntity) {
    const s = intent.snapshot();
    await prisma.paymentIntent.create({ data: { id:s.id, merchantId:s.merchantId, sessionId:s.sessionId, idempotencyKey:s.idempotencyKey,
      amountCents:s.amountCents, currency:s.currency, method:s.method, status:s.status, version:1, creation:s.creation as never, statusHistory:s.statusHistory as never } });
    intent.persisted(1);
  }
  it("concurrent connections commit one remote mutation and one atomic cancellation outbox", async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.service().execute(f.request)));
    assert.equal(f.mutations(), 1); assert.ok(results.some(r => r.cancellation === "cancelled"));
    assert.equal((await f.latest()).snapshot().status, "cancelled");
    assert.equal((await f.latest()).snapshot().buyerFacing, undefined);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId: f.session.merchantId, eventType: "payment.status.changed" } }), 1);
    assert.deepEqual((await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: f.session.merchantId, sessionId: f.session.sessionId } } })).cart, f.session.cart);
  });
  it("restart recovery keeps the durable attempted marker and only reads after a timeout", async () => {
    const f = await fixture(); let writes = 0;
    f.provider.cancelPendingPayment = async () => { writes++; throw Error("simulated timeout after submission"); };
    assert.equal((await f.service().execute(f.request)).cancellation, "pending");
    const stored = await f.latest(); assert.ok(stored.snapshot().creation?.cancellation?.mutationAttemptedAt);
    f.provider.readCancellationStatus = async () => ({ state: "cancelled" });
    assert.equal((await f.service().execute({ ...f.request, idempotencyKey: "new-client-key" })).cancellation, "cancelled");
    assert.equal(writes, 1);
  });
  it("an approved webhook committed by another connection wins the cancellation CAS", async () => {
    const f = await fixture();
    f.provider.cancelPendingPayment = async () => {
      const approved = await f.latest(); approved.markApproved({ providerPaymentId: "1234", approvedAmountCents: 1947 });
      await new PrismaPaymentRepository(prisma).saveIntent({ intent: approved }); return { state: "cancelled" };
    };
    const result = await f.service().execute(f.request);
    assert.equal(result.status, "approved"); assert.equal(result.cancellation, "not_pending");
    assert.equal((await f.latest()).snapshot().approvedAmountCents, 1947);
    assert.equal(await prisma.outboxMessage.count({ where: { merchantId: f.session.merchantId } }), 0);
  });
  it("serializes a cancellation claim against first-send admission on independent connections", async () => {
    for (let round = 0; round < 8; round++) {
      const f = await fixture(), next = f.another(); await seedHistoricalReady(next);
      next.claimCreation("next-first", new Date());
      f.provider.readCancellationStatus = async () => ({ state: "unknown" });
      const results = await Promise.allSettled([f.service().execute(f.request), new PrismaPaymentRepository(prisma).saveIntent({ intent: next })]);
      const original = (await f.latest()).snapshot(), nextStored = (await f.repository.getIntentById(f.session.merchantId, next.id))!.snapshot();
      const cancelClaimed = original.creation?.cancellation !== undefined, nextClaimed = nextStored.creation?.state === "in_flight";
      assert.notEqual(cancelClaimed, nextClaimed, "exactly one admission may commit");
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    }
  });
  it("blocks fresh inserts and stale first-send writes after an uncertain cancellation", async () => {
    const f = await fixture(), admitted = f.another(); await seedHistoricalReady(admitted);
    f.provider.cancelPendingPayment = async () => ({ state: "unknown" }); await f.service().execute(f.request);
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent: f.another() }), /payment_cancellation_pending/);
    admitted.claimCreation("stale-first", new Date());
    await assert.rejects(new PrismaPaymentRepository(prisma).saveIntent({ intent: admitted }), /payment_cancellation_pending/);
    assert.equal(await prisma.paymentIntent.count({ where: { merchantId: f.session.merchantId } }), 2);
  });
});
