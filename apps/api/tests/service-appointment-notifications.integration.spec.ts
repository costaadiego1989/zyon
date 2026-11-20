import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { seedServiceBookingFixture, serviceBookingRequest } from "./service-booking-fixtures.js";
import { admitServiceAppointment } from "../src/shared/bookings/service-appointment-admission.service.js";
import { ensureAtAttendancePayment } from "../src/shared/bookings/service-at-attendance-payment.js";
import { withServiceNoticeTransport, type ServiceNoticeTransportProof } from "../src/modules/notifications/application/ports/notification-whatsapp-sender.port.js";
import { RecordAttendanceReceiptUseCase } from "../src/modules/operations/application/record-attendance-receipt.use-case.js";
import { ServiceAppointmentEventsConsumer } from "../src/modules/notifications/application/service-appointment-events.consumer.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { PrismaOutboxRepository } from "../src/shared/messaging/infrastructure/prisma-outbox.repository.js";
import { OutboxDispatcher } from "../src/shared/messaging/outbox-dispatcher.service.js";
import { operatorConnection } from "../src/modules/whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { startWhatsAppRequest } from "../src/shared/whatsapp/whatsapp-automation-context.js";
import { HandleStatusUpdateUseCase } from "../src/modules/whatsapp-channel/application/use-cases/handle-status-update.use-case.js";
import type { DomainEvent } from "../src/shared/events/domain-event-bus.port.js";

import { reserveProfessionalOrderUnit } from "../src/shared/bookings/service-order-appointment.js";
import { serviceCheckoutProvenance } from "../src/shared/bookings/service-checkout-provenance.js";

test("T38 actual service outbox ownership and captured transport preserve booking and money", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  await t.test("served AppModule registers the canonical handler before an admitted scheduled event is acknowledged", async () => {
    const f = await createServiceOperationsHttpFixture({ whatsapp: true });
    try {
      const c = await f.prepare("notice-registration"), deadline = Date.now() + 10000; let row;
      do { row = await f.prisma.outboxMessage.findFirst({ where: { merchantId: c.merchantId, correlationId: c.appointment.id, eventType: "service.appointment.scheduled" } });
        if (row?.status === "delivered") break; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
      assert.ok(row); assert.equal(row.status, "delivered"); assert.ok(await f.prisma.outboxHandlerExecution.findUnique({ where: { eventId_handlerId: { eventId: row.eventId, handlerId: "service-appointment.notice.v1" } } }));
      assert.equal(await f.prisma.inventoryMovement.count(), 0); assert.equal(f.runtime.evidence().providerCalls, 0);
      // These owned synthetic unknown ledger entries isolate receipt adoption;
      // the original admitted booking/outbox above still use actual writers.
      const accountA = "90003801", accountB = "90003802", originalToken = "synthetic-t38-original-token";
      const credentials = { phoneNumberId: accountA, wabaId: "90003800", accessToken: originalToken };
      const config = await f.prisma.whatsAppChannelConfig.upsert({ where: { merchantId: c.merchantId }, create: { merchantId: c.merchantId,
        provider: "META_CLOUD", enabled: true, status: "ACTIVE", deviceId: "META_CLOUD:t38-signed", whatsappNumber: "+5521999990038", credentials },
        update: { provider: "META_CLOUD", enabled: true, status: "ACTIVE", deviceId: "META_CLOUD:t38-signed", whatsappNumber: "+5521999990038", credentials } });
      const controlId = "service_notification:" + "a".repeat(64), unresolvedId = "service_notification:" + "b".repeat(64);
      for (const id of [controlId, unresolvedId]) await f.prisma.whatsAppDelivery.create({ data: { id, merchantId: c.merchantId, configId: config.id,
        deviceId: config.deviceId!, state: "submission_unknown", processingToken: "synthetic-t38-receipt", providerMessageId: null,
        response: { kind: "service_notification", type: "service_appointment_notice", appointmentId: c.appointment.id, sourceEventId: row.eventId,
          part: "text", providerAccountId: accountA, status: "unknown", channel: "none" } } });
      const saved = (id: string) => f.prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id } });
      const localWhatsApp = f.runtime.whatsapp; assert.ok(localWhatsApp);
      const businessBefore = await f.snapshot(c.appointment.id), requestsBefore = localWhatsApp.events();
      const signedReceipt = async (account: string | undefined, id: string, messageId: string, validSignature = true) => {
        const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { ...(account === undefined ? {} : { metadata: { phone_number_id: account } }),
          statuses: [{ id: messageId, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), biz_opaque_callback_data: id }] } }] }] });
        const response = await fetch(f.runtime.apiOrigin + "/webhooks/whatsapp/meta", { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
          headers: { "content-type": "application/json", "x-hub-signature-256": validSignature ? localWhatsApp.signature(body) : "sha256=" + "0".repeat(64) }, body });
        await response.text(); return response.status;
      };
      const controlBefore = await saved(controlId);
      assert.equal(await signedReceipt(accountA, controlId, "wamid-t38-control", false), 401); assert.deepEqual(await saved(controlId), controlBefore);
      assert.equal(await signedReceipt(accountA, controlId, "wamid-t38-control"), 200);
      const control = await saved(controlId); assert.equal(control.state, "sent"); assert.equal(control.providerMessageId, "wamid-t38-control");
      const unresolved = await saved(unresolvedId); assert.equal(unresolved.state, "submission_unknown"); assert.equal(unresolved.providerMessageId, null);
      // Same config/WABA/number, different authenticated phone ID: correlation
      // knowledge does not transfer the original account's unknown submission.
      await f.prisma.whatsAppChannelConfig.update({ where: { id: config.id }, data: { credentials: { ...credentials, phoneNumberId: accountB } } });
      assert.equal(await signedReceipt(accountB, unresolvedId, "wamid-t38-wrong-account"), 200); assert.deepEqual(await saved(unresolvedId), unresolved);
      assert.equal(await signedReceipt(undefined, unresolvedId, "wamid-t38-without-account"), 200); assert.deepEqual(await saved(unresolvedId), unresolved);
      // Credentials may rotate while the original provider account stays valid.
      await f.prisma.whatsAppChannelConfig.update({ where: { id: config.id }, data: { credentials: { ...credentials, accessToken: "synthetic-t38-rotated-token" } } });
      assert.equal(await signedReceipt(accountA, unresolvedId, "wamid-t38-original-account"), 200);
      const accepted = await saved(unresolvedId); assert.equal(accepted.state, "sent"); assert.equal(accepted.providerMessageId, "wamid-t38-original-account");
      assert.equal(await signedReceipt(accountA, unresolvedId, "wamid-t38-original-account"), 200); assert.deepEqual(await saved(unresolvedId), accepted);
      assert.deepEqual(localWhatsApp.events(), requestsBefore); assert.equal(f.runtime.evidence().providerCalls, 0);
      assert.deepEqual(await f.snapshot(c.appointment.id), businessBefore); assert.equal(await f.prisma.inventoryMovement.count(), 0);
    } finally { await f.close(); }
  });
  // Separate owned SQL scope proves the production consumer/dispatcher with only
  // the final provider request captured. No auth or repository override is used.
  const db = await createDisposablePostgres({ transport: "loopback-exec" }); let prisma: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db); prisma = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } }); const p = prisma;
    await seedServiceBookingFixture(p, new Date());
    const config = await p.whatsAppChannelConfig.create({ data: { merchantId: "booking-services", enabled: true, status: "ACTIVE", provider: "META_CLOUD", deviceId: "META_CLOUD:service-test",
      whatsappNumber: "+5521999999999", credentials: { accessToken: "synthetic-not-a-secret", wabaId: "123456", phoneNumberId: "654321" } } });
    // Synthetic normalized post-authentication inbox fact. This proves the SQL
    // window/tenant guard, not a real Meta signature or provider delivery.
    const inboundPayload = { provider: "META_CLOUD", merchantId: "booking-services", deviceId: config.deviceId!, fromNumber: "+5521999990000", timestamp: Date.now() };
    const inbound = await p.whatsAppWebhookInbox.create({ data: { dedupKey: "notice-inbound", eventId: "notice-inbound", kind: "message", merchantId: "booking-services", configId: config.id,
      deviceId: config.deviceId!, streamKey: "synthetic-notice-stream", payloadHash: "synthetic-notice-payload", payload: inboundPayload, status: "processed", processedAt: new Date() } });
    let transport: ServiceNoticeTransportProof = { kind: "session" };
    const bus = new InMemoryDomainEventBus(), tenant = new TenantContextService(), requests: any[] = []; let outcome = "accepted", serial = 0, beforeRequest: (() => Promise<void>) | undefined;
    const sender: any = { execute: async () => assert.fail("service notice cannot send an order receipt"), executeService: async (input: any) => {
      const current = await p.whatsAppChannelConfig.findUniqueOrThrow({ where: { id: config.id } });
      const connection = operatorConnection({ ...current, credentials: current.credentials as any } as any, { merchantId: current.merchantId, configId: current.id, deviceId: current.deviceId!, provider: current.provider, accountId: "654321", recipient: input.toPhone });
      assert.equal(connection.kind, "ready"); if (connection.kind !== "ready") throw Error("synthetic_connection_unavailable");
      await beforeRequest?.(); return withServiceNoticeTransport(transport, () => startWhatsAppRequest(Object.freeze({ ...connection.scope, messageId: input.deliveryId }), async () => {
        requests.push(structuredClone(input)); return outcome === "accepted" ? { status: "accepted", channel: "whatsapp_session", messageId: "wamid-" + requests.length }
          : { status: outcome, channel: "whatsapp_session", reason: "synthetic-provider-result" }; }));
    } };
    const consumer = new ServiceAppointmentEventsConsumer(p, sender, bus, tenant); consumer.onModuleInit();
    const repository = new PrismaOutboxRepository(p), dispatcher = new OutboxDispatcher(repository, bus);
    const seed = async () => {
      const date = new Date(Date.now() + (++serial + 2) * 86400000).toISOString().slice(0, 10), key = "notice-" + serial;
      return p.$transaction(async tx => { const result = await admitServiceAppointment(tx, serviceBookingRequest(date, key));
        const payment = await ensureAtAttendancePayment(tx, result.appointment, new Date()); return { appointment: result.appointment, payment }; });
    };
    const snapshot = async (id: string) => ({ appointment: await p.serviceAppointment.findUniqueOrThrow({ where: { id } }), payments: await p.appointmentPayment.findMany({ where: { appointmentId: id }, orderBy: { id: "asc" } }),
      receipts: await p.attendanceReceipt.findMany({ where: { payment: { appointmentId: id } }, orderBy: { id: "asc" } }), audits: await p.appointmentAudit.findMany({ where: { appointmentId: id }, orderBy: { commandId: "asc" } }) });
    const delivery = (id: string) => p.whatsAppDelivery.findMany({ where: { merchantId: "booking-services", response: { path: ["appointmentId"], equals: id } }, orderBy: { id: "asc" } });
    const claimEvent = async (): Promise<DomainEvent> => { const claims = await repository.claimBatch(1); assert.equal(claims.length, 1); const c = claims[0], e: DomainEvent = { eventId: c.envelope.event_id, eventType: c.envelope.event_type,
      merchantId: c.envelope.merchant_id, schemaVersion: c.envelope.schema_version, correlationId: c.envelope.correlation_id, causationId: c.envelope.causation_id, payload: c.envelope.payload };
      Object.defineProperty(e, "deliveryLeaseToken", { value: c.leaseToken, enumerable: false }); return e; };
    await t.test("actual SQL admission/outbox/dispatcher creates one canonical manual-compatible booking notice without stock/order effects", async () => {
      const c = await seed(), before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch();
      assert.equal(requests.length, offset + 1); assert.equal(requests.at(-1).appointmentId, c.appointment.id); assert.equal(requests.at(-1).orderId, undefined);
      assert.match(requests.at(-1).freeformText, /Synthetic professional/); assert.match(requests.at(-1).freeformText, /no atendimento/i);
      const rows = await delivery(c.appointment.id); assert.equal(rows.length, 1); assert.equal(rows[0].state, "sent"); assert.ok(rows[0].providerMessageId);
      assert.deepEqual(await snapshot(c.appointment.id), before); await dispatcher.dispatch(); assert.equal(requests.length, offset + 1);
      assert.equal(await p.completedOrder.count(), 0); assert.equal(await p.inventoryMovement.count(), 0);
    });
    await t.test("concurrent consumers holding the actual database claim cannot submit the same event twice", async () => {
      const c = await seed(), event = await claimEvent(), before = await snapshot(c.appointment.id), offset = requests.length;
      const other = new ServiceAppointmentEventsConsumer(p, sender, new InMemoryDomainEventBus(), tenant);
      await Promise.all([consumer.handle(event), other.handle(event)]); assert.equal(requests.length, offset + 1); assert.equal((await delivery(c.appointment.id)).length, 1);
      assert.deepEqual(await snapshot(c.appointment.id), before);
      await p.outboxMessage.update({ where: { eventId: event.eventId }, data: { status: "pending", leaseToken: null, leaseExpiresAt: null } });
      const next = await claimEvent(); await consumer.handle(next); assert.equal(requests.length, offset + 1);
      await p.outboxMessage.update({ where: { eventId: event.eventId }, data: { status: "delivered", leaseToken: null, leaseExpiresAt: null } });
    });
    await t.test("a late scheduled source cannot confirm a cancelled or rescheduled appointment", async () => {
      for (const status of ["cancelled", "scheduled"] as const) { const c = await seed(); await p.serviceAppointment.update({ where: { id: c.appointment.id }, data: { version: 2, operationalStatus: status } });
        const before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch(); assert.equal(requests.length, offset); assert.deepEqual(await snapshot(c.appointment.id), before); }
    });
    await t.test("local receipt is delivered once even after an independent attendance revision and never claims PSP approval", async () => {
      const c = await seed(); await dispatcher.dispatch(); const result = await new RecordAttendanceReceiptUseCase(p).execute({ merchantId: "booking-services", userId: "owner", role: "owner" }, {
        appointmentId: c.appointment.id, paymentId: c.payment.id, expectedPaymentVersion: 1, amountCents: 5000, currency: "BRL", paymentMethod: "Pix local", commandId: "notice-receipt" });
      await p.serviceAppointment.update({ where: { id: c.appointment.id }, data: { version: 2, operationalStatus: "completed" } });
      const before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch(); assert.equal(requests.length, offset + 1);
      assert.match(requests.at(-1).freeformText, /registrado no atendimento/i); assert.equal(/confirmado pelo provedor|pagamento aprovado/i.test(requests.at(-1).freeformText), false);
      assert.equal(result.receipt.amountCents, 5000); assert.deepEqual(await snapshot(c.appointment.id), before); assert.equal(await p.paymentIntent.count(), 0);
    });
    await t.test("unknown persists without replay and only the matching authenticated provider receipt reconciles it", async () => {
      const c = await seed(); outcome = "unknown"; const offset = requests.length; await dispatcher.dispatch(); outcome = "accepted";
      const [row] = await delivery(c.appointment.id); assert.equal(row.state, "submission_unknown"); await dispatcher.dispatch(); assert.equal(requests.length, offset + 1);
      const receipt = new HandleStatusUpdateUseCase(p), input = { merchantId: "booking-services", configId: config.id, providerAccountId: "654321", messageId: "wamid-unknown", correlationId: row.id, status: "delivered", timestamp: String(Math.floor(Date.now()/1000)) };
      await receipt.receiveMetaReceipt({ ...input, merchantId: "booking-foreign" }); assert.equal((await delivery(c.appointment.id))[0].state, "submission_unknown");
      const unresolved = await delivery(c.appointment.id);
      await receipt.receiveMetaReceipt({ ...input, providerAccountId: undefined }); assert.deepEqual(await delivery(c.appointment.id), unresolved);
      await receipt.receiveMetaReceipt({ ...input, providerAccountId: "654322" }); assert.deepEqual(await delivery(c.appointment.id), unresolved);
      await receipt.receiveMetaReceipt(input); const after = (await delivery(c.appointment.id))[0]; assert.equal(after.state, "sent"); assert.equal(after.providerMessageId, input.messageId);
      await receipt.receiveMetaReceipt({ ...input, status: "failed" }); assert.equal((await delivery(c.appointment.id))[0].state, "sent"); assert.equal(requests.length, offset + 1);
    });
    await t.test("actual request initiation rechecks schedule after asynchronous transport preparation", async () => {
      const c = await seed(), offset = requests.length;
      beforeRequest = async () => { beforeRequest = undefined; await p.serviceAppointment.update({ where: { id: c.appointment.id }, data: { version: 2, operationalStatus: "cancelled" } }); };
      await dispatcher.dispatch(); assert.equal(requests.length, offset); const a = await p.serviceAppointment.findUniqueOrThrow({ where: { id: c.appointment.id } });
      assert.equal(a.version, 2); assert.equal(a.operationalStatus, "cancelled"); assert.equal((await delivery(c.appointment.id))[0].state, "notification_failed");
    });
    await t.test("delivery-row SQL failure rolls back that claim and leaves the confirmed booking available for a clean retry", async () => {
      const c = await seed(), before = await snapshot(c.appointment.id), offset = requests.length;
      await db.sql("CREATE FUNCTION t38_fail_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_notice_failure'; END $$; CREATE TRIGGER t38_fail_notice BEFORE INSERT ON whatsapp_deliveries FOR EACH ROW EXECUTE FUNCTION t38_fail_notice();");
      try { await dispatcher.dispatch(); assert.equal(requests.length, offset); assert.equal((await delivery(c.appointment.id)).length, 0); assert.deepEqual(await snapshot(c.appointment.id), before); }
      finally { await db.sql("DROP TRIGGER t38_fail_notice ON whatsapp_deliveries; DROP FUNCTION t38_fail_notice();"); }
      const event = await p.outboxMessage.findFirstOrThrow({ where: { correlationId: c.appointment.id, eventType: "service.appointment.scheduled" } });
      assert.equal(event.status, "pending"); assert.equal(event.lastError, "outbox_handler_failed");
      await p.outboxMessage.update({ where: { eventId: event.eventId }, data: { nextAttemptAt: new Date(0) } });
      // A fresh dispatcher has no previous round's cooldown; the durable retry
      // timestamp/claim API remains authoritative, not a lowered production delay.
      await new OutboxDispatcher(repository, bus).dispatch(); assert.equal(requests.length, offset + 1); assert.deepEqual(await snapshot(c.appointment.id), before);
    });
    await t.test("all service delivery paths preserve physical and external financial effects", async () => {
      assert.equal(await p.inventoryMovement.count(), 0); assert.equal(await p.completedOrder.count(), 0); assert.equal(await p.paymentIntent.count(), 0);
      assert.equal(await p.outboxMessage.count({ where: { eventType: { in: ["order.shipped", "inventory_sale", "order.confirmed"] } } }), 0);
      assert.equal(JSON.stringify(await p.whatsAppDelivery.findMany()).includes("synthetic-not-a-secret"), false);
    });
    await t.test("zero-price service remains rejected without booking, payment or notification effects", async () => {
      const price = await p.productPrice.findUniqueOrThrow({ where: { variantId: "booking-short-variant" } });
      const business = async () => ({
        appointments: await p.serviceAppointment.findMany({ orderBy: { id: "asc" } }),
        payments: await p.appointmentPayment.findMany({ orderBy: { id: "asc" } }),
        receipts: await p.attendanceReceipt.findMany({ orderBy: { id: "asc" } }),
        audits: await p.appointmentAudit.findMany({ orderBy: { id: "asc" } }),
        events: await p.outboxMessage.findMany({ orderBy: { eventId: "asc" } }),
        stock: await p.inventoryMovement.findMany({ orderBy: { id: "asc" } }),
        orders: await p.completedOrder.findMany({ orderBy: { id: "asc" } }),
        providerPayments: await p.paymentIntent.findMany({ orderBy: { id: "asc" } }),
      });
      const before = await business(), requestsBefore = structuredClone(requests);
      await p.productPrice.update({ where: { variantId: "booking-short-variant" }, data: { basePriceInCents: 0 } });
      try {
        const date = new Date(Date.now() + (++serial + 2) * 86400000).toISOString().slice(0, 10);
        await assert.rejects(p.$transaction(async tx => {
          const a = await admitServiceAppointment(tx, serviceBookingRequest(date, "free-service", { priceInCents: 0 }));
          await ensureAtAttendancePayment(tx, a.appointment, new Date());
        }), /service_price_not_configured/);
        assert.deepEqual(await business(), before);
        assert.deepEqual(requests, requestsBefore);
      } finally {
        await p.productPrice.update({ where: { variantId: "booking-short-variant" }, data: { basePriceInCents: price.basePriceInCents } });
      }
    });
    await t.test("T39 actual canonical SQL tones produce formatted complete unpaid payloads and ignore private or foreign personas", async () => {
      await p.agentRule.create({ data: { merchantId: "booking-foreign", agentId: "default", userId: null, scope: "merchant_default",
        identity: { tone: "friendly", persona: "FOREIGN_T39_CANARY" }, capabilities: {}, guardrails: {}, checkoutSettings: {} } });
      await p.agentRule.create({ data: { merchantId: "booking-services", agentId: "agt_t39_legacy", userId: null, scope: "user_agent",
        identity: { tone: "technical", persona: "LEGACY_T39_CANARY" }, capabilities: {}, guardrails: {}, checkoutSettings: {} } });
      const leads = { consultative: "Confira os detalhes do seu atendimento.", premium: "Confira os detalhes do seu atendimento com aten\u00e7\u00e3o.", direct: "Resumo do atendimento:",
        friendly: "Separei os detalhes para voc\u00ea conferir.", technical: "Resumo do agendamento e da situa\u00e7\u00e3o financeira." };
      for (const [tone, lead] of Object.entries(leads)) {
        await p.agentRule.upsert({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } },
          create: { merchantId: "booking-services", agentId: "default", userId: null, scope: "merchant_default", identity: { tone, persona: "PRIVATE_T39_CANARY" }, capabilities: {}, guardrails: {}, checkoutSettings: {} },
          update: { identity: { tone, persona: "PRIVATE_T39_CANARY" } } });
        const c = await seed(), before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch();
        assert.equal(requests.length, offset + 1); const text = requests.at(-1).freeformText;
        assert.ok(text.includes(lead)); assert.ok(text.startsWith("\ud83e\udd16")); assert.match(text, /\*Agendamento confirmado\*/);
        for (const value of ["Synthetic booking-short", "Synthetic professional", "10:00", "10:20", "UTC", "50,00", "no atendimento"]) assert.ok(text.includes(value), value);
        assert.doesNotMatch(text, /T39_CANARY|Total pago|pedido enviado|confirmado pelo provedor/i); assert.deepEqual(await snapshot(c.appointment.id), before);
        assert.equal((await delivery(c.appointment.id))[0].state, "sent");
      }
    });
    await t.test("T39 actual SQL default fallback retains same-merchant legacy and never imports the foreign rule", async () => {
      await p.agentRule.update({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } }, data: { identity: { tone: "not-a-configured-tone", persona: "PRIVATE_T39_CANARY" } } });
      const c = await seed(), before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch();
      assert.equal(requests.length, offset + 1); assert.ok(requests.at(-1).freeformText.includes("Confira os detalhes do seu atendimento."));
      assert.doesNotMatch(requests.at(-1).freeformText, /T39_CANARY|not-a-configured-tone/); assert.deepEqual(await snapshot(c.appointment.id), before);
      await p.agentRule.delete({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } } });
      const legacy = await seed(), legacyBefore = await snapshot(legacy.appointment.id), legacyOffset = requests.length; await dispatcher.dispatch();
      assert.equal(requests.length, legacyOffset + 1); assert.ok(requests.at(-1).freeformText.includes("Resumo do agendamento e da situa\u00e7\u00e3o financeira."));
      assert.doesNotMatch(requests.at(-1).freeformText, /T39_CANARY/); assert.deepEqual(await snapshot(legacy.appointment.id), legacyBefore);
      await p.agentRule.create({ data: { merchantId: "booking-services", agentId: "default", userId: null, scope: "merchant_default", identity: { tone: "consultative" }, capabilities: {}, guardrails: {}, checkoutSettings: {} } });
    });
    await t.test("T39 real SQL tone change after capture prevents the obsolete payload from starting and preserves the booking", async () => {
      await p.agentRule.update({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } }, data: { identity: { tone: "premium" } } });
      const c = await seed(), before = await snapshot(c.appointment.id), offset = requests.length;
      beforeRequest = async () => { beforeRequest = undefined; await p.agentRule.update({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } }, data: { identity: { tone: "direct" } } }); };
      await dispatcher.dispatch(); assert.equal(requests.length, offset); assert.equal((await delivery(c.appointment.id))[0].state, "notification_failed");
      assert.deepEqual(await snapshot(c.appointment.id), before);
      await p.agentRule.update({ where: { merchantId_agentId: { merchantId: "booking-services", agentId: "default" } }, data: { identity: { tone: "consultative" } } });
      assert.equal(await p.inventoryMovement.count(), 0);
    });
    await t.test("real SQL template revision/activation and freeform window changes during preparation deny the actual request", async () => {
      const canonical = { merchantId: "booking-services", type: "service_appointment_notice", channel: "whatsapp", name: "Service notice", body: "Canonical service",
        isActive: true, metaStatus: "approved", metaWabaId: "123456", metaRevision: 1, metaLanguage: "pt_BR", metaCategory: "UTILITY", metaTemplateBody: "Appointment {{1}}. Thank you.",
        metaVariableMap: { "1": "appointmentSummary" }, twilioContentSid: "service_confirmed", metaLastCheckedAt: new Date() };
      const template = await p.postSaleMessageTemplate.create({ data: canonical });
      for (const change of [{ isActive: false }, { metaRevision: 2 }, { metaLanguage: "en_US" }, { metaWabaId: "999999" }]) {
        await p.postSaleMessageTemplate.update({ where: { id: template.id }, data: canonical });
        const c = await seed(), offset = requests.length;
        transport = { kind: "template", template: { id: template.id, revision: 1, language: "pt_BR", category: "UTILITY", wabaId: "123456", body: canonical.metaTemplateBody,
          variableMap: canonical.metaVariableMap, contentSid: "service_confirmed" } };
        beforeRequest = async () => { beforeRequest = undefined; await p.postSaleMessageTemplate.update({ where: { id: template.id }, data: change }); };
        await dispatcher.dispatch(); assert.equal(requests.length, offset); assert.equal((await delivery(c.appointment.id))[0].state, "notification_failed");
      }
      transport = { kind: "session" }; const c = await seed(), offset = requests.length;
      beforeRequest = async () => { beforeRequest = undefined; const past = Date.now() - 26 * 3600000; await p.whatsAppWebhookInbox.update({ where: { id: inbound.id },
        data: { payload: { ...inboundPayload, timestamp: past }, createdAt: new Date(past) } }); };
      await dispatcher.dispatch(); assert.equal(requests.length, offset); assert.equal((await delivery(c.appointment.id))[0].state, "notification_failed");
      await p.whatsAppWebhookInbox.update({ where: { id: inbound.id }, data: { payload: { ...inboundPayload, timestamp: Date.now() }, createdAt: new Date() } });
    });
    await t.test("an approved local status without any immutable receipt cannot become a paid booking notice", async () => {
      const c = await seed(); await p.appointmentPayment.update({ where: { id: c.payment.id }, data: { status: "approved", receivedAt: new Date() } });
      const before = await snapshot(c.appointment.id), offset = requests.length; await dispatcher.dispatch();
      assert.equal(requests.length, offset); assert.deepEqual(await snapshot(c.appointment.id), before);
      assert.equal((await delivery(c.appointment.id)).length, 0); assert.equal(before.receipts.length, 0);
      const event = await p.outboxMessage.findFirstOrThrow({ where: { correlationId: c.appointment.id, eventType: "service.appointment.scheduled" } });
      assert.equal(event.status, "pending"); assert.equal(event.lastError, "outbox_handler_failed");
    });
    await t.test("real approved-unit writer admits discounted10000 service with PSP9200 and notice preserves both authorities", async () => {
      const date = new Date(Date.now() + (++serial + 2) * 86400000).toISOString().slice(0, 10), sessionId = "discount-service-session", merchantId = "booking-services";
      await p.serviceBusinessPolicy.update({ where: { merchantId }, data: { paymentMode: "online" } });
      await p.productPrice.update({ where: { variantId: "booking-short-variant" }, data: { basePriceInCents: 10000 } });
      const identity = { merchantId, sessionId, globalUserId: "discount-buyer" }, at = new Date();
      await p.checkoutSession.create({ data: { ...identity, conversationId: "discount-conversation", createdAt: at, updatedAt: at,
        customer: { fullName: "Discount buyer", phone: "+5521999990000", email: "discount@example.test", email_verified: true },
        cart: { currency: "BRL", total: 90, items: [] }, abandonmentScore: 0, triggerAgent: false,
        ...serviceCheckoutProvenance(identity, { serverChannel: "storefront", trustedBuyer: { globalUserId: identity.globalUserId, customer: { email: "discount@example.test", email_verified: true } } }) } });
      const money = await p.paymentIntent.create({ data: { id: "discount-intent", merchantId, sessionId, idempotencyKey: "discount-intent", method: "pix", status: "approved",
        providerPaymentId: "discount-provider", amountCents: 9200, approvedAmountCents: 9200, currency: "BRL",
        amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 1000, shippingCents: 0, platformFeeCents: 200, totalCents: 9200 } } });
      const order = await p.completedOrder.create({ data: { merchantId, sessionId, externalOrderId: "discount-provider", orderTotal: 90, currency: "BRL", completedAt: at,
        lineItemsJson: [{ snapshotVersion: 2, lineId: "discount-unit", sku: "booking-short", variantId: "booking-short-variant", name: "Discounted consultation", productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, unitPriceCents: 10000,
          schedule: { professionalId: "booking-professional", professionalVersion: 1, policyVersion: 1, date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", timeZone: "UTC", durationMinutes: 20 } }] } });
      const admitted = await p.$transaction(tx => reserveProfessionalOrderUnit(tx, merchantId, order.id, "discount-unit"));
      assert.ok(admitted.appointment); assert.equal(admitted.appointment.priceInCents, 10000);
      const before = await snapshot(admitted.appointment.id), offset = requests.length; await dispatcher.dispatch();
      assert.equal(requests.length, offset + 1); assert.match(requests.at(-1).freeformText, /100,00/); assert.match(requests.at(-1).freeformText, /confirmado pelo provedor/);
      assert.deepEqual(await snapshot(admitted.appointment.id), before);
      const current = await p.paymentIntent.findUniqueOrThrow({ where: { id: money.id } }); assert.equal(current.approvedAmountCents, 9200);
      assert.equal((await p.appointmentPayment.findFirstOrThrow({ where: { appointmentId: admitted.appointment.id } })).amountCents, 10000);
      assert.equal(await p.inventoryMovement.count(), 0);
    });
    await dispatcher.onModuleDestroy();
  } finally { if (prisma) await prisma.$disconnect(); await db.dispose(); }
});
