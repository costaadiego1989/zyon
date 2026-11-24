import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createNativeServiceJourneyFixture, type NativeJourneyCase } from "./service-channel-journey.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Real signed Meta ingress, existing durable worker/VerifiedTurn, real SQL/Redis
// and real select/prepare/confirm. Voice is the existing exact captured-media
// boundary, not Ogg/STT accuracy. Final transport is captured, not Meta delivery.
test("C21 buyer request reaches a linked human case without changing the appointment", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createNativeServiceJourneyFixture({ serviceReleaseFixture: "matching", voiceTranscripts: { "2101": "Preciso remarcar minha consulta." } });
  const publish = async (c: NativeJourneyCase) => { const merchant = await f.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
    await f.prisma.merchant.update({ where: { id: c.merchantId }, data: { storeSettings: { ...(merchant.storeSettings as any), policies: { general: "Solicitações de alteração são analisadas pela equipe da empresa." } } } }); };
  const book = async (c: NativeJourneyCase) => { await f.review(c); await f.choose(c, "continue"); await f.choose(c, "confirm");
    const rows = (await f.snapshot(c)).appointments; assert.ok(rows.length); return rows.at(-1)!; };
  const frozen = async (c: NativeJourneyCase) => ({ domain: await f.snapshot(c),
    checkouts: await f.prisma.checkoutSession.findMany({ where: { merchantId: c.merchantId }, orderBy: { id: "asc" } }),
    carts: await f.prisma.storefrontCart.findMany({ where: { merchantId: c.merchantId }, orderBy: { sessionId: "asc" }, select: { merchantId: true, sessionId: true, items: true, total: true, discount: true, freeShipping: true } }),
    stock: await f.prisma.productStock.findMany({ where: { variantId: c.variantId }, orderBy: { id: "asc" } }),
    holds: (await f.redis.keys("service-slots:{" + createHash("sha256").update(c.merchantId).digest("hex") + "}:*")).sort() });
  const linked = async (c: NativeJourneyCase, appointmentId: string, origin: "text" | "voice", inboxId: string) => {
    const session = await f.read(c), binding = await f.prisma.whatsAppHandoffBinding.findFirstOrThrow({ where: { merchantId: c.merchantId, whatsappSessionId: session.id } });
    assert.equal(binding.mode, "waiting_human"); assert.ok(binding.ticketId);
    const ticket = await f.prisma.supportTicket.findUniqueOrThrow({ where: { id: binding.ticketId! } });
    assert.equal(ticket.source, "whatsapp"); assert.equal(ticket.buyerId, c.buyerId); assert.equal(ticket.sessionId, session.id);
    const buyer = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id, senderType: "buyer" } }), metadata = buyer.metadata as any;
    assert.equal(metadata.kind, "whatsapp_intake"); assert.equal(metadata.appointmentId, appointmentId); assert.equal(metadata.origin, origin); assert.equal(metadata.inboxId, inboxId);
    assert.equal(metadata.serviceAppointmentChange.appointmentId, appointmentId); assert.equal(metadata.serviceAppointmentChange.policyVersion, metadata.policyVersion);
    assert.match(metadata.serviceAppointmentChange.policyHash, /^[a-f0-9]{64}$/);
    const context = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id, senderType: "system", metadata: { path: ["kind"], equals: "service_appointment_change" } } });
    assert.match(context.content, /Solicitações de alteração são analisadas/); assert.ok(context.content.includes("#" + appointmentId));
    assert.equal((context.metadata as any).requestMessageId, buyer.id); assert.equal((context.metadata as any).appointmentId, appointmentId);
    return { ticket, buyer, context };
  };
  const replies = () => f.runtime.whatsapp.events().filter((event: any) => event.kind === "sendText" || event.kind === "sendMedia").map((event: any) => event.input.uiMessage?.text?.body ?? event.input.uiMessage?.interactive?.body?.text ?? event.input.text ?? "").join("\n");
  try {
    await t.test("signed buyer cancellation request links the actual locally confirmed appointment and published policy", async () => {
      const c = await f.make("c21-cancel"); await publish(c); const appointment = await book(c);
      // Owned canonical source precondition only; this does not claim to prove
      // the policy editing UI/writer or change the booked business-policy terms.
      const merchant = await f.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
      const currentPolicy = await f.prisma.merchant.update({ where: { id: c.merchantId }, data: { storeSettings: { ...(merchant.storeSettings as any),
        policies: { general: "Solicitações de alteração são analisadas pela equipe da empresa. Publicação atualizada após o agendamento." } } } });
      const before = await frozen(c);
      const result = await f.message(c, "Quero cancelar o agendamento #" + appointment.id);
      const value = await linked(c, appointment.id, "text", result.inbox.id); assert.match(value.buyer.content, /Quero cancelar/);
      assert.equal((value.buyer.metadata as any).policyVersion, appointment.policyVersion);
      assert.equal((value.buyer.metadata as any).serviceAppointmentChange.policyVersion, appointment.policyVersion);
      assert.ok((value.buyer.metadata as any).serviceAppointmentChange.publishedPolicies.find((p: any) => p.sourceId === "general").sourceVersion.startsWith(String(currentPolicy.updatedAt.getTime()) + ":"));
      assert.match(value.context.content, /Publicação atualizada após o agendamento/);
      assert.equal((value.buyer.metadata as any).serviceAppointmentChange.action, "cancel"); assert.deepEqual(await frozen(c), before);
      assert.match(replies(), /Solicitação encaminhada/); assert.doesNotMatch(replies(), /agendamento foi cancelado|reembolso realizado/i);
    });
    await t.test("duplicate signed request has one intake, operator context, case and alert without replaying business commands", async () => {
      const c = await f.make("c21-replay"); await publish(c); const appointment = await book(c), wire = f.wire(c, "Preciso remarcar o agendamento #" + appointment.id);
      await f.post(wire); const value = await linked(c, appointment.id, "text", (await f.prisma.whatsAppWebhookInbox.findFirstOrThrow({ where: { eventId: wire.eventId } })).id);
      const before = { domain: await frozen(c), messages: await f.prisma.supportTicketMessage.findMany({ where: { ticketId: value.ticket.id }, orderBy: { id: "asc" } }),
        cases: await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), alerts: await f.prisma.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "support" }, select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }) };
      await f.post(wire); assert.deepEqual({ domain: await frozen(c), messages: await f.prisma.supportTicketMessage.findMany({ where: { ticketId: value.ticket.id }, orderBy: { id: "asc" } }),
        cases: await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), alerts: await f.prisma.outboxMessage.findMany({ where: { merchantId: c.merchantId, producer: "support" }, select: { eventId: true, eventType: true, payload: true }, orderBy: { eventId: "asc" } }) }, before);
    });
    await t.test("exact authenticated audio interpretation routes rescheduling to the same human central without changing a slot", async () => {
      const c = await f.make("c21-voice"); await publish(c); const appointment = await book(c), before = await frozen(c);
      const result = await f.message(c, "2101", { audio: true }), value = await linked(c, appointment.id, "voice", result.inbox.id);
      assert.equal(value.buyer.content, "Preciso remarcar minha consulta."); assert.equal((value.buyer.metadata as any).serviceAppointmentChange.action, "reschedule"); assert.deepEqual(await frozen(c), before);
    });
    await t.test("two actual owned bookings require explicit choice before creating the linked human case", async () => {
      const c = await f.make("c21-choice"); await publish(c); await book(c); await book(c); const before = await frozen(c);
      assert.equal(before.domain.appointments.length, 2); await f.message(c, "Quero cancelar meu agendamento");
      assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), 0); assert.deepEqual(await frozen(c), before);
      assert.match(replies(), /Qual agendamento/); for (const row of before.domain.appointments) assert.ok(replies().includes("#" + row.id));
      const target = before.domain.appointments[0]!; const result = await f.message(c, "Quero cancelar o agendamento #" + target.id); await linked(c, target.id, "text", result.inbox.id); assert.deepEqual(await frozen(c), before);
    });
    await t.test("another tenant reference and another buyer reference cannot be linked or disclosed", async () => {
      const own = await f.make("c21-own"), foreign = await f.make("c21-foreign"); await publish(own); await book(own); const foreignAppointment = await book(foreign);
      const before = await frozen(own), result = await f.message(own, "Quero cancelar o agendamento #" + foreignAppointment.id);
      assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: own.merchantId } }), 0); assert.deepEqual(await frozen(own), before);
      const saved = JSON.stringify(result.inbox.responseState); assert.doesNotMatch(saved, /Consulta c21-foreign|Profissional c21-foreign/);
      const otherBuyer = await f.secondBuyer(own); await f.message(otherBuyer, "/servicos"); const count = await f.prisma.supportTicket.count({ where: { merchantId: own.merchantId } });
      await f.message(otherBuyer, "Quero cancelar o agendamento #" + before.domain.appointments[0]!.id); assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: own.merchantId } }), count); assert.deepEqual(await frozen(own), before);
    });
    await t.test("invalid signature and unread audio body cannot create an appointment request", async () => {
      const c = await f.make("c21-media"); const appointment = await book(c), before = await frozen(c);
      await f.post(f.wire(c, "Quero cancelar o agendamento #" + appointment.id), false);
      await f.message(c, "2199", { audio: true }); assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), 0); assert.deepEqual(await frozen(c), before);
    });
    await t.test("changed account phone cannot attribute the old WhatsApp identity to an owned appointment", async () => {
      const c = await f.make("c21-owner-stale"); await book(c); const before = await frozen(c);
      await f.prisma.buyerAccount.update({ where: { globalUserId: c.buyerId! }, data: { phone: "5511888877777" } });
      await f.message(c, "Quero cancelar meu agendamento"); assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), 0); assert.deepEqual(await frozen(c), before);
    });
    await t.test("a request received while the real human case is already open appends linked context without reactivating AI", async () => {
      const c = await f.make("c21-already-human"); await publish(c); const appointment = await book(c), before = await frozen(c);
      await f.message(c, "Falar com atendente"); const session = await f.read(c);
      const binding = await f.prisma.whatsAppHandoffBinding.findFirstOrThrow({ where: { merchantId: c.merchantId, whatsappSessionId: session.id } });
      assert.equal(binding.mode, "waiting_human"); const count = await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } });
      const result = await f.message(c, "Preciso remarcar o agendamento #" + appointment.id);
      const incoming = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: binding.ticketId!, senderType: "buyer", metadata: { path: ["inboxId"], equals: result.inbox.id } } });
      assert.equal((incoming.metadata as any).kind, "whatsapp_incoming"); assert.equal((incoming.metadata as any).appointmentId, appointment.id);
      const context = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: binding.ticketId!, senderType: "system", metadata: { path: ["requestMessageId"], equals: incoming.id } } });
      assert.match(context.content, /Solicitações de alteração/); assert.equal((context.metadata as any).appointmentId, appointment.id);
      assert.equal(await f.prisma.supportTicket.count({ where: { merchantId: c.merchantId } }), count);
      assert.deepEqual(await f.prisma.whatsAppHandoffBinding.findUniqueOrThrow({ where: { id: binding.id } }), binding); assert.deepEqual(await frozen(c), before);
    });
    await t.test("real storefront capability and buyer JWT link the same owned appointment to a widget human case", async () => {
      const suffix = "c21-storefront", c = await f.make(suffix); await publish(c); const appointment = await book(c);
      const origin = "https://buyer-change.example.test", conversation = await f.request("/storefront/conversations", { merchant_id: c.merchantId }, { origin }); assert.equal(conversation.status, 201);
      const id = conversation.body.conversation_id; await f.prisma.storefrontCart.create({ data: { merchantId: c.merchantId, sessionId: id, expiresAt: new Date(Date.now() + 86400000) } });
      const login = await f.request("/buyer/login", { email: suffix + "@native-buyer.example.test", password: "SyntheticNativeBuyer123!" }); assert.equal(login.status, 201);
      const headers = { origin, authorization: "Bearer " + conversation.body.conversation_token, "x-buyer-authorization": "Bearer " + login.body.accessToken }, before = await frozen(c);
      const result = await f.request("/storefront/conversations/" + id + "/messages", { user_message: "Preciso remarcar o agendamento #" + appointment.id, cart_id: id, history: [] }, headers); assert.equal(result.status, 201); assert.match(result.body.message, /Solicitação encaminhada/);
      const ticket = await f.prisma.supportTicket.findFirstOrThrow({ where: { merchantId: c.merchantId, buyerId: c.buyerId, sessionId: id, source: "widget" } });
      const message = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id, senderType: "buyer" } }); assert.equal((message.metadata as any).appointmentId, appointment.id);
      assert.equal((message.metadata as any).serviceAppointmentChange.action, "reschedule"); const context = await f.prisma.supportTicketMessage.findFirstOrThrow({ where: { ticketId: ticket.id, senderType: "system" } }); assert.match(context.content, /Solicitações de alteração/);
      assert.deepEqual(await frozen(c), before);
      const bad = await f.request("/storefront/conversations/" + id + "/messages", { user_message: "Quero cancelar meu agendamento", history: [] }, { ...headers, origin: "https://foreign.example.test" }); assert.equal(bad.status, 401); assert.deepEqual(await frozen(c), before);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
