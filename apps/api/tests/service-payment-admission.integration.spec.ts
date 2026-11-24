import assert from "node:assert/strict";
import { composeOwnedSourceServiceRelease } from "./service-release-source-process.fixture.js";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import type { CheckoutSession } from "@zyon/shared-types";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { createServiceTestRedis } from "./service-test-redis.mjs";
import { seedServiceBookingFixture } from "./service-booking-fixtures.js";
import { PaymentIntentEntity } from "../src/modules/payment/domain/payment-intent.entity.js";
import type { PaymentProviderPort } from "../src/modules/payment/domain/ports/payment-provider.port.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { ResumePaymentCreationService } from "../src/modules/payment/application/resume-payment-creation.service.js";
import { ServiceSlotHoldsService } from "../src/shared/bookings/service-slot-holds.service.js";
import { paymentCartFingerprint } from "../src/modules/checkout/domain/services/payment-cart-fingerprint.js";
import { RedisServiceSlots } from "../src/shared/bookings/redis-service-slots.js";

test("T29 journal", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let raw: PrismaClient | undefined;
  let redisOwner: Awaited<ReturnType<typeof createServiceTestRedis>> | undefined, redis: Redis | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
  const releaseFixtureScope = composeOwnedSourceServiceRelease("matching"); t.after(() => releaseFixtureScope.close());
    raw = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const prisma = raw, now = new Date(); await seedServiceBookingFixture(prisma, now);
    // Scope these new journal selections to a Brasilia grade; leave the shared historical UTC seed unchanged.
    await prisma.serviceProfessional.updateMany({ where: { id: "booking-professional", merchantId: "booking-services" }, data: { timeZone: "America/Sao_Paulo" } });
    await prisma.professionalAvailability.updateMany({ where: { professionalId: "booking-professional", merchantId: "booking-services" }, data: { timeZone: "America/Sao_Paulo" } });
    await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { paymentMode: "online" } });
    let storeCalls = 0, creates = 0, recovers = 0, createUncertain = false;
    const noStore = () => { storeCalls++; throw new Error("synthetic_redis_offline"); };
    const repo = new PrismaPaymentRepository(prisma, undefined, undefined, undefined, noStore);
    const sessions = new PrismaCheckoutRepository(prisma), slots = new ServiceSlotHoldsService(prisma);
    const provider: PaymentProviderPort = {
      createPayment: async input => { creates++; if (createUncertain) throw new Error("synthetic_unknown_provider_result");
        return { providerPaymentId: "synthetic-" + input.intentId, buyerFacingPayload: { qrCodeCopyPaste: "SYNTHETIC-PIX-NOT-PAYABLE" } }; },
      recoverPayment: async input => { recovers++; return { providerPaymentId: "synthetic-" + input.intentId,
        buyerFacingPayload: { qrCodeCopyPaste: "SYNTHETIC-PIX-NOT-PAYABLE" } }; },
    };
    const resume = new ResumePaymentCreationService(repo, provider, slots, sessions);
    const prepared = async (sessionId: string, day: number, overrideCart?: CheckoutSession["cart"]) => {
      const date = new Date(now.getTime() + day * 86_400_000).toISOString().slice(0, 10);
      const cart: CheckoutSession["cart"] = overrideCart ?? { currency: "BRL", total: 50, source: "checkout", items: [{
        sku: "booking-short", product_id: "booking-short", variantId: "booking-short-variant", name: "Synthetic service", quantity: 1,
        price: 50, productType: "service", fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: {
          professionalId: "booking-professional", professionalVersion: 1, policyVersion: 1, date, slotId: "server-display-id",
          startsAt: date + "T13:00:00.000Z", endsAt: date + "T13:20:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 20 } }] };
      await prisma.checkoutSession.create({ data: { merchantId: "booking-services", sessionId, globalUserId: "synthetic-buyer",
        conversationId: sessionId, cart: JSON.parse(JSON.stringify(cart)), createdAt: now, updatedAt: now, customer: { fullName: "Synthetic buyer", phone: "+5521999990000" } } });
      const intent = PaymentIntentEntity.create({ merchantId: "booking-services", sessionId, idempotencyKey: sessionId,
        amountCents: 5000, currency: "BRL", method: "pix", amountBreakdown: { version: 1, currency: "BRL",
          cartFingerprint: paymentCartFingerprint({ cart }), itemsSubtotalCents: 5000, shippingCents: 0, discountCents: 0, platformFeeCents: 0, totalCents: 5000 } });
      intent.prepareCreation({ merchantId: "booking-services", sessionId, intentId: intent.id, provider: "asaas", amountCents: 5000,
        currency: "BRL", method: "pix", providerIdempotencyKey: sessionId, asaasCustomerId: "synthetic-customer" });
      return intent;
    };
    await t.test("online hold-off persists and dispatches once without touching Redis", async () => {
      const intent = await prepared("service-online-off", 2); await repo.saveIntent({ intent });
      const result = await resume.execute(intent);
      assert.equal(result.status, "requires_action"); assert.equal(creates, 1); assert.equal(recovers, 0); assert.equal(storeCalls, 0);
      const retry = await resume.execute((await repo.getIntentById("booking-services", intent.id))!);
      assert.equal(retry.providerPaymentId, result.providerPaymentId); assert.equal(creates, 1);
      assert.equal(await prisma.paymentIntent.count({ where: { sessionId: intent.snapshot().sessionId } }), 1);
      assert.equal(await prisma.serviceAppointment.count(), 0, "payment preparation is not capacity confirmation");
    });
    await t.test("local-payment policy cannot persist a new PSP journal", async () => {
      const intent = await prepared("service-local-refusal", 3);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { paymentMode: "at_attendance" } });
      await assert.rejects(repo.saveIntent({ intent }), /pay_at_attendance_required/);
      assert.equal(await prisma.paymentIntent.count({ where: { id: intent.id } }), 0); assert.equal(creates, 1);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { paymentMode: "online" } });
    });
    await t.test("FIRST SEND revalidates policy inside the real journal transaction", async () => {
      const intent = await prepared("service-first-send-policy", 4); await repo.saveIntent({ intent });
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 2 } });
      assert.equal(intent.claimCreation("synthetic-send-lease", now), "create");
      await assert.rejects(repo.saveIntent({ intent }), /service_policy_changed/);
      const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      assert.equal(JSON.parse(JSON.stringify(stored.creation)).state, "ready");
      assert.equal(JSON.parse(JSON.stringify(stored.creation)).firstAttemptAt, undefined); assert.equal(creates, 1);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 1 } });
    });
    await t.test("uncertain dispatched payment recovers after policy changes without another create", async () => {
      const intent = await prepared("service-uncertain-recovery", 5); await repo.saveIntent({ intent });
      createUncertain = true; await assert.rejects(resume.execute(intent), /payment_creation_uncertain/); createUncertain = false;
      const uncertain = (await repo.getIntentById("booking-services", intent.id))!;
      assert.equal(uncertain.snapshot().creation?.state, "uncertain"); assert.equal(creates, 2);
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { admissionsEnabled: false,
        paymentMode: "at_attendance", version: 2 } });
      const result = await resume.execute(uncertain);
      assert.equal(result.status, "requires_action"); assert.equal(creates, 2); assert.equal(recovers, 1);
      assert.equal(await prisma.paymentIntent.count({ where: { sessionId: intent.snapshot().sessionId } }), 1);
      assert.equal(await prisma.serviceAppointment.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
    });
    await t.test("an actual unscheduled service can prepare payment while booking admissions remain closed", async () => {
      await prisma.product.create({ data: { id: "payment-unscheduled", merchantId: "booking-services", name: "Synthetic unscheduled service", type: "service" } });
      await prisma.productVariant.create({ data: { id: "payment-unscheduled-variant", productId: "payment-unscheduled", sku: "PAYMENT-UNSCHEDULED",
        price: { create: { basePriceInCents: 5000, currency: "BRL" } } } });
      const legacy: CheckoutSession["cart"] = { currency: "BRL", total: 50, items: [{ sku: "PAYMENT-UNSCHEDULED", product_id: "payment-unscheduled",
        variantId: "payment-unscheduled-variant", name: "Synthetic unscheduled service", quantity: 1, price: 50, productType: "service", fulfillmentStrategy: "service" }] };
      const beforeCreates = creates, intent = await prepared("payment-unscheduled", 6, legacy);
      await repo.saveIntent({ intent }); const result = await resume.execute(intent);
      assert.equal(result.status, "requires_action"); assert.equal(creates, beforeCreates + 1); assert.equal(storeCalls, 0);
      assert.equal((await prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: "booking-services" } })).admissionsEnabled, false);
      assert.equal(await prisma.serviceAppointment.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
    });
    await t.test("journal summary rejects changed fingerprint, coherent subtotal and currency with no partial writes", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { admissionsEnabled: true, paymentMode: "online", version: 1 } });
      for (const mismatch of ["fingerprint", "subtotal", "currency", "discount", "shipping"] as const) {
        const intent = await prepared("payment-summary-" + mismatch, 7), snapshot = intent.snapshot();
        if (mismatch === "fingerprint") snapshot.amountBreakdown!.cartFingerprint = "fabricated-fingerprint";
        if (mismatch === "subtotal") { snapshot.amountCents = 4000; snapshot.amountBreakdown!.itemsSubtotalCents = 4000;
          snapshot.amountBreakdown!.totalCents = 4000; snapshot.creation!.input.amountCents = 4000; }
        if (mismatch === "currency") { snapshot.currency = "USD"; snapshot.amountBreakdown!.currency = "USD"; snapshot.creation!.input.currency = "USD"; }
        if (mismatch === "discount") { snapshot.amountCents = 4000; snapshot.amountBreakdown!.discountCents = 1000;
          snapshot.amountBreakdown!.totalCents = 4000; snapshot.creation!.input.amountCents = 4000; }
        if (mismatch === "shipping") { snapshot.amountCents = 5500; snapshot.amountBreakdown!.shippingCents = 500;
          snapshot.amountBreakdown!.totalCents = 5500; snapshot.creation!.input.amountCents = 5500; }
        const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: "booking-services", sessionId: snapshot.sessionId } } });
        const beforeCreates = creates;
        await assert.rejects(repo.saveIntent({ intent: PaymentIntentEntity.rehydrate(snapshot) }), /service_checkout_summary_changed/);
        assert.equal(await prisma.paymentIntent.count({ where: { id: snapshot.id } }), 0); assert.equal(creates, beforeCreates);
        assert.deepEqual(await prisma.checkoutSession.findUnique({ where: { id: saved.id } }), saved);
      }
      assert.equal(storeCalls, 0); assert.equal(await prisma.serviceAppointment.count(), 0);
    });
    await t.test("a canonical scheduled offer cannot bypass professional admission through stored body labels", async () => {
      for (const label of ["service", "physical", "missing-variant"] as const) {
        const intent = await prepared("payment-missing-professional-" + label, 8), snapshot = intent.snapshot();
        const saved = await prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: "booking-services", sessionId: snapshot.sessionId } } });
        const cart = JSON.parse(JSON.stringify(saved.cart)) as CheckoutSession["cart"];
        cart.items[0]!.productType = label === "service" ? "service" : "physical";
        cart.items[0]!.fulfillmentStrategy = label === "service" ? "service" : "carrier";
        if (label === "missing-variant") delete cart.items[0]!.variantId;
        delete cart.items[0]!.fulfillmentSchedule;
        await prisma.checkoutSession.update({ where: { id: saved.id }, data: { cart: JSON.parse(JSON.stringify(cart)) } });
        await assert.rejects(repo.saveIntent({ intent }), /service_professional_selection_required/);
        assert.equal(await prisma.paymentIntent.count({ where: { id: intent.id } }), 0);
      }
      assert.equal(await prisma.serviceAppointment.count(), 0);
    });
    await t.test("FIRST SEND waits for the actual merchant writer and rereads policy before any provider attempt", async () => {
      const intent = await prepared("payment-first-send-merchant-race", 12); await repo.saveIntent({ intent });
      assert.equal(intent.claimCreation("synthetic-policy-race-lease", new Date()), "create");
      let locked!: () => void, rejectLock!: (error: unknown) => void, release!: () => void, holderPid = 0, settled = false;
      const hasLock = new Promise<void>((resolve, reject) => { locked = resolve; rejectLock = reject; });
      const releaseWriter = new Promise<void>(resolve => { release = resolve; });
      const writer = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${"booking-services"} FOR UPDATE`;
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        locked(); await releaseWriter;
        await tx.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 2 } });
      });
      void writer.catch(rejectLock);
      let pending: Promise<void> | undefined;
      try {
        await hasLock; assert.ok(Number.isInteger(holderPid) && holderPid > 0);
        pending = repo.saveIntent({ intent }).finally(() => { settled = true; }); void pending.catch(() => {});
        const deadline = Date.now() + 2000; let blocked = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query ILIKE '%merchants%'
            AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
          if (rows.length) { blocked = true; break; }
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        assert.equal(blocked, true, "actual payment waits on the exact merchant holder PID"); assert.equal(settled, false);
        release(); await writer; const beforeCreates = creates;
        await assert.rejects(pending, /service_policy_changed/);
        const saved = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
        const creation = JSON.parse(JSON.stringify(saved.creation));
        assert.equal(creation.state, "ready"); assert.equal(creation.firstAttemptAt, undefined); assert.equal(saved.providerPaymentId, null);
        assert.equal(creates, beforeCreates);
      } finally {
        release(); await Promise.allSettled([writer, ...(pending ? [pending] : [])]);
        await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: { version: 1 } });
      }
    });
    await t.test("online hold-on uses the actual owned Redis lease and retries without another provider create", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "booking-services" }, data: {
        admissionsEnabled: true, holdEnabled: true, holdMinutes: 4, paymentMode: "online", version: 1 } });
      redisOwner = await createServiceTestRedis(); redis = new Redis(redisOwner.url, { lazyConnect: true, maxRetriesPerRequest: 1,
        commandTimeout: 3000, connectTimeout: 3000, enableOfflineQueue: false });
      await redis.connect(); assert.equal(await redis.get("aacp:synthetic:run"), redisOwner.runId);
      const store = new RedisServiceSlots(redis), heldSlots = new ServiceSlotHoldsService(prisma, store);
      const heldRepo = new PrismaPaymentRepository(prisma, undefined, undefined, undefined, () => store);
      const heldResume = new ResumePaymentCreationService(heldRepo, provider, heldSlots, sessions);
      const intent = await prepared("payment-online-held", 9), session = (await sessions.getSession("booking-services", "payment-online-held"))!;
      const redisBefore = await redis.time();
      const beforeMs = Number(redisBefore[0]) * 1000 + Math.floor(Number(redisBefore[1]) / 1000);
      const held = await heldSlots.acquire(session); assert.ok(held); assert.equal(held.slots[0].resourceId, "professional:booking-professional");
      const redisAfter = await redis.time();
      const afterMs = Number(redisAfter[0]) * 1000 + Math.floor(Number(redisAfter[1]) / 1000);
      const expiresAt = Date.parse(held.expiresAt);
      assert.ok(expiresAt >= beforeMs + 4 * 60_000 && expiresAt <= afterMs + 4 * 60_000);
      const ttl = await redis.pttl(store.checkoutKey("booking-services", session.sessionId)); assert.ok(ttl > 0);
      await heldRepo.saveIntent({ intent }); const beforeCreates = creates, result = await heldResume.execute(intent);
      assert.equal(result.status, "requires_action"); assert.equal(creates, beforeCreates + 1);
      assert.equal((await heldResume.execute((await heldRepo.getIntentById("booking-services", intent.id))!)).providerPaymentId, result.providerPaymentId);
      assert.equal(creates, beforeCreates + 1); assert.equal(await prisma.serviceAppointment.count(), 0);
      await store.release("booking-services", session.sessionId);
      for (const fault of ["missing", "foreign", "expired"] as const) {
        const refused = await prepared("payment-held-" + fault, 10), selected = (await sessions.getSession("booking-services", "payment-held-" + fault))!;
        if (fault !== "missing") {
          const lease = await heldSlots.acquire(selected); assert.ok(lease);
          if (fault === "foreign") {
            await store.release("booking-services", selected.sessionId);
            await store.acquire("booking-services", "foreign-owner", lease.slots, 4 * 60_000);
          } else {
            const key = store.checkoutKey("booking-services", selected.sessionId), previous = await redis.get(key); assert.ok(previous);
            const expired = JSON.parse(previous); expired.expiresAt = 1;
            await redis.set(key, JSON.stringify(expired), "PX", 4 * 60_000);
            await redis.hset(store.resourceKey("booking-services", "professional:booking-professional"), expired.owner, JSON.stringify(expired));
          }
        }
        const before = creates;
        await assert.rejects(heldRepo.saveIntent({ intent: refused }), /hold_expired/);
        assert.equal(await prisma.paymentIntent.count({ where: { id: refused.id } }), 0); assert.equal(creates, before);
        await store.release("booking-services", selected.sessionId); await store.release("booking-services", "foreign-owner");
      }
      const ready = await prepared("payment-held-first-send-expiry", 11), selected = (await sessions.getSession("booking-services", "payment-held-first-send-expiry"))!;
      await heldSlots.acquire(selected); await heldRepo.saveIntent({ intent: ready });
      const key = store.checkoutKey("booking-services", selected.sessionId), previous = await redis.get(key); assert.ok(previous);
      const expired = JSON.parse(previous); expired.expiresAt = 1;
      await redis.set(key, JSON.stringify(expired), "PX", 4 * 60_000);
      await redis.hset(store.resourceKey("booking-services", "professional:booking-professional"), expired.owner, JSON.stringify(expired));
      assert.equal(ready.claimCreation("synthetic-expired-first-send", new Date()), "create");
      const before = creates;
      await assert.rejects(heldRepo.saveIntent({ intent: ready }), /hold_expired/);
      const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: ready.id } });
      assert.equal(JSON.parse(JSON.stringify(stored.creation)).state, "ready"); assert.equal(stored.providerPaymentId, null);
      assert.equal(creates, before); assert.equal(await prisma.serviceAppointment.count(), 0); assert.equal(await prisma.inventoryMovement.count(), 0);
    });
  } finally {
    const errors: unknown[] = [];
    try { if (raw) await raw.$disconnect(); } catch (error) { errors.push(error); }
    try { if (redis) { try { await redis.quit(); } finally { redis.disconnect(); } } } catch (error) { errors.push(error); }
    try { if (redisOwner) await redisOwner.dispose(); } catch (error) { errors.push(error); }
    try { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "owned_service_payment_cleanup_failed");
  }
  assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
});
