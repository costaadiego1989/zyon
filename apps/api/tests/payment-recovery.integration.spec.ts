import "reflect-metadata";
import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { ResumePaymentCreationService } from "../src/modules/payment/application/resume-payment-creation.service.js";
import { CheckoutPaymentAdapter } from "../src/modules/payment/infrastructure/checkout-payment.adapter.js";
import { createCheckoutEventEnvelope } from "../src/modules/checkout/domain/events/checkout-domain-event.js";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
describe("payment recovery, CAS and additive migration (PostgreSQL)", { skip: !databaseUrl || !clientPath }, () => {
  const schema = `payment_test_${randomUUID().replaceAll("-", "")}`;
  let prisma: any; let replica: any; let admin: any;
  let repo: PrismaPaymentRepository; let other: PrismaPaymentRepository;
  const merchantId = "payment_test_merchant";
  const event = (id: string, status = "approved") => createCheckoutEventEnvelope({ eventType: "payment.status.changed", merchantId,
    payload: { payment_intent_id: id, status } });
  const prepared = (key = "same-key", method: "pix" | "crypto" = "pix") => {
    const intent = PaymentIntentEntity.create({ merchantId, sessionId: "session_one", idempotencyKey: key, amountCents: 1000, currency: "BRL", method,
      amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 900, discountCents: 0, shippingCents: 100, platformFeeCents: 0, totalCents: 1000 } });
    intent.prepareCreation({ merchantId, sessionId: "session_one", intentId: intent.id, amountCents: 1000, currency: "BRL", method, providerIdempotencyKey: key });
    return intent;
  };
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)); assert.equal(url.pathname, "/ready_prod_test");
    const { Client } = createRequire(import.meta.url)("pg");
    admin = new Client({ connectionString: databaseUrl }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["payment_intents", "outbox_messages", "payment_crypto_transfers", "checkout_sessions", "checkout_events"]) {
      await admin.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    url.searchParams.set("schema", schema);
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    replica = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    repo = new PrismaPaymentRepository(prisma); other = new PrismaPaymentRepository(replica);
  });
  beforeEach(async () => {
    for (const table of ["payment_intents", "outbox_messages", "payment_crypto_transfers", "checkout_sessions", "checkout_events"]) {
      await admin.query(`DELETE FROM "${schema}".${table}`);
    }
  });
  after(async () => {
    await prisma?.$disconnect(); await replica?.$disconnect();
    if (admin) { assert.match(schema, /^payment_test_[a-f0-9]{32}$/); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
  });

  it("twenty concurrent reservations elect one immutable local intent", async () => {
    const intents = Array.from({ length: 20 }, () => prepared());
    const results = await Promise.allSettled(intents.map((intent, n) => (n % 2 ? repo : other).saveIntent({ intent })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    for (const r of results) if (r.status === "rejected") assert.match(String(r.reason), /payment_intent_concurrent_change/);
    assert.equal(await prisma.paymentIntent.count(), 1);
  });

  it("stale terminal transitions cannot overwrite the CAS winner or append losing events", async () => {
    const initial = prepared(); await repo.saveIntent({ intent: initial });
    const copies = await Promise.all(Array.from({ length: 20 }, (_, n) => (n % 2 ? repo : other).getIntentById(merchantId, initial.id)));
    const results = await Promise.allSettled(copies.map((intent, n) => {
      if (n % 3 === 0) intent!.markApproved({ providerPaymentId: "provider_one", approvedAmountCents: 1000 });
      else if (n % 3 === 1) intent!.markFailed(); else intent!.markCancelled();
      return (n % 2 ? repo : other).saveIntentWithOutbox({ intent: intent! }, event(initial.id, intent!.status));
    }));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(await prisma.outboxMessage.count(), 1);
    assert.equal((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: initial.id } })).version, 2);
    const changed = (await repo.getIntentById(merchantId, initial.id))!.snapshot();
    changed.amountCents++;
    await assert.rejects(repo.saveIntent({ intent: PaymentIntentEntity.rehydrate(changed) }), /immutable_fields_changed/);
  });

  it("a real outbox insertion error rolls back status, history and entity version", async () => {
    const intent = prepared(); await repo.saveIntent({ intent });
    const before = (await repo.getIntentById(merchantId, intent.id))!.snapshot(); intent.markApproved({ providerPaymentId: "provider_one", approvedAmountCents: 1000 });
    await admin.query(`ALTER TABLE "${schema}".outbox_messages ADD CONSTRAINT test_reject_outbox CHECK (event_type <> 'payment.status.changed')`);
    try {
      await assert.rejects(repo.saveIntentWithOutbox({ intent }, event(intent.id)));
      assert.deepEqual((await repo.getIntentById(merchantId, intent.id))!.snapshot(), before);
      assert.equal(intent.snapshot().version, before.version); assert.equal(await prisma.outboxMessage.count(), 0);
    } finally { await admin.query(`ALTER TABLE "${schema}".outbox_messages DROP CONSTRAINT test_reject_outbox`); }
  });

  it("twenty replicas resume a reserved intent once and recover a crashed lease without re-creation", async () => {
    const intent = prepared(); await repo.saveIntent({ intent }); let creates = 0; let recoveries = 0;
    const provider = { createPayment: async () => { creates++; return { providerPaymentId: "provider_one", status: "requires_action" as const }; },
      recoverPayment: async () => { recoveries++; return { providerPaymentId: "provider_one", status: "requires_action" as const }; } };
    const copies = await Promise.all(Array.from({ length: 20 }, () => repo.getIntentById(merchantId, intent.id)));
    await Promise.all(copies.map((copy, n) => new ResumePaymentCreationService(n % 2 ? repo : other, provider).execute(copy!)));
    assert.equal(creates, 1); assert.equal(await prisma.outboxMessage.count(), 1);
    const crashed = prepared("crash-key"); await repo.saveIntent({ intent: crashed });
    crashed.claimCreation("worker-died", new Date(Date.now() - 120_000)); await repo.saveIntent({ intent: crashed });
    provider.recoverPayment = async () => { recoveries++; return { providerPaymentId: "provider_recovered", status: "requires_action" as const }; };
    const result = await new ResumePaymentCreationService(other, provider).execute((await other.getIntentById(merchantId, crashed.id))!);
    assert.equal(result.providerPaymentId, "provider_recovered"); assert.equal(creates, 1); assert.equal(recoveries, 1);
  });

  it("accepted provider result survives a failed local commit and recovers with no second POST", async () => {
    const intent = prepared(); await repo.saveIntent({ intent }); let creates = 0; let recoveries = 0;
    const provider = { createPayment: async () => { creates++; return { providerPaymentId: "provider_one", status: "requires_action" as const }; },
      recoverPayment: async () => { recoveries++; return { providerPaymentId: "provider_one", status: "requires_action" as const }; } };
    await admin.query(`ALTER TABLE "${schema}".outbox_messages ADD CONSTRAINT test_reject_outbox CHECK (event_type <> 'payment.status.changed')`);
    try { await assert.rejects(new ResumePaymentCreationService(repo, provider).execute(intent), /payment_creation_uncertain/); }
    finally { await admin.query(`ALTER TABLE "${schema}".outbox_messages DROP CONSTRAINT test_reject_outbox`); }
    assert.equal((await other.getIntentById(merchantId, intent.id))!.snapshot().creation?.state, "uncertain");
    const result = await new ResumePaymentCreationService(other, provider).execute((await other.getIntentById(merchantId, intent.id))!);
    assert.equal(result.status, "requires_action"); assert.equal(creates, 1); assert.equal(recoveries, 1); assert.equal(await prisma.outboxMessage.count(), 1);
  });

  it("compensation and expiration preserve approved and refunded crypto hashes", async () => {
    const intent = prepared("crypto-key", "crypto"); await repo.saveIntent({ intent });
    const key = { chain: "base", txHash: "0xone", merchantId, intentId: intent.id };
    assert.equal(await repo.recordCryptoTransfer(key), true);
    intent.markApproved({ providerPaymentId: "0xone", approvedAmountCents: 1000 }); await repo.saveIntentWithOutbox({ intent }, event(intent.id));
    await repo.deleteCryptoTransfer(key);
    assert.equal(await other.recordCryptoTransfer({ ...key, intentId: "another" }), false);
    intent.markRefunded(); await repo.saveIntent({ intent });
    await prisma.paymentCryptoTransfer.updateMany({ data: { expiresAt: new Date(0) } });
    await repo.deleteCryptoTransfer(key); assert.equal(await repo.reapExpiredCryptoReservations(), 0);
    assert.equal(await prisma.paymentCryptoTransfer.count(), 1);
  });

  it("compensation cannot free a hash while another verifier can still approve", async () => {
    const intent = prepared("racing-crypto", "crypto"); await repo.saveIntent({ intent });
    const key = { chain: "base", txHash: "0xrace", merchantId, intentId: intent.id };
    await repo.recordCryptoTransfer(key);
    const staleVerifier = (await other.getIntentById(merchantId, intent.id))!;
    await repo.deleteCryptoTransfer(key);
    assert.equal(await repo.reapExpiredCryptoReservations(), 0);
    assert.equal(await repo.recordCryptoTransfer({ ...key, intentId: "another-intent" }), false);
    staleVerifier.markApproved({ providerPaymentId: "0xrace", approvedAmountCents: 1000 });
    await other.saveIntent({ intent: staleVerifier });
    assert.equal(await prisma.paymentCryptoTransfer.count(), 1);
    const cancelled = prepared("cancelled-crypto", "crypto"); await repo.saveIntent({ intent: cancelled });
    const cancelledKey = { ...key, txHash: "0xcancelled", intentId: cancelled.id };
    await repo.recordCryptoTransfer(cancelledKey); cancelled.markCancelled(); await repo.saveIntent({ intent: cancelled });
    await repo.deleteCryptoTransfer(cancelledKey);
    assert.equal(await prisma.paymentCryptoTransfer.count({ where: { txHash: "0xcancelled" } }), 0);
  });

  it("concurrent immediate and durable completions append one notification without replacing the cart", async () => {
    const cart = { currency: "BRL", items: [{ sku: "new-cart" }], total: 42 };
    await prisma.checkoutSession.create({ data: { merchantId, sessionId: "session_one", globalUserId: "buyer", conversationId: "conversation", cart,
      chatHistory: [], createdAt: new Date(), updatedAt: new Date() } });
    let completions = 0;
    const bus = { publish: async () => { completions++; } } as any;
    const one = new CheckoutPaymentAdapter({} as any, {} as any, bus, prisma);
    const two = new CheckoutPaymentAdapter({} as any, {} as any, bus, replica);
    const input = { merchantId, sessionId: "session_one", paymentIntentId: "intent_one", externalOrderId: "provider_one", orderTotalMajorUnits: 10, currency: "BRL" as const };
    await Promise.all(Array.from({ length: 20 }, (_, n) => (n % 2 ? one : two).completeAfterApproval(input)));
    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId, sessionId: "session_one" } } });
    assert.equal(completions, 20); assert.equal(row.chatHistory.length, 1); assert.deepEqual(row.cart, cart);
    assert.equal(await prisma.checkoutEvent.count(), 1);
    await new CheckoutPaymentAdapter({} as any, {} as any, bus, prisma).completeAfterApproval(input);
    assert.equal((await prisma.checkoutSession.findFirst()).chatHistory.length, 1);
  });

  it("actual additive SQL preserves old rows and enforces nonnegative versions", async () => {
    const migrationSchema = `${schema}_migration`;
    await admin.query(`CREATE SCHEMA "${migrationSchema}"`);
    try {
      await admin.query(`SET search_path TO "${migrationSchema}"`);
      await admin.query("CREATE TABLE payment_intents (id TEXT PRIMARY KEY, status TEXT NOT NULL)");
      await admin.query("INSERT INTO payment_intents VALUES ('legacy', 'requires_action')");
      await admin.query(readFileSync(new URL("../prisma/migrations/20260906010000_payment_recovery_cas/migration.sql", import.meta.url), "utf8"));
      assert.deepEqual((await admin.query("SELECT * FROM payment_intents")).rows[0], { id: "legacy", status: "requires_action", version: 0, amount_breakdown: null, creation: null });
      await assert.rejects(admin.query("UPDATE payment_intents SET version = -1"), /payment_intents_version_nonnegative/);
    } finally { await admin.query("RESET search_path"); await admin.query(`DROP SCHEMA "${migrationSchema}" CASCADE`); }
  });
});
