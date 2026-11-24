import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { DomainEvent } from "../src/shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { ServiceAppointmentEventsConsumer } from "../src/modules/notifications/application/service-appointment-events.consumer.js";
import { OrderNotificationWhatsAppAdapter } from "../src/modules/notifications/infrastructure/adapters/order-notification-whatsapp.adapter.js";

// Synthetic transport component only: real consumer/formatter/adapter and private
// initiation fences; in-memory persistence and captured fetch, never a live PSP,
// Meta connection, authenticated HTTP server or SQL persistence proof.
const recipient = "+5521999990000", mediaUrl = "https://example.test/service-confirmed.webp";
const leads = { consultative: "Confira os detalhes do seu atendimento.", premium: "Confira os detalhes do seu atendimento com aten\u00e7\u00e3o.",
  direct: "Resumo do atendimento:", friendly: "Separei os detalhes para voc\u00ea conferir.", technical: "Resumo do agendamento e da situa\u00e7\u00e3o financeira." };
type Tone = keyof typeof leads;
type MediaOutcome = "rejected" | "unavailable" | "throws" | "accepted";
type TextOutcome = "accepted" | "rejected" | "missing_id";
interface CapturedPost { url: string; method: string | undefined; canonicalAuthorization: boolean; body: any }

function fixture(tone: Tone = "consultative") {
  const createdAt = new Date(Date.now() - 1000);
  const state: any = {
    appointment: { id: "a", merchantId: "m", professionalId: "p", productId: "s", variantId: "v", version: 1,
      operationalStatus: "scheduled", startsAt: new Date("2030-01-03T13:00:00Z"), endsAt: new Date("2030-01-03T13:20:00Z"),
      timeZone: "America/Sao_Paulo", priceInCents: 5000, currency: "BRL", customerSnapshot: { name: "Synthetic buyer", phone: recipient, email: "private@example.test" } },
    payments: [{ id: "money", merchantId: "m", appointmentId: "a", mode: "at_attendance", status: "pending", amountCents: 5000,
      currency: "BRL", version: 1, receivedAt: null, paymentIntentId: null }],
    audit: { merchantId: "m", appointmentId: "a", commandId: "original", version: 1, action: "manual_create", after: { operationalStatus: "scheduled" } },
    event: { eventId: "event", merchantId: "m", eventType: "service.appointment.scheduled", correlationId: "a", causationId: "original",
      producer: "service-booking", schemaVersion: 1, status: "processing", leaseToken: "lease", leaseExpiresAt: new Date(Date.now() + 120000),
      payload: { appointmentId: "a", version: 1, operationalStatus: "scheduled" } },
    rule: { id: "canonical-rule", merchantId: "m", agentId: "default", userId: null, scope: "merchant_default", identity: { tone, persona: "PRIVATE_C69_PERSONA" } },
    inbound: { createdAt, payload: { provider: "META_CLOUD", merchantId: "m", deviceId: "META_CLOUD:c", fromNumber: recipient, timestamp: createdAt.getTime() } },
    config: { id: "c", merchantId: "m", provider: "META_CLOUD", enabled: true, status: "ACTIVE", deviceId: "META_CLOUD:c",
      whatsappNumber: "+5521999999999", credentials: { accessToken: "synthetic-private-token", wabaId: "123456", phoneNumberId: "654321" } },
    deliveries: [],
  };
  const writes: string[] = [], presentations: string[] = [];
  const business = () => structuredClone({ appointment: state.appointment, payments: state.payments, audit: state.audit, event: state.event });
  const forbidden = (operation: string) => async () => { writes.push(operation); assert.fail("notice attempted business mutation: " + operation); };
  const protectedWrites = (model: string) => Object.fromEntries(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"].map(op => [op, forbidden(model + "." + op)]));
  const match = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: any) => value && typeof value === "object" && value.in ? value.in.includes(row[key]) : row[key] === value);
  const tx: any = {
    $queryRaw: async (sql: any) => (Array.isArray(sql) ? sql : sql.strings ?? []).join("").includes("clock_timestamp") ? [{ now: new Date() }] : [{ id: "locked" }],
    merchant: { ...protectedWrites("merchant"), findUnique: async ({ where }: any) => where.id === "m" ? { id: "m", name: "Synthetic services" } : null },
    agentRule: { ...protectedWrites("agentRule"), findFirst: async ({ where }: any) => match(state.rule, where) ? structuredClone(state.rule) : null },
    serviceAppointment: { ...protectedWrites("serviceAppointment"), findFirst: async ({ where }: any) => match(state.appointment, where) ? structuredClone(state.appointment) : null },
    serviceProfessional: { ...protectedWrites("serviceProfessional"), findFirst: async ({ where }: any) => where.id === "p" && where.merchantId === "m" ? { id: "p", merchantId: "m", publicName: "Synthetic professional" } : null },
    product: { ...protectedWrites("product"), findFirst: async ({ where }: any) => where.id === "s" && where.merchantId === "m" && where.type === "service" ? { id: "s", merchantId: "m", name: "Synthetic consultation", type: "service" } : null },
    appointmentPayment: { ...protectedWrites("appointmentPayment"), findMany: async ({ where }: any) => structuredClone(state.payments.filter((row: any) => match(row, where))) },
    attendanceReceipt: { ...protectedWrites("attendanceReceipt"), findFirst: async () => null, findMany: async () => [] },
    appointmentAudit: { ...protectedWrites("appointmentAudit"), findUnique: async ({ where }: any) => where.merchantId_commandId.merchantId === "m" && where.merchantId_commandId.commandId === "original" ? structuredClone(state.audit) : null },
    outboxMessage: { ...protectedWrites("outboxMessage"), findFirst: async ({ where }: any) => match(state.event, where) ? structuredClone(state.event) : null },
    whatsAppChannelConfig: { ...protectedWrites("whatsAppChannelConfig"), findUnique: async ({ where }: any) => where.merchantId === "m" ? structuredClone(state.config) : null },
    whatsAppWebhookInbox: { ...protectedWrites("whatsAppWebhookInbox"), findFirst: async () => structuredClone(state.inbound) },
    postSaleMessageTemplate: { ...protectedWrites("postSaleMessageTemplate"), findFirst: async () => null },
    whatsAppDelivery: {
      findUnique: async ({ where }: any) => structuredClone(state.deliveries.find((row: any) => row.id === where.id) ?? null),
      create: async ({ data }: any) => { assert.equal(state.deliveries.some((row: any) => row.id === data.id), false); state.deliveries.push(structuredClone(data)); return structuredClone(data); },
      updateMany: async ({ where, data }: any) => { const row = state.deliveries.find((candidate: any) => match(candidate, where)); if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; },
    },
    completedOrder: protectedWrites("completedOrder"), paymentIntent: protectedWrites("paymentIntent"),
    inventoryMovement: protectedWrites("inventoryMovement"), inventoryItem: protectedWrites("inventoryItem"), productStock: protectedWrites("productStock"),
  };
  const prisma: any = { ...tx, $transaction: async (work: any) => work(tx) };
  const configs: any = { findByMerchantId: async (merchantId: string) => merchantId === "m" ? structuredClone(state.config) : null };
  const templates: any = { execute: forbidden("unexpected_template_channel") };
  const adapter = new OrderNotificationWhatsAppAdapter(prisma as PrismaClient, configs, templates);
  const bus = new InMemoryDomainEventBus(); bus.publish = forbidden("unexpected_domain_event");
  const consumer = new ServiceAppointmentEventsConsumer(prisma as PrismaClient, adapter, bus, new TenantContextService(), facts => {
    presentations.push(facts.text); return { text: facts.text, mediaUrl };
  });
  const event = (): DomainEvent => { const value: DomainEvent = { eventId: state.event.eventId, merchantId: state.event.merchantId, eventType: state.event.eventType,
    schemaVersion: state.event.schemaVersion, correlationId: state.event.correlationId, causationId: state.event.causationId, payload: structuredClone(state.event.payload) };
    Object.defineProperty(value, "deliveryLeaseToken", { value: state.event.leaseToken, enumerable: false }); return value; };
  return { state, writes, presentations, business, run: () => consumer.handle(event()) };
}

async function capture(media: MediaOutcome, text: TextOutcome, work: (posts: CapturedPost[]) => Promise<void>) {
  const previousFetch = globalThis.fetch, posts: CapturedPost[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    posts.push({ url: String(url), method: init?.method, canonicalAuthorization: init?.headers?.Authorization === "Bearer synthetic-private-token", body });
    if (body?.type === "sticker") {
      if (media === "throws") throw Error("synthetic media connection failure");
      if (media === "rejected") return new Response(JSON.stringify({ error: { message: "Synthetic media rejected" } }), { status: 400 });
      if (media === "unavailable") return new Response(JSON.stringify({ error: { message: "Synthetic media unavailable" } }), { status: 503 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid-media-c69" }] }), { status: 200 });
    }
    if (body?.type === "text") return text === "rejected"
      ? new Response(JSON.stringify({ error: { message: "Synthetic text rejected" } }), { status: 400 })
      : new Response(JSON.stringify(text === "missing_id" ? { messages: [] } : { messages: [{ id: "wamid-text-c69" }] }), { status: 200 });
    throw Error("unexpected synthetic transport payload");
  }) as typeof fetch;
  try { await work(posts); } finally { globalThis.fetch = previousFetch; }
}

function assertRequests(posts: CapturedPost[], expectedText: string) {
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map(post => post.body?.type), ["sticker", "text"]);
  for (const post of posts) { assert.equal(post.url, "https://graph.facebook.com/v23.0/654321/messages"); assert.equal(post.method, "POST");
    assert.equal(post.canonicalAuthorization, true); assert.equal(post.body.messaging_product, "whatsapp"); assert.equal(post.body.to, recipient.slice(1));
    assert.match(post.body.biz_opaque_callback_data, /^service_notification:[a-f0-9]{64}$/); }
  assert.notEqual(posts[0].body.biz_opaque_callback_data, posts[1].body.biz_opaque_callback_data);
  assert.deepEqual(posts[0].body.sticker, { link: mediaUrl }); assert.equal(posts[0].body.text, undefined);
  assert.deepEqual(posts[1].body.text, { body: expectedText }); assert.equal(posts[1].body.sticker, undefined);
}

function assertBusiness(f: ReturnType<typeof fixture>, before: ReturnType<ReturnType<typeof fixture>["business"]>) {
  assert.deepEqual(f.business(), before); assert.deepEqual(f.writes, []);
  assert.equal(f.state.appointment.operationalStatus, "scheduled"); assert.equal(f.state.appointment.version, 1);
  assert.equal(f.state.payments[0].status, "pending"); assert.equal(f.state.payments[0].paymentIntentId, null);
  assert.equal(f.state.payments[0].receivedAt, null);
}

function assertText(text: string, tone: Tone) {
  assert.ok(text.startsWith("\ud83e\udd16")); assert.match(text, /\*Agendamento confirmado\*/); assert.ok(text.includes(leads[tone])); assert.ok(text.includes("\n\n"));
  for (const fact of ["Synthetic services", "Synthetic consultation", "Synthetic professional", "03/01/2030", "10:00", "10:20", "America/Sao_Paulo", "50,00", "Pagamento no atendimento: pendente."]) assert.ok(text.includes(fact), fact);
  assert.doesNotMatch(text, /PRIVATE_C69_PERSONA|private@example\.test|synthetic-private-token|Total pago|pedido enviado|confirmado pelo provedor|pagamento aprovado/i);
}

test("C69 actual send-boundary media fallback preserves canonical confirmed booking", async t => {
  for (const tone of Object.keys(leads) as Tone[]) await t.test("media HTTP 400 preserves accepted canonical text in configured tone " + tone, async () => {
    const f = fixture(tone), before = f.business();
    await capture("rejected", "accepted", async posts => {
      await f.run(); assert.equal(f.presentations.length, 1); const text = f.presentations[0]; assertText(text, tone); assertRequests(posts, text);
      assert.deepEqual(f.state.deliveries.map((row: any) => [row.response.part, row.state, row.providerMessageId]), [["media", "notification_failed", null], ["text", "sent", "wamid-text-c69"]]);
      assert.equal(f.state.deliveries[0].response.reason, "meta_http_400"); assert.equal(f.state.deliveries[1].response.status, "accepted");
      for (const row of f.state.deliveries) assert.equal(row.response.requestInvoked, true);
      assertBusiness(f, before); const claims = structuredClone(f.state.deliveries); await f.run();
      assert.equal(posts.length, 2); assert.deepEqual(f.state.deliveries, claims); assertBusiness(f, before);
      assert.doesNotMatch(JSON.stringify(f.state.deliveries), /PRIVATE_C69_PERSONA|private@example\.test|synthetic-private-token/);
    });
  });
  for (const outcome of ["unavailable", "throws"] as const) await t.test("uncertain media " + outcome + " still attempts text once without resending media", async () => {
    const f = fixture(), before = f.business();
    await capture(outcome, "accepted", async posts => {
      await f.run(); assertText(f.presentations[0], "consultative"); assertRequests(posts, f.presentations[0]);
      assert.deepEqual(f.state.deliveries.map((row: any) => [row.response.part, row.state, row.providerMessageId]), [["media", "submission_unknown", null], ["text", "sent", "wamid-text-c69"]]);
      assert.equal(f.state.deliveries[0].response.status, "unknown"); assert.equal(f.state.deliveries[1].response.status, "accepted");
      const claims = structuredClone(f.state.deliveries); await f.run(); assert.equal(posts.length, 2); assert.deepEqual(f.state.deliveries, claims); assertBusiness(f, before);
    });
  });
  await t.test("text rejection or missing message ID never becomes a successful send or alters the confirmed appointment", async () => {
    for (const textOutcome of ["rejected", "missing_id"] as const) {
      const f = fixture(), before = f.business();
      await capture("rejected", textOutcome, async posts => {
        await f.run(); assertRequests(posts, f.presentations[0]); assertText(f.presentations[0], "consultative");
        const text = f.state.deliveries.find((row: any) => row.response.part === "text");
        assert.equal(text.state, textOutcome === "rejected" ? "notification_failed" : "submission_unknown"); assert.equal(text.providerMessageId, null);
        assert.equal(text.response.status, textOutcome === "rejected" ? "failed" : "unknown"); assert.equal(text.response.requestInvoked, true);
        assertBusiness(f, before); const claims = structuredClone(f.state.deliveries); await f.run();
        assert.equal(posts.length, 2); assert.deepEqual(f.state.deliveries, claims); assertBusiness(f, before);
      });
    }
  });
  await t.test("successful optional media still precedes its independent text claim", async () => {
    const f = fixture(), before = f.business();
    await capture("accepted", "accepted", async posts => {
      await f.run(); assertRequests(posts, f.presentations[0]); assertText(f.presentations[0], "consultative");
      assert.deepEqual(f.state.deliveries.map((row: any) => [row.response.part, row.state, row.providerMessageId]), [["media", "sent", "wamid-media-c69"], ["text", "sent", "wamid-text-c69"]]);
      assertBusiness(f, before);
    });
  });
});
