import assert from "node:assert/strict";
import test from "node:test";
import { SupportHandoffService } from "./support-handoff.service.js";
import { SERVICE_APPOINTMENT_CHANGE_ACK } from "./service-appointment-change-request.js";
import { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { WhatsAppHumanIntakeService } from "../../whatsapp-channel/application/services/whatsapp-human-intake.service.js";
import { WhatsAppTurnContext } from "../../whatsapp-channel/domain/services/whatsapp-turn-context.js";

// Composition proof with explicit in-memory Prisma/SQL delegates. The real
// intake, repository locks, turn context, handoff and policy reader execute.
// This fixture does not prove actual SQL, HTTP ingress or Meta delivery.
function fixture(options: { mode?: "products" | "services"; account?: "missing" | "empty" | "mismatch"; ambiguous?: boolean } = {}) {
  const scope = { merchantId: "merchant", configId: "config", whatsappSessionId: "session" };
  const phone = "5511999998888", now = new Date("2030-01-01T12:00:00Z"), trace: string[] = [];
  const merchant = { id: scope.merchantId, name: "Empresa", businessMode: options.mode ?? "services",
    businessModeSelectedAt: new Date("2029-01-01T00:00:00Z"), businessModeNeedsReview: false,
    storeSettings: { policies: { general: "Remarcações serão analisadas pela equipe." } }, updatedAt: new Date("2029-01-01T00:00:00Z") };
  const session = { id: scope.whatsappSessionId, merchantId: scope.merchantId, deviceId: "device", buyerPhone: phone,
    checkoutSessionId: null, conversationState: { conversationId: "conversation" } };
  const config = { id: scope.configId, merchantId: scope.merchantId, deviceId: "device", provider: "META_CLOUD", credentials: {}, enabled: true, status: "ACTIVE" };
  const account = options.account === "missing" ? null : { globalUserId: "buyer", phone: options.account === "empty" ? "" : options.account === "mismatch" ? "5511888887777" : phone };
  const appointment = { id: "owned-123", merchantId: scope.merchantId, buyerGlobalUserId: "buyer", professionalId: "professional", productId: "service", variantId: "variant",
    startsAt: new Date("2030-01-02T13:00:00Z"), endsAt: new Date("2030-01-02T13:30:00Z"), timeZone: "America/Sao_Paulo", durationMinutes: 30,
    priceInCents: 5000, currency: "BRL", operationalStatus: "scheduled", version: 3, policyVersion: 7,
    product: { name: "Consulta canônica" }, professional: { publicName: "Profissional canônico" } };
  const appointments = [appointment, ...(options.ambiguous ? [{ ...appointment, id: "owned-456" }] : [])];
  const business = { appointments, cart: { id: "cart", quantity: 2, total: 9000 }, payments: [], refunds: [], orders: [], stock: [] };
  const state: { tickets: any[]; messages: any[]; bindings: any[]; events: any[]; alerts: any[] } = { tickets: [], messages: [], bindings: [], events: [], alerts: [] };
  const published: unknown[] = [], appointmentQueries: unknown[] = [];
  let messageSequence = 0;
  const byScope = (row: any, where: any) => Object.entries(where).every(([key, value]) => typeof value === "object" && value !== null
    ? key === "status" && Array.isArray((value as any).in) && (value as any).in.includes(row[key]) : row[key] === value);
  const tx: any = {
    $queryRaw: async (query: any) => {
      const sql = (Array.isArray(query) ? query : query.strings).join("?");
      if (sql.includes("clock_timestamp")) return [{ now }];
      if (sql.includes("FROM merchants")) { trace.push("merchant-lock"); return [{ id: scope.merchantId }]; }
      if (sql.includes("FROM buyer_accounts")) { trace.push("account-lock"); return account ? [{ global_user_id: "buyer" }] : []; }
      if (sql.includes("FROM whatsapp_sessions")) return [{ id: session.id }];
      if (sql.includes("pg_advisory_xact_lock")) return [];
      assert.fail("unexpected SQL delegate: " + sql);
    },
    merchant: { findUnique: async ({ where, select }: any) => { assert.equal(where.id, scope.merchantId); if (select?.businessMode) trace.push("mode-read"); return structuredClone(merchant); } },
    buyerAccount: { findUnique: async ({ where }: any) => { trace.push("account-read"); assert.equal(where.globalUserId, "buyer"); return structuredClone(account); } },
    buyerIdentity: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where, { merchantId_identityKey: { merchantId: scope.merchantId, identityKey: "phone:" + phone } });
      return { merchantId: scope.merchantId, identityKey: "phone:" + phone, globalUserId: "buyer" };
    } },
    whatsAppSession: { findFirst: async ({ where }: any) => byScope(session, where) ? structuredClone(session) : null },
    whatsAppChannelConfig: { findFirst: async ({ where }: any) => byScope(config, where) ? structuredClone(config) : null },
    whatsAppWebhookInbox: { findFirst: async ({ where }: any) => {
      assert.deepEqual({ ...where, leaseExpiresAt: undefined }, { id: "inbox", ...{ merchantId: scope.merchantId, configId: scope.configId }, kind: "message", status: "processing", leaseToken: "lease", leaseExpiresAt: undefined });
      assert.ok(where.leaseExpiresAt.gt instanceof Date);
      return { id: "inbox", deviceId: "device", payload: { merchantId: scope.merchantId, deviceId: "device", fromNumber: phone } };
    } },
    merchantPolicy: { findUnique: async () => null },
    serviceAppointment: { findMany: async ({ where }: any) => {
      trace.push("appointment-read"); appointmentQueries.push(structuredClone(where));
      return appointments.filter(row => byScope(row, where)).map(row => structuredClone(row));
    } },
    supportTicket: {
      findFirst: async ({ where }: any) => structuredClone(state.tickets.find(row => byScope(row, where)) ?? null),
      create: async ({ data }: any) => { const row = { mergedIntoId: null, ...structuredClone(data) }; state.tickets.push(row); return structuredClone(row); },
      update: async ({ where, data }: any) => { const row = state.tickets.find(item => item.id === where.id); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); },
    },
    supportTicketMessage: {
      findFirst: async ({ where, orderBy }: any) => { const rows = state.messages.filter(row => byScope(row, where));
        if (orderBy?.createdAt === "desc") rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); return structuredClone(rows[0] ?? null); },
      create: async ({ data }: any) => { const row = { id: "message-" + (++messageSequence), ...structuredClone(data) }; state.messages.push(row); return structuredClone(row); },
    },
    whatsAppHandoffBinding: {
      findFirst: async ({ where }: any) => structuredClone(state.bindings.find(row => byScope(row, where)) ?? null),
      create: async ({ data }: any) => { const row = { id: "binding", mode: "ai", epoch: 0, ticketId: null, assignedOperatorId: null, ...structuredClone(data) }; state.bindings.push(row); return structuredClone(row); },
      updateMany: async ({ where, data }: any) => { const rows = state.bindings.filter(row => byScope(row, where)); rows.forEach(row => Object.assign(row, structuredClone(data))); return { count: rows.length }; },
    },
    outboxMessage: { upsert: async ({ where, create }: any) => { const previous = state.events.find(row => row.eventId === where.eventId); if (previous) return structuredClone(previous);
      state.events.push(structuredClone(create)); return structuredClone(create); } },
    supportNotificationSetting: { findUnique: async () => null },
    whatsAppDelivery: { create: async ({ data }: any) => { state.alerts.push(structuredClone(data)); return structuredClone(data); } },
  };
  const prisma: any = { $transaction: async (work: (delegate: any) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await work(tx); } catch (error) { Object.assign(state, before); throw error; }
  } };
  const context = new WhatsAppTurnContext(), bindings = new PrismaWhatsAppHandoffRepository(prisma);
  const handoff = new SupportHandoffService({} as never, { publishCreated: (ticket: unknown) => published.push(structuredClone(ticket)) } as never, prisma, bindings, context);
  const humanIntake = new WhatsAppHumanIntakeService(handoff, context, {} as never);
  const request = (message = "Quero remarcar meu agendamento") => context.run({ scope, inboxId: "inbox", leaseToken: "lease", conversationId: "conversation", message, origin: "text" },
    () => humanIntake.requestText({ merchantId: scope.merchantId, deviceId: "device", fromNumber: phone, body: message } as never));
  return { request, state, business, trace, published, appointmentQueries, phone };
}

test("C21 REG-01 native intake chooses canonical mode before service-only owner prerequisites", async t => {
  for (const account of ["missing", "empty", "mismatch"] as const) await t.test("product legacy identity with " + account + " canonical account stays on the original path", async () => {
    const f = fixture({ mode: "products", account }), before = structuredClone(f.business);
    const result = await f.request();
    assert.equal(result, undefined, "product processing must receive no service-change interception notice");
    assert.deepEqual(f.state, { tickets: [], messages: [], bindings: [], events: [], alerts: [] });
    assert.deepEqual(f.business, before); assert.deepEqual(f.published, []); assert.deepEqual(f.appointmentQueries, []);
    assert.ok(f.trace.includes("mode-read")); assert.equal(f.trace.includes("account-read"), false); assert.equal(f.trace.includes("account-lock"), false);
  });
  await t.test("services phone mismatch cannot expose an ambiguous appointment list", async () => {
    const f = fixture({ account: "mismatch", ambiguous: true }), before = structuredClone(f.business), result = await f.request();
    assert.equal(result?.confirmed, false); assert.ok(result?.reply);
    assert.doesNotMatch(result.reply, /owned-123|owned-456|Consulta canônica|Profissional canônico|Qual agendamento/);
    assert.deepEqual(f.appointmentQueries, []); assert.deepEqual(f.business, before);
    assert.deepEqual(f.state, { tickets: [], messages: [], bindings: [], events: [], alerts: [] }); assert.deepEqual(f.published, []);
    assert.ok(f.trace.indexOf("mode-read") < f.trace.indexOf("account-lock"));
    assert.ok(f.trace.indexOf("merchant-lock") < f.trace.indexOf("account-lock"));
  });
  await t.test("verified service owner persists the linked canonical appointment and public policy context", async () => {
    const f = fixture(), before = structuredClone(f.business), result = await f.request("Quero remarcar o agendamento #owned-123");
    assert.equal(result?.confirmed, true); assert.equal(result?.reply, SERVICE_APPOINTMENT_CHANGE_ACK);
    assert.equal(result?.bindingId, "binding"); assert.equal(result?.epoch, 1); assert.equal(f.state.tickets.length, 1); assert.equal(result?.ticketId, f.state.tickets[0].id);
    assert.equal(f.state.tickets[0].buyerId, "buyer"); assert.equal(f.state.tickets[0].source, "whatsapp");
    assert.equal(f.state.messages.length, 2); const [buyer, operator] = f.state.messages;
    assert.equal(buyer.senderType, "buyer"); assert.equal(buyer.metadata.kind, "whatsapp_intake"); assert.equal(buyer.metadata.appointmentId, "owned-123"); assert.equal(buyer.metadata.policyVersion, 7);
    assert.equal(operator.senderType, "system"); assert.equal(operator.metadata.requestMessageId, buyer.id);
    assert.equal(operator.metadata.action, "reschedule"); assert.equal(operator.metadata.appointmentId, "owned-123"); assert.equal(operator.metadata.appointmentVersion, 3); assert.equal(operator.metadata.policyVersion, 7);
    assert.match(operator.metadata.policyHash, /^[a-f0-9]{64}$/); assert.ok(operator.metadata.publishedPolicies.some((policy: any) => policy.sourceId === "general"));
    assert.match(operator.content, /Consulta canônica/); assert.match(operator.content, /Remarcações serão analisadas/);
    assert.doesNotMatch(JSON.stringify({ buyer: buyer.metadata, operator }), /5511999998888|customerSnapshot|providerEvidence/);
    assert.deepEqual(f.appointmentQueries, [{ merchantId: "merchant", buyerGlobalUserId: "buyer", id: "owned-123" }]);
    assert.deepEqual(f.business, before); assert.equal(f.published.length, 1); assert.equal(f.state.bindings[0].mode, "waiting_human");
    assert.ok(f.trace.indexOf("mode-read") < f.trace.indexOf("account-lock")); assert.ok(f.trace.indexOf("account-lock") < f.trace.indexOf("appointment-read"));
  });
  await t.test("verified service owner must select an appointment before any handoff/context write", async () => {
    const f = fixture({ ambiguous: true }), before = structuredClone(f.business), result = await f.request();
    assert.equal(result?.confirmed, false); assert.match(result!.reply, /Qual agendamento/); assert.match(result!.reply, /#owned-123/); assert.match(result!.reply, /#owned-456/);
    assert.deepEqual(f.appointmentQueries, [{ merchantId: "merchant", buyerGlobalUserId: "buyer" }]);
    assert.deepEqual(f.state, { tickets: [], messages: [], bindings: [], events: [], alerts: [] }); assert.deepEqual(f.published, []); assert.deepEqual(f.business, before);
    assert.ok(f.trace.indexOf("account-lock") < f.trace.indexOf("appointment-read"));
  });
});
