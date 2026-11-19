import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../src/shared/events/domain-event-bus.port.js";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { seedApprovedProfessionalCase } from "./service-approved-order.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { ReconcileServicePaymentUseCase } from "../src/modules/payment/application/reconcile-service-payment.use-case.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { HandleAsaasWebhookUseCase } from "../src/modules/payment/application/handle-asaas-webhook.use-case.js";
import { PaymentDispatchService } from "../src/modules/payment/application/services/payment-dispatch.service.js";
import { PrismaPaymentRepository } from "../src/modules/payment/infrastructure/prisma-payment.repository.js";
import { CheckoutPaymentAdapter } from "../src/modules/payment/infrastructure/checkout-payment.adapter.js";
import { PrismaOutboxRepository } from "../src/shared/messaging/infrastructure/prisma-outbox.repository.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentApprovalReader } from "../src/modules/checkout/infrastructure/adapters/prisma-payment-approval.reader.js";
import { PaymentApprovedHandler } from "../src/modules/checkout/application/handlers/payment-approved.handler.js";
import { CompleteOrderUseCase } from "../src/modules/checkout/application/use-cases/complete-order.use-case.js";

test("T36 real approval producer and durable payment reconciliation", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture(), tenant = new TenantContextService();
  const command = new ReconcileServicePaymentUseCase(f.prisma, new InMemoryDomainEventBus(), tenant);
  const scopedSnapshot = async (c: any) => ({ payment: await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } }),
    appointments: await f.prisma.serviceAppointment.findMany({ where: { merchantId: c.merchantId, orderId: c.order.id } }),
    notices: await f.prisma.merchantNotification.findMany({ where: { merchantId: c.merchantId, type: "service_payment_regularization" }, orderBy: { id: "asc" } }) });
  const eventFor = (c: any, token?: string): DomainEvent => {
    const event: DomainEvent = { eventId: "late-event-" + c.payment.id, eventType: "payment.status.changed", schemaVersion: 1,
      merchantId: c.merchantId, correlationId: "late-correlation-" + c.payment.id, causationId: c.payment.id,
      payload: { session_id: c.sessionId, payment_intent_id: c.payment.id, status: "approved" } };
    if (token) Object.defineProperty(event, "deliveryLeaseToken", { value: token, enumerable: false }); return event;
  };
  try {
    await t.test("a valid webhook records approval once and the served claimed worker processes it after admissions are disabled", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-webhook"), token = "synthetic-local-asaas-hook-token";
      await f.prisma.completedOrder.delete({ where: { id: c.order.id } });
      await f.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: c.merchantId, sessionId: c.sessionId } }, data: {
        cart: { currency: "BRL", total: 50, currentDiscount: 0, items: [{ sku: c.product.variants[0].sku, product_id: c.product.id,
          variantId: c.selected.variantId, name: "Synthetic late service", quantity: 1, price: 50, productType: "service",
          fulfillmentStrategy: "scheduled_service", fulfillmentSchedule: c.schedule }] } } });
      await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { status: "pending", approvedAmountCents: null } });
      const policy = await f.prisma.serviceBusinessPolicy.findUniqueOrThrow({ where: { merchantId: c.merchantId } });
      const disabled = await f.request("/merchants/me/service-business-policy", { expectedVersion: policy.version, paymentMode: "online",
        admissionsEnabled: false, holdEnabled: false }, f.owner, "PUT"); assert.equal(disabled.status, 200);
      const bus = new InMemoryDomainEventBus(), payments = new PrismaPaymentRepository(f.prisma), repository = new PrismaCheckoutRepository(f.prisma);
      const complete = new CompleteOrderUseCase(repository, repository, repository, undefined, undefined, undefined, undefined, repository,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(f.prisma));
      new PaymentApprovedHandler(bus, complete).onModuleInit();
      const checkout = new CheckoutPaymentAdapter(repository, new PrismaOutboxRepository(f.prisma), bus, f.prisma);
      const dispatch = new PaymentDispatchService(payments, checkout);
      const webhook = new HandleAsaasWebhookUseCase(payments, dispatch, undefined, f.prisma);
      const input = { id: "late-webhook-event", event: "PAYMENT_RECEIVED", payment: { id: c.payment.providerPaymentId!, value: 50, externalReference: c.payment.id } };
      await assert.rejects(webhook.execute("wrong-token", input, token), /asaas_webhook_token_invalid/);
      const result = await webhook.execute(token, input, token); assert.equal(result.outcome, "processed");
      assert.deepEqual(await webhook.execute(token, input, token), { outcome: "duplicate" });
      const deadline = Date.now() + 10_000; let event;
      do {
        event = await f.prisma.outboxMessage.findFirst({ where: { merchantId: c.merchantId, eventType: "payment.status.changed", causationId: c.payment.id } });
        if (event?.status === "delivered") break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      assert.ok(event); assert.equal(event.status, "delivered");
      assert.ok(await f.prisma.outboxHandlerExecution.findUnique({ where: { eventId_handlerId: { eventId: event.eventId, handlerId: "service-payment.reconcile.v1" } } }));
      const money = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
      assert.equal(money.status, "approved"); assert.equal(money.approvedAmountCents, 5000); assert.equal(money.providerPaymentId, c.payment.providerPaymentId);
      const order = await f.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: c.merchantId, sessionId: c.sessionId } });
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 0);
      const notices = await f.prisma.merchantNotification.findMany({ where: { merchantId: c.merchantId, type: "service_payment_regularization" } });
      assert.equal(notices.length, 1); assert.equal((notices[0].metadata as any).bookingConfirmed, false);
      assert.equal((notices[0].metadata as any).orderId, order.id); assert.equal((notices[0].metadata as any).unitId, "line_1");
      assert.equal(await f.prisma.paymentIntent.count({ where: { merchantId: c.merchantId, sessionId: c.sessionId } }), 1);
      assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: c.merchantId, eventType: "payment.status.changed", causationId: c.payment.id } }), 1);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.payment.id } }), 0);
      assert.equal(await f.prisma.inventoryMovement.count(), 0); assert.equal(await f.prisma.attendanceReceipt.count(), 0);
    });
    await t.test("a token without its actual persisted outbox row cannot clear the financial admission fence", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-forged"), before = await scopedSnapshot(c);
      await assert.rejects(command.handle(eventFor(c, randomUUID())), /service_payment_lease_lost/);
      assert.deepEqual(await scopedSnapshot(c), before);
    });
    await t.test("a pending row and a replaced or finished claim cannot authorize reconciliation", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-lost-claim"), token = randomUUID(), event = eventFor(c, token), before = await scopedSnapshot(c);
      const row = await f.prisma.outboxMessage.create({ data: { eventId: event.eventId!, eventType: event.eventType, schemaVersion: 1,
        merchantId: c.merchantId, producer: "checkout", occurredAt: new Date(), correlationId: event.correlationId!, causationId: c.payment.id,
        payload: event.payload as any, nextAttemptAt: new Date(Date.now() + 3_600_000) } });
      await assert.rejects(command.handle(event), /service_payment_lease_lost/);
      await f.prisma.outboxMessage.update({ where: { eventId: row.eventId }, data: { status: "processing", leaseToken: "replacement-token", leaseExpiresAt: new Date(Date.now() + 120_000) } });
      await assert.rejects(command.handle(event), /service_payment_lease_lost/);
      await f.prisma.outboxMessage.update({ where: { eventId: row.eventId }, data: { status: "dead", leaseToken: token, leaseExpiresAt: new Date(0) } });
      await assert.rejects(command.handle(event), /service_payment_lease_lost/); assert.deepEqual(await scopedSnapshot(c), before);
    });
    await t.test("an original row with different session or payload cannot be replaced by an event claim", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-payload"), token = randomUUID(), event = eventFor(c, token), before = await scopedSnapshot(c);
      await f.prisma.outboxMessage.create({ data: { eventId: event.eventId!, eventType: event.eventType, schemaVersion: 1, merchantId: c.merchantId,
        producer: "checkout", occurredAt: new Date(), correlationId: event.correlationId!, causationId: c.payment.id,
        status: "processing", leaseToken: token, leaseExpiresAt: new Date(Date.now() + 120_000), payload: { ...event.payload as object, session_id: "different-session" } } });
      await assert.rejects(command.handle(event), /service_payment_lease_lost/); assert.deepEqual(await scopedSnapshot(c), before);
    });
    await t.test("completion still pending is a retryable gap without a false booking or regularization success", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-completion-pending"); await f.prisma.completedOrder.delete({ where: { id: c.order.id } });
      const money = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
      await assert.rejects(command.execute(c.merchantId, c.payment.id), /service_payment_completion_pending/);
      assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } }), money);
      assert.equal(await f.prisma.appointmentPayment.count({ where: { paymentIntentId: c.payment.id } }), 0);
      assert.equal(await f.prisma.merchantNotification.count({ where: { merchantId: c.merchantId, metadata: { path: ["paymentIntentId"], equals: c.payment.id } } }), 0);
    });
    await t.test("claim loss after financial work rolls back SQL and redelivery before acknowledgment has one effect", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-end-claim", { proven: false }), token = randomUUID(), event = eventFor(c, token);
      const money = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
      await f.prisma.outboxMessage.create({ data: { eventId: event.eventId!, eventType: event.eventType, schemaVersion: 1, merchantId: c.merchantId,
        producer: "checkout", occurredAt: new Date(), correlationId: event.correlationId!, causationId: c.payment.id,
        status: "processing", leaseToken: token, leaseExpiresAt: new Date(Date.now() + 120_000), payload: event.payload as any } });
      await f.runtime.db.sql("CREATE FUNCTION t36_replace_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='service_payment_regularization' THEN UPDATE outbox_messages SET lease_token='replaced-during-work' WHERE merchant_id=NEW.merchant_id AND event_type='payment.status.changed' AND causation_id=(NEW.metadata->>'paymentIntentId'); END IF; RETURN NEW; END $$; CREATE TRIGGER t36_replace_claim BEFORE INSERT ON merchant_notifications FOR EACH ROW EXECUTE FUNCTION t36_replace_claim();");
      try { await assert.rejects(command.handle(event), /service_payment_lease_lost/);
        assert.equal(await f.prisma.merchantNotification.count({ where: { merchantId: c.merchantId, metadata: { path: ["paymentIntentId"], equals: c.payment.id } } }), 0);
        assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: c.merchantId, eventType: "service.payment.regularization_required", causationId: c.payment.id } }), 0);
        assert.equal((await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: event.eventId } })).leaseToken, token);
      } finally { await f.runtime.db.sql("DROP TRIGGER t36_replace_claim ON merchant_notifications; DROP FUNCTION t36_replace_claim();"); }
      await command.handle(event); const before = await scopedSnapshot(c); await command.handle(event);
      assert.deepEqual(await scopedSnapshot(c), before); assert.deepEqual(before.payment, money);
      const notices = before.notices.filter(row => (row.metadata as any).paymentIntentId === c.payment.id); assert.equal(notices.length, 1);
      assert.equal((notices[0].metadata as any).bookingConfirmed, false); assert.equal(before.appointments.length, 0);
      assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: c.merchantId, eventType: "service.payment.regularization_required", causationId: c.payment.id } }), 1);
    });
    await t.test("the final ownership row remains locked through durable commit while admission uses the normal claim", async () => {
      const c = await seedApprovedProfessionalCase(f, "late-final-row-lock", { proven: false }), token = randomUUID(), event = eventFor(c, token);
      const claimRow = await f.prisma.outboxMessage.create({ data: { eventId: event.eventId!, eventType: event.eventType, schemaVersion: 1, merchantId: c.merchantId,
        producer: "checkout", occurredAt: new Date(), correlationId: event.correlationId!, causationId: c.payment.id,
        status: "processing", attempts: 1, leaseToken: token, leaseExpiresAt: new Date(Date.now() + 120_000), payload: event.payload as any } });
      const heartbeatClaim = { envelope: { event_id: claimRow.eventId, event_type: claimRow.eventType, schema_version: claimRow.schemaVersion,
        merchant_id: claimRow.merchantId, occurred_at: claimRow.occurredAt.toISOString(), correlation_id: claimRow.correlationId,
        causation_id: claimRow.causationId, producer: claimRow.producer, payload: claimRow.payload as any },
        leaseToken: token, leaseExpiresAt: claimRow.leaseExpiresAt!, attempts: claimRow.attempts };
      let reachedInitialClock!: () => void, releaseAdmission!: () => void, reachedFinalClock!: () => void, releaseCommit!: () => void, clockReads = 0;
      const atInitialClock = new Promise<void>(resolve => { reachedInitialClock = resolve; });
      const admissionGate = new Promise<void>(resolve => { releaseAdmission = resolve; });
      const atFinalClock = new Promise<void>(resolve => { reachedFinalClock = resolve; });
      const commitGate = new Promise<void>(resolve => { releaseCommit = resolve; });
      // Observe completion of the existing final clock read. Every actual SQL
      // argument/result and the real transaction/client remain unchanged.
      const observedPrisma = { $transaction: (work: any) => f.prisma.$transaction(tx => work(new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (key === "$queryRaw") return async (...args: any[]) => {
            const rows = await Reflect.apply(value, target, args);
            const query = args[0], strings = Array.isArray(query) ? query : query?.strings;
            if (Array.isArray(strings) && strings.join("").includes("SELECT clock_timestamp() AS now")) {
              clockReads++;
              if (clockReads === 1) { reachedInitialClock(); await admissionGate; }
              if (clockReads === 2) { reachedFinalClock(); await commitGate; }
            }
            return rows;
          };
          return typeof value === "function" ? value.bind(target) : value;
        },
      }))) };
      const observed = new ReconcileServicePaymentUseCase(observedPrisma as any, new InMemoryDomainEventBus(), tenant);
      const processing = observed.handle(event); let contenderError: any;
      try {
        await Promise.race([atInitialClock, processing.then(() => assert.fail("transaction ended before its initial ownership checkpoint"))]);
        await f.prisma.$transaction(async other => {
          await other.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id = ${event.eventId} AND merchant_id = ${c.merchantId} FOR UPDATE NOWAIT`;
          assert.equal(await new PrismaOutboxRepository(other as any).renewClaim(heartbeatClaim), true);
        });
        releaseAdmission();
        await Promise.race([atFinalClock, processing.then(() => assert.fail("transaction ended before its final ownership checkpoint"))]);
        // This is a competing lock request, not a claimed legal pre-expiry
        // reclaim. PostgreSQL, rather than a query spy, must exclude it.
        try { await f.prisma.$transaction(async other => {
          await other.$queryRaw`SELECT event_id FROM outbox_messages WHERE event_id = ${event.eventId} AND merchant_id = ${c.merchantId} FOR UPDATE NOWAIT`;
        }); } catch (error) { contenderError = error; }
        assert.equal(await f.prisma.merchantNotification.count({ where: { merchantId: c.merchantId,
          metadata: { path: ["paymentIntentId"], equals: c.payment.id } } }), 0);
      } finally { releaseAdmission(); releaseCommit(); await processing; }
      assert.equal(contenderError?.code, "P2010", "real second connection must encounter the held PostgreSQL row lock");
      assert.equal(contenderError?.meta?.code, "55P03");
      const owned = await f.prisma.outboxMessage.findUniqueOrThrow({ where: { eventId: event.eventId } });
      assert.equal(owned.status, "processing"); assert.equal(owned.leaseToken, token); assert.equal(owned.attempts, 1);
      const notices = await f.prisma.merchantNotification.findMany({ where: { merchantId: c.merchantId,
        metadata: { path: ["paymentIntentId"], equals: c.payment.id } } });
      assert.equal(notices.length, 1); assert.equal((notices[0].metadata as any).bookingConfirmed, false);
      assert.equal((notices[0].metadata as any).paymentStatus, "approved");
      assert.equal(await f.prisma.outboxMessage.count({ where: { merchantId: c.merchantId,
        eventType: "service.payment.regularization_required", causationId: c.payment.id } }), 1);
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: c.order.id } }), 0);
    });
  } finally { await f.close(); }
});
