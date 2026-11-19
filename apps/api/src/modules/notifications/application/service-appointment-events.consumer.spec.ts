import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { DomainEvent } from "../../../shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { startWhatsAppRequest } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { operatorConnection } from "../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { withServiceNoticeTransport, type ServiceNoticeTransportProof } from "./ports/notification-whatsapp-sender.port.js";
import { ServiceAppointmentEventsConsumer, type ServiceNoticePresentation } from "./service-appointment-events.consumer.js";

const now = new Date("2030-01-01T10:00:00Z"), recipient = "+5521999990000";
function fixture(kind: "scheduled" | "receipt" = "scheduled", presentation?: ServiceNoticePresentation) {
  let state: any = {
    appointment: { id: "a", merchantId: "m", professionalId: "p", productId: "s", variantId: "v", version: kind === "receipt" ? 3 : 1,
      operationalStatus: "scheduled", startsAt: new Date("2030-01-03T13:00Z"), endsAt: new Date("2030-01-03T13:20Z"),
      timeZone: "America/Sao_Paulo", priceInCents: 5000, currency: "BRL", customerSnapshot: { name: "Buyer", phone: recipient, email: "private@example.test" } },
    inbound: { createdAt: now, payload: { provider: "META_CLOUD", merchantId: "m", deviceId: "META_CLOUD:c", fromNumber: recipient, timestamp: now.getTime() } },
    template: { id: "template", merchantId: "m", type: "service_appointment_notice", channel: "whatsapp", isActive: true, metaStatus: "approved", metaWabaId: "123456", metaRevision: 1,
      metaLanguage: "pt_BR", metaCategory: "UTILITY", metaTemplateBody: "Appointment {{1}}. Thank you.", metaVariableMap: { "1": "appointmentSummary" }, twilioContentSid: "service_confirmed", metaLastCheckedAt: now },
    config: { id: "c", merchantId: "m", provider: "META_CLOUD", enabled: true, status: "ACTIVE", deviceId: "META_CLOUD:c",
      whatsappNumber: "+5521999999999", credentials: { accessToken: "synthetic-private-token", wabaId: "123456", phoneNumberId: "654321" } },
    payments: [{ id: "money", merchantId: "m", appointmentId: "a", mode: "at_attendance", status: kind === "receipt" ? "approved" : "pending",
      amountCents: 5000, currency: "BRL", version: kind === "receipt" ? 2 : 1, receivedAt: kind === "receipt" ? now : null, paymentIntentId: null }],
    receipt: kind === "receipt" ? { id: "receipt", merchantId: "m", appointmentPaymentId: "money", amountCents: 5000, currency: "BRL", paymentMethod: "Cash", operatorId: "owner", receivedAt: now } : null,
    audit: { merchantId: "m", appointmentId: "a", commandId: "original", version: kind === "receipt" ? 3 : 1,
      action: kind === "receipt" ? "attendance_receipt" : "manual_create", after: kind === "receipt" ? { receiptId: "receipt", paymentId: "money", paymentVersion: 2 } : { operationalStatus: "scheduled" } },
    event: { eventId: "event", merchantId: "m", eventType: kind === "receipt" ? "service.payment.recorded_at_attendance" : "service.appointment.scheduled",
      correlationId: "a", causationId: "original", producer: "service-booking", schemaVersion: 1, status: "processing", leaseToken: "lease", leaseExpiresAt: new Date(now.getTime() + 120000),
      payload: kind === "receipt" ? { appointmentId: "a", appointmentVersion: 3, paymentId: "money", paymentVersion: 2, receiptId: "receipt" } : { appointmentId: "a", version: 1, operationalStatus: "scheduled" } }, deliveries: [],
  };
  const sent: any[] = [], calls: any[] = []; let beforeStart: (() => void) | undefined, outcome = "accepted", clock = now, transport: ServiceNoticeTransportProof = { kind: "session" };
  const business = () => structuredClone({ appointment: state.appointment, payments: state.payments, receipt: state.receipt, audit: state.audit });
  const match = (row: any, where: any) => Object.entries(where).every(([k, v]: any) => typeof v === "object" && v !== null && v.in ? v.in.includes(row[k]) : row[k] === v);
  const forbidden = async () => assert.fail("a notice must not write booking/payment/order/stock or publish order events");
  const tx: any = {
    $queryRaw: async (sql: any) => (Array.isArray(sql) ? sql : sql.strings ?? []).join("").includes("clock_timestamp") ? [{ now: clock }] : [{ id: "locked" }],
    merchant: { findUnique: async ({ where }: any) => where.id === "m" ? { id: "m", name: "Services" } : null },
    serviceAppointment: { findFirst: async ({ where }: any) => match(state.appointment, where) ? structuredClone(state.appointment) : null, update: forbidden, updateMany: forbidden },
    serviceProfessional: { findFirst: async () => ({ id: "p", merchantId: "m", publicName: "Professional" }) },
    product: { findFirst: async () => ({ id: "s", merchantId: "m", name: "Consultation", type: "service" }) },
    appointmentPayment: { findMany: async () => structuredClone(state.payments), update: forbidden, updateMany: forbidden },
    attendanceReceipt: { findFirst: async ({ where }: any) => state.receipt && match(state.receipt, where) ? structuredClone(state.receipt) : null },
    appointmentAudit: { findUnique: async () => structuredClone(state.audit), create: forbidden, update: forbidden },
    outboxMessage: { findFirst: async ({ where }: any) => match(state.event, where) ? structuredClone(state.event) : null, create: forbidden, update: forbidden },
    whatsAppChannelConfig: { findUnique: async () => state.config ? structuredClone(state.config) : null, findFirst: async () => state.config ? structuredClone(state.config) : null },
    whatsAppWebhookInbox: { findFirst: async () => structuredClone(state.inbound) },
    postSaleMessageTemplate: { findFirst: async () => structuredClone(state.template) },
    whatsAppDelivery: { findUnique: async ({ where }: any) => state.deliveries.find((r: any) => r.id === where.id) ?? null,
      findFirst: async ({ where }: any) => state.deliveries.find((r: any) => match(r, where)) ?? null,
      create: async ({ data }: any) => { if (state.deliveries.some((r: any) => r.id === data.id)) throw Object.assign(Error("duplicate"), { code: "P2002" }); state.deliveries.push(structuredClone(data)); return structuredClone(data); },
      updateMany: async ({ where, data }: any) => { const r = state.deliveries.find((v: any) => match(v, where)); if (!r) return { count: 0 }; Object.assign(r, structuredClone(data)); return { count: 1 }; } },
    completedOrder: { update: forbidden, create: forbidden }, inventoryMovement: { create: forbidden }, paymentIntent: { update: forbidden },
  };
  const prisma: any = { ...tx, $transaction: async (work: any) => { const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; } } };
  const bus = new InMemoryDomainEventBus(), sender: any = { execute: forbidden, executeService: async (input: any) => {
    calls.push(input); beforeStart?.();
    const c = state.config, connection = c && operatorConnection(c, { merchantId: "m", configId: "c", deviceId: "META_CLOUD:c", provider: "META_CLOUD", accountId: "654321", recipient });
    if (!connection || connection.kind !== "ready") return { status: "skipped", channel: "none", reason: "meta_connection_unavailable" };
    const scope = Object.freeze({ ...connection.scope, messageId: input.deliveryId });
    return withServiceNoticeTransport(transport, () => startWhatsAppRequest(scope, async () => { sent.push({ ...input });
      if (outcome === "throw" || input.part === "media") return { status: "unknown", channel: "whatsapp_session" };
      return outcome === "accepted" ? { status: "accepted", channel: "whatsapp_session", messageId: "wamid-" + sent.length }
        : { status: outcome, channel: "whatsapp_session", reason: "synthetic" }; }));
  } };
  const consumer = new ServiceAppointmentEventsConsumer(prisma as PrismaClient, sender, bus, new TenantContextService(), presentation);
  const event = (): DomainEvent => { const e: DomainEvent = { ...state.event, payload: structuredClone(state.event.payload) }; Object.defineProperty(e, "deliveryLeaseToken", { value: state.event.leaseToken, enumerable: false }); return e; };
  return { consumer, bus, sent, calls, business, event, get state() { return state; }, mutateBeforeStart: (f: () => void) => { beforeStart = f; },
    transport: (p: ServiceNoticeTransportProof) => { transport = p; }, result: (s: string) => { outcome = s; }, advance: (d: Date) => { clock = d; }, run: () => consumer.handle(event()) };
}

test("T38 canonical service notices own delivery without changing business state", async t => {
  await t.test("registers only the two authorized handlers synchronously during module initialization", () => {
    const f = fixture(); f.consumer.onModuleInit(); f.consumer.onModuleInit();
    for (const type of ["service.appointment.scheduled", "service.payment.recorded_at_attendance"]) assert.equal(f.bus.handlersFor(type).length, 1);
    for (const type of ["service.appointment.pending", "service.appointment.rescheduled", "service.appointment.cancelled", "service.appointment.completed", "order.confirmed", "order.shipped"]) assert.equal(f.bus.handlersFor(type).length, 0);
  });
  await t.test("canonical local pending booking includes service/professional/date/time/zone/value without a PSP approval", async () => {
    const f = fixture(), before = f.business(); await f.run(); assert.equal(f.sent.length, 1); const msg = f.sent[0];
    assert.equal(msg.appointmentId, "a"); assert.equal(msg.eventId, "event"); assert.equal(msg.toPhone, recipient); assert.equal(msg.part, "text");
    for (const value of ["Consultation", "Professional", "03/01/2030", "10:00", "America/Sao_Paulo", "50,00", "no atendimento"]) assert.ok(msg.freeformText.includes(value), value);
    assert.equal(msg.type, "service_appointment_notice"); assert.equal(msg.orderId, undefined); assert.equal(/pagamento aprovado|pedido enviado/i.test(msg.freeformText), false);
    assert.deepEqual(f.business(), before); assert.equal(f.state.deliveries.length, 1); assert.equal(f.state.deliveries[0].state, "sent");
    assert.ok(f.state.deliveries[0].providerMessageId); assert.equal(JSON.stringify(f.state.deliveries).includes("synthetic-private-token"), false);
  });
  await t.test("duplicate and simultaneous delivery of the same original claim produce one durable request", async () => {
    const f = fixture(); await Promise.all([f.run(), f.run()]); const before = structuredClone(f.state.deliveries); await f.run();
    assert.equal(f.sent.length, 1); assert.deepEqual(f.state.deliveries, before);
  });
  await t.test("no direct/mutated/foreign/expired event can adopt the original claim", async () => {
    for (const change of [{ eventId: "other" }, { merchantId: "foreign" }, { correlationId: "other" }, { schemaVersion: 2 }, { payload: { appointmentId: "other", version: 1, operationalStatus: "scheduled" } }]) {
      const f = fixture(), e = { ...f.event(), ...change }; Object.defineProperty(e, "deliveryLeaseToken", { value: "lease", enumerable: false });
      await assert.rejects(f.consumer.handle(e), /service_notice_/); assert.equal(f.sent.length + f.state.deliveries.length, 0);
    }
    const f = fixture(); await assert.rejects(f.consumer.handle({ ...f.event() }), /service_notice_claim_required/);
    f.state.event.leaseExpiresAt = new Date(0); await assert.rejects(f.run(), /service_notice_lease_lost/); assert.equal(f.sent.length, 0);
  });
  await t.test("scheduled notices superseded by cancellation or rescheduling never show an obsolete confirmation", async () => {
    for (const status of ["cancelled", "scheduled"]) { const f = fixture(); f.state.appointment.version = 2; f.state.appointment.operationalStatus = status;
      const before = f.business(); await f.run(); assert.equal(f.sent.length, 0); assert.deepEqual(f.business(), before); }
  });
  await t.test("a later operational version does not erase the original local receipt or turn it into provider approval", async () => {
    const f = fixture("receipt"); f.state.appointment.version = 4; f.state.appointment.operationalStatus = "completed"; const before = f.business(); await f.run();
    assert.equal(f.sent.length, 1); assert.match(f.sent[0].freeformText, /registrado no atendimento/i); assert.match(f.sent[0].freeformText, /Cash/);
    assert.equal(/pagamento aprovado|confirmado pelo provedor/i.test(f.sent[0].freeformText), false); assert.deepEqual(f.business(), before);
  });
  await t.test("a foreign receipt/payment or unrelated command audit cannot authorize notification", async () => {
    for (const mutate of [(f: any) => { f.state.receipt.appointmentPaymentId = "other"; }, (f: any) => { f.state.audit.action = "reschedule"; }, (f: any) => { f.state.payments[0].version = 1; }]) {
      const f = fixture("receipt"); mutate(f); const before = f.business(); await assert.rejects(f.run(), /service_notice_/); assert.equal(f.sent.length, 0); assert.deepEqual(f.business(), before);
    }
  });
  await t.test("media precedes text and uncertain media does not suppress or duplicate text", async () => {
    const f = fixture("scheduled", facts => ({ text: facts.text, mediaUrl: "https://example.test/service.webp" })); const before = f.business(); await f.run(); await f.run();
    assert.deepEqual(f.sent.map(r => r.part), ["media", "text"]); assert.equal(f.state.deliveries.length, 2);
    assert.equal(f.state.deliveries.find((r: any) => r.response.part === "media").state, "submission_unknown");
    assert.equal(f.state.deliveries.find((r: any) => r.response.part === "text").state, "sent"); assert.deepEqual(f.business(), before);
  });
  await t.test("unknown and failed provider results stay truthful and never resend or change the booking", async () => {
    for (const outcome of ["unknown", "failed", "throw"]) { const f = fixture(), before = f.business(); f.result(outcome); await f.run(); await f.run();
      assert.equal(f.sent.length, 1); assert.equal(f.state.deliveries[0].state, outcome === "failed" ? "notification_failed" : "submission_unknown"); assert.deepEqual(f.business(), before); }
  });
  await t.test("the actual request boundary rejects an appointment/config/lease change after asynchronous preparation", async () => {
    for (const mutate of [(f: any) => { f.state.appointment.version++; }, (f: any) => { f.state.config.credentials.accessToken = "rotated"; }, (f: any) => { f.state.event.leaseToken = "replaced"; }]) {
      const f = fixture(); f.mutateBeforeStart(() => mutate(f)); await f.run(); assert.equal(f.sent.length, 0);
      assert.equal(f.state.deliveries[0].state, "notification_failed");
    }
  });
  await t.test("missing contacts or disabled connection never produce a fake success or use global credentials", async () => {
    const a = fixture(); a.state.appointment.customerSnapshot.phone = undefined; await a.run(); assert.equal(a.sent.length, 0);
    const b = fixture(); b.state.config.enabled = false; await b.run(); assert.equal(b.sent.length, 0);
    assert.equal([...a.state.deliveries, ...b.state.deliveries].some((r: any) => r.state === "sent"), false);
  });
  await t.test("scheduled local-paid claims require immutable scoped exact-currency receipts rather than an approved status alone", async () => {
    for (const historical of [[], [{ id: "r", merchantId: "m", appointmentPaymentId: "money", amountCents: 5000, currency: "USD", operatorId: "owner", paymentMethod: "Cash", receivedAt: now }],
      [{ id: "r", merchantId: "m", appointmentPaymentId: "other", amountCents: 5000, currency: "BRL", operatorId: "owner", paymentMethod: "Cash", receivedAt: now }],
      [{ id: "r", merchantId: "m", appointmentPaymentId: "money", amountCents: 4000, currency: "BRL", operatorId: "owner", paymentMethod: "Cash", receivedAt: now }]]) {
      const f = fixture(); f.state.payments[0].status = "approved"; f.state.payments[0].receivedAt = now;
      (f.consumer as any).prisma.attendanceReceipt.findMany = async () => structuredClone(historical);
      const before = f.business(); await assert.rejects(f.run(), /service_notice_finance_unavailable/); assert.equal(f.sent.length, 0); assert.deepEqual(f.business(), before);
    }
    const f = fixture(); f.state.payments[0].status = "approved"; f.state.payments[0].receivedAt = now;
    (f.consumer as any).prisma.attendanceReceipt.findMany = async () => [{ id: "r", merchantId: "m", appointmentPaymentId: "money", amountCents: 5000, currency: "BRL", operatorId: "owner", paymentMethod: "Cash", receivedAt: now }];
    await f.run(); assert.equal(f.sent.length, 1); assert.match(f.sent[0].freeformText, /Pagamento registrado no atendimento/);
  });
  await t.test("a legitimately admitted zero-value local service has no payment to collect and invents no receipt", async () => {
    const f = fixture(); f.state.appointment.priceInCents = 0; f.state.payments[0].amountCents = 0;
    const before = f.business(); await f.run(); assert.equal(f.sent.length, 1); assert.match(f.sent[0].freeformText, /Sem valor a pagar/);
    assert.doesNotMatch(f.sent[0].freeformText, /pagamento.*pendente|registrado no atendimento|confirmado pelo provedor/i); assert.deepEqual(f.business(), before);
  });
  await t.test("template and freeform eligibility is checked after preparation at the actual request boundary", async () => {
    for (const change of [{ isActive: false }, { metaRevision: 2 }, { metaWabaId: "999999" }, { metaLanguage: "en_US" }, { metaStatus: "rejected" }]) {
      const f = fixture(), template = structuredClone(f.state.template);
      f.transport({ kind: "template", template: { id: template.id, revision: template.metaRevision, wabaId: template.metaWabaId, language: template.metaLanguage,
        category: template.metaCategory, body: template.metaTemplateBody, variableMap: template.metaVariableMap, contentSid: template.twilioContentSid } });
      f.mutateBeforeStart(() => Object.assign(f.state.template, change)); await f.run(); assert.equal(f.sent.length, 0); assert.equal(f.state.deliveries[0].state, "notification_failed");
    }
    const f = fixture(); f.mutateBeforeStart(() => { f.state.inbound.payload.timestamp = now.getTime() - 26 * 3600000; f.state.inbound.createdAt = new Date(now.getTime() - 26 * 3600000); });
    await f.run(); assert.equal(f.sent.length, 0); assert.equal(f.state.deliveries[0].state, "notification_failed");
  });
  await t.test("an invalid optional asset URL leaves exactly one canonical text and preserves the confirmed booking", async () => {
    const f = fixture("scheduled", facts => ({ text: facts.text, mediaUrl: "http://example.test/unavailable.webp" })), before = f.business();
    await f.run(); assert.deepEqual(f.sent.map(r => r.part), ["text"]); assert.equal(f.state.deliveries.length, 1);
    assert.equal(f.state.deliveries[0].state, "sent"); assert.deepEqual(f.business(), before);
  });
  await t.test("a persisted source from another producer, an unclaimed row or an unrelated audit never grants notice authority", async () => {
    for (const mutate of [(f: any) => { f.state.event.producer = "checkout"; }, (f: any) => { f.state.event.status = "pending"; },
      (f: any) => { f.state.audit.appointmentId = "other"; }, (f: any) => { f.state.audit.version = 2; }, (f: any) => { f.state.audit.action = "reschedule"; }]) {
      const f = fixture(); mutate(f); const before = f.business(); await assert.rejects(f.run(), /service_notice_/);
      assert.equal(f.sent.length + f.state.deliveries.length, 0); assert.deepEqual(f.business(), before);
    }
  });
  await t.test("the transport cannot claim accepted without passing the actual initiation capability", async () => {
    const f = fixture(); (f.consumer as any).sender = { executeService: async () => ({ status: "accepted", channel: "whatsapp_template", messageId: "forged" }) };
    await f.run(); assert.equal(f.sent.length, 0); assert.equal(f.state.deliveries[0].state, "submission_unknown");
  });
});
