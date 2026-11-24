import assert from "node:assert/strict";
import test from "node:test";
import { createNativeServiceJourneyFixture, type NativeJourneyCase } from "./service-channel-journey.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

// Additive source-only proposed native evidence: real signed Meta/worker,
// existing conversation capability and buyer login, actual SQL/Redis. Final
// transport is captured, not provider delivery. No finished intake is seeded.
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const stableMessageMetadata = (value: unknown) => { const metadata = object(value), { delivery: _delivery, ...stable } = metadata; return stable; };
const stableDeliveryCommand = (raw: any) => {
  const response = object(raw.response);
  if (response.kind === "staff_case_alert") return { kind: response.kind, schemaVersion: response.schemaVersion, authority: response.authority,
    text: response.text, link: response.link, storeName: response.storeName, outboxEventId: response.outboxEventId };
  return Object.fromEntries(["merchantId", "deviceId", "provider", "toNumber", "text", "uiMessage"].filter(key => Object.hasOwn(response, key)).map(key => [key, response[key]]));
};

test("C21 native invalid actors and foreign references preserve scoped support facts and private output", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createNativeServiceJourneyFixture({ serviceReleaseFixture: "matching" });
  const support = async (merchantIds: string[]) => {
    const tickets = await f.prisma.supportTicket.findMany({ where: { merchantId: { in: merchantIds } }, orderBy: { id: "asc" }, select: {
      id: true, merchantId: true, sessionId: true, buyerId: true, buyerMessage: true, status: true, source: true, returnId: true, mergedIntoId: true } });
    const messages = await f.prisma.supportTicketMessage.findMany({ where: { ticket: { merchantId: { in: merchantIds } } }, orderBy: { id: "asc" },
      select: { id: true, ticketId: true, senderType: true, clientMessageId: true, content: true, metadata: true } });
    const bindings = await f.prisma.whatsAppHandoffBinding.findMany({ where: { merchantId: { in: merchantIds } }, orderBy: { id: "asc" }, select: {
      id: true, merchantId: true, configId: true, whatsappSessionId: true, conversationId: true, ticketId: true, mode: true, epoch: true, assignedOperatorId: true } });
    const rawEvents = await f.prisma.outboxMessage.findMany({ where: { merchantId: { in: merchantIds }, producer: "support" }, orderBy: { eventId: "asc" }, select: {
      eventId: true, eventType: true, schemaVersion: true, merchantId: true, correlationId: true, causationId: true, producer: true, payload: true } });
    // Existing delivery/background transitions can legitimately append staff
    // alert progress events. Original creation/message/request commands cannot.
    const events = rawEvents.filter(row => row.eventType === "whatsapp.support.case_alert.requested"
      || row.eventType === "support.case.changed" && ["created", "message"].includes(String(object(row.payload).event)));
    const rows = await f.prisma.whatsAppDelivery.findMany({ where: { merchantId: { in: merchantIds } }, orderBy: { id: "asc" },
      select: { id: true, merchantId: true, configId: true, deviceId: true, response: true } });
    const deliveries = rows.map(row => ({ id: row.id, merchantId: row.merchantId, configId: row.configId, deviceId: row.deviceId, originalCommand: stableDeliveryCommand(row) }));
    return { tickets, messages: messages.map(row => ({ ...row, metadata: stableMessageMetadata(row.metadata) })), bindings, events, deliveries };
  };
  const sends = () => f.runtime.whatsapp.events().filter((event: any) => ["sendText", "sendMedia"].includes(event.kind));
  const visibleSince = (start: number, c: NativeJourneyCase) => sends().slice(start).filter((event: any) => String(event.input.toNumber ?? "").replace(/\D/g, "") === c.phone)
    .map((event: any) => structuredClone(event.input.uiMessage ?? { text: event.input.text ?? "" }));
  const noLeak = (output: unknown, values: string[]) => { const text = JSON.stringify(output); for (const value of values) assert.equal(text.includes(value), false, "foreign private/source canary must not be disclosed"); };
  const publish = async (c: NativeJourneyCase, canary: string) => { const merchant = await f.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
    await f.prisma.merchant.update({ where: { id: c.merchantId }, data: { storeSettings: { ...(merchant.storeSettings as any), policies: { general: canary } } } }); };
  const book = async (c: NativeJourneyCase) => { await f.review(c); await f.choose(c, "continue"); await f.choose(c, "confirm"); const result = (await f.snapshot(c)).appointments; assert.equal(result.length, 1); return result[0]!; };
  const openHuman = async (c: NativeJourneyCase) => { await f.message(c, "Falar com atendente"); const session = await f.read(c);
    const binding = await f.prisma.whatsAppHandoffBinding.findFirstOrThrow({ where: { merchantId: c.merchantId, whatsappSessionId: session.id } }); assert.equal(binding.mode, "waiting_human"); assert.ok(binding.ticketId);
    const alert = await f.prisma.whatsAppDelivery.findFirstOrThrow({ where: { merchantId: c.merchantId, id: { startsWith: "support_case_alert:" } } });
    assert.equal(object(alert.response).kind, "staff_case_alert"); assert.equal(object(object(alert.response).authority).ticketId, binding.ticketId); return binding;
  };
  const canaries = (c: NativeJourneyCase, suffix: string, policy: string) => [c.phone, suffix + "@native-buyer.example.test", "Consulta " + suffix, "Profissional " + suffix, policy];
  const widget = async (c: NativeJourneyCase, suffix: string) => {
    const origin = "https://c21-negative.example.test", conversation = await f.request("/storefront/conversations", { merchant_id: c.merchantId }, { origin }); assert.equal(conversation.status, 201);
    const id = conversation.body.conversation_id;
    const login = await f.request("/buyer/login", { email: suffix + "@native-buyer.example.test", password: "SyntheticNativeBuyer123!" }); assert.equal(login.status, 201);
    const headers = { origin, authorization: "Bearer " + conversation.body.conversation_token, "x-buyer-authorization": "Bearer " + login.body.accessToken };
    const say = (message: string, extra: Record<string, string> = {}) => f.request("/storefront/conversations/" + id + "/messages", { user_message: message, cart_id: id, history: [] }, { ...headers, ...extra });
    return { say, headers, id };
  };
  try {
    await t.test("invalid conversation capability, origin and provider signature preserve tickets/messages/events/bindings/alert commands", async () => {
      const suffix = "c21-negative-actor", own = await f.make(suffix), foreignSuffix = "c21-negative-actor-foreign", foreign = await f.make(foreignSuffix), policy = "FOREIGN_ACTOR_POLICY_CANARY";
      await book(own); const otherAppointment = await book(foreign); await publish(foreign, policy); await openHuman(own); await openHuman(foreign);
      const conversation = await widget(own, suffix), scopes = [own.merchantId, foreign.merchantId], before = await support(scopes), foreignDomain = await f.snapshot(foreign), ownDomain = await f.snapshot(own);
      assert.equal(before.deliveries.filter(row => row.originalCommand.kind === "staff_case_alert").length, 2);
      let start = sends().length;
      const deniedAuth = await conversation.say("Quero cancelar o agendamento #" + otherAppointment.id, { authorization: "Bearer forged-conversation" }); assert.equal(deniedAuth.status, 401);
      const deniedOrigin = await conversation.say("Preciso remarcar o agendamento #" + otherAppointment.id, { origin: "https://foreign-origin.example.test" }); assert.equal(deniedOrigin.status, 401);
      noLeak([deniedAuth.body, deniedOrigin.body, visibleSince(start, own)], canaries(foreign, foreignSuffix, policy));
      assert.deepEqual(await support(scopes), before); assert.deepEqual(await f.snapshot(own), ownDomain); assert.deepEqual(await f.snapshot(foreign), foreignDomain); assert.deepEqual(visibleSince(start, own), []);
      start = sends().length; const wire = f.wire(own, "Quero cancelar o agendamento #" + otherAppointment.id);
      await f.post(wire, false); assert.equal(await f.prisma.whatsAppWebhookInbox.count({ where: { eventId: wire.eventId } }), 0);
      assert.deepEqual(await support(scopes), before); assert.deepEqual(await f.snapshot(own), ownDomain); assert.deepEqual(await f.snapshot(foreign), foreignDomain); assert.deepEqual(visibleSince(start, own), []);
      // Existing sendMessage contract treats an invalid optional buyer JWT as
      // guest. Do not invent401 or forbid normal conversation telemetry.
      const guest = await conversation.say("Quero cancelar o agendamento #" + otherAppointment.id, { "x-buyer-authorization": "Bearer forged-buyer" });
      assert.equal(guest.status, 201); assert.match(guest.body.message, /entre na sua conta/); noLeak(guest.body, canaries(foreign, foreignSuffix, policy));
      assert.deepEqual(await support(scopes), before); assert.deepEqual(await f.snapshot(own), ownDomain); assert.deepEqual(await f.snapshot(foreign), foreignDomain);
    });
    await t.test("foreign and absent references before handoff yield identical actual captured output with zero linked support effects", async () => {
      const own = await f.make("c21-negative-reference"), foreignSuffix = "c21-negative-reference-foreign", foreign = await f.make(foreignSuffix), policy = "FOREIGN_REFERENCE_POLICY_CANARY";
      await book(own); const otherAppointment = await book(foreign); await publish(foreign, policy); await openHuman(foreign);
      const scopes = [own.merchantId, foreign.merchantId], before = await support(scopes), ownDomain = await f.snapshot(own), foreignDomain = await f.snapshot(foreign);
      const startForeign = sends().length; await f.message(own, "Quero cancelar o agendamento #" + otherAppointment.id); const foreignOutput = visibleSince(startForeign, own);
      assert.ok(foreignOutput.length > 0); noLeak(foreignOutput, canaries(foreign, foreignSuffix, policy)); assert.deepEqual(await support(scopes), before);
      const startMissing = sends().length; await f.message(own, "Quero cancelar o agendamento #missing-c21-private-reference"); const missingOutput = visibleSince(startMissing, own);
      assert.deepEqual(foreignOutput, missingOutput); assert.deepEqual(await support(scopes), before); assert.deepEqual(await f.snapshot(own), ownDomain); assert.deepEqual(await f.snapshot(foreign), foreignDomain);
    });
    await t.test("invalid reference already in human mode preserves exactly raw incoming message without false linkage, alert or private foreign output", async () => {
      const own = await f.make("c21-negative-human"), foreignSuffix = "c21-negative-human-foreign", foreign = await f.make(foreignSuffix), policy = "FOREIGN_HUMAN_POLICY_CANARY";
      await book(own); const otherAppointment = await book(foreign); await publish(foreign, policy); const ownBinding = await openHuman(own); await openHuman(foreign);
      const scopes = [own.merchantId, foreign.merchantId], before = await support(scopes), foreignBefore = await support([foreign.merchantId]), ownDomain = await f.snapshot(own), foreignDomain = await f.snapshot(foreign);
      const raw = "Preciso remarcar o agendamento #" + otherAppointment.id, start = sends().length, result = await f.message(own, raw), after = await support(scopes);
      assert.deepEqual(after.tickets, before.tickets); assert.deepEqual(after.bindings, before.bindings); assert.deepEqual(after.deliveries, before.deliveries);
      const oldMessageIds = new Set(before.messages.map(row => row.id)), added = after.messages.filter(row => !oldMessageIds.has(row.id)); assert.equal(added.length, 1);
      assert.deepEqual(after.messages.filter(row => oldMessageIds.has(row.id)), before.messages); const message = added[0]!;
      assert.equal(message.ticketId, ownBinding.ticketId); assert.equal(message.senderType, "buyer"); assert.equal(message.content, raw);
      assert.equal(message.metadata.kind, "whatsapp_incoming"); assert.equal(message.metadata.inboxId, result.inbox.id); assert.equal(message.metadata.configId, own.configId);
      for (const field of ["appointmentId", "policyVersion", "serviceAppointmentChange"]) assert.equal(Object.hasOwn(message.metadata, field), false);
      const oldEventIds = new Set(before.events.map(row => row.eventId)), newEvents = after.events.filter(row => !oldEventIds.has(row.eventId)); assert.equal(newEvents.length, 1);
      assert.deepEqual(after.events.filter(row => oldEventIds.has(row.eventId)), before.events); assert.equal(newEvents[0]!.eventType, "support.case.changed");
      assert.deepEqual(newEvents[0]!.payload, { ticketId: ownBinding.ticketId, event: "message", messageId: message.id });
      assert.equal(newEvents[0]!.correlationId, ownBinding.ticketId); assert.equal(newEvents[0]!.causationId, message.id);
      noLeak([message, visibleSince(start, own)], canaries(foreign, foreignSuffix, policy)); assert.deepEqual(visibleSince(start, own), []);
      assert.deepEqual(await support([foreign.merchantId]), foreignBefore); assert.deepEqual(await f.snapshot(own), ownDomain); assert.deepEqual(await f.snapshot(foreign), foreignDomain);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
