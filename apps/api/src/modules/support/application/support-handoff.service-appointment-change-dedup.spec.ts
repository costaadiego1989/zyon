import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { SupportHandoffService } from "./support-handoff.service.js";

// Component-only persistence doubles. Actual SupportHandoffService and the
// canonical published-policy reader/projector execute when Root runs this.
// No finished intake/context/SUT return value is substituted by this fixture.
function fixture() {
  let sequence = 0;
  const tickets: any[] = [], messages: any[] = [], events = new Map<string, any>(), notifications: any[] = [], predicates: any[] = [];
  const merchant: any = { id: "merchant", name: "Empresa", businessMode: "services", businessModeSelectedAt: new Date("2029-01-01T00:00:00Z"), businessModeNeedsReview: false,
    storeSettings: { policies: { general: "Política pública inicial para análise humana." } }, updatedAt: new Date("2029-01-01T00:00:00Z") };
  const appointment: any = { id: "owned-123", merchantId: "merchant", buyerGlobalUserId: "buyer", professionalId: "professional", productId: "service", variantId: "variant",
    startsAt: new Date("2030-01-01T13:00:00Z"), endsAt: new Date("2030-01-01T13:30:00Z"), timeZone: "America/Sao_Paulo", durationMinutes: 30,
    priceInCents: 5000, currency: "BRL", operationalStatus: "scheduled", version: 3, policyVersion: 7,
    policySnapshot: { paymentMode: "at_attendance", holdEnabled: false }, product: { name: "Consulta canônica" }, professional: { publicName: "Profissional canônico" } };
  const finances = { balance: { status: "pending", amountCents: 5000 }, payments: [], refunds: [], orders: [], stock: [], bookingEvents: [] };
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    for (const key of ["id", "ticketId", "senderType", "content", "clientMessageId"]) if (where[key] !== undefined && row[key] !== where[key]) return false;
    if (where.AND && !where.AND.every((item: any) => matches(row, item))) return false;
    if (where.metadata) {
      let actual = row.metadata;
      for (const key of where.metadata.path ?? []) actual = actual?.[key];
      if (Object.hasOwn(where.metadata, "equals") && !isDeepStrictEqual(actual, where.metadata.equals)) return false;
    }
    return true;
  };
  const tx: any = { $queryRaw: async () => [{ id: "merchant" }],
    merchant: { findUnique: async () => structuredClone(merchant) }, buyerAccount: { findUnique: async () => ({ globalUserId: "buyer" }) },
    merchantPolicy: { findUnique: async () => null },
    serviceAppointment: { findMany: async ({ where }: any) => where.merchantId === appointment.merchantId && where.buyerGlobalUserId === appointment.buyerGlobalUserId && (!where.id || where.id === appointment.id) ? [structuredClone(appointment)] : [] },
    supportTicket: {
      findFirst: async ({ where }: any) => { const found = tickets.find(row => row.merchantId === where.merchantId && (!where.id || row.id === where.id) && (!where.source || row.source === where.source)); return found ? structuredClone(found) : null; },
      create: async ({ data }: any) => { tickets.push(structuredClone(data)); return structuredClone(data); },
      update: async ({ where, data }: any) => { const row = tickets.find(item => item.id === where.id); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); },
    },
    supportTicketMessage: {
      findFirst: async ({ where, orderBy }: any) => { if (where.content !== undefined) predicates.push(structuredClone(where)); const selected = messages.filter(row => matches(row, where));
        if (orderBy?.createdAt === "desc") selected.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); return selected.length ? structuredClone(selected[0]) : null; },
      create: async ({ data }: any) => { const row = { id: "message-" + (++sequence), ...structuredClone(data) }; messages.push(row); return structuredClone(row); },
    },
    outboxMessage: { upsert: async ({ where, create }: any) => { if (!events.has(where.eventId)) events.set(where.eventId, structuredClone(create)); return structuredClone(events.get(where.eventId)); } },
  };
  const prisma = { $transaction: async (work: (db: any) => Promise<unknown>) => work(tx) };
  const service = new SupportHandoffService({} as never, { publishCreated: (ticket: unknown) => notifications.push(structuredClone(ticket)) } as never, prisma as never);
  const request = () => service.requestServiceAppointmentChange({ merchantId: "merchant", sessionId: "conversation", buyerId: "buyer",
    buyerMessage: "Quero remarcar o agendamento #owned-123", initialMessage: "Quero remarcar o agendamento #owned-123" });
  const state = () => structuredClone({ tickets, messages, events: [...events.values()], notifications });
  const facts = () => structuredClone({ appointment, finances });
  const buyerMessages = () => messages.filter(row => row.senderType === "buyer");
  const systemMessages = () => messages.filter(row => row.senderType === "system");
  const republish = (text: string) => { merchant.storeSettings = { policies: { general: text } }; merchant.updatedAt = new Date(merchant.updatedAt.getTime() + 1000); };
  return { request, state, facts, buyerMessages, systemMessages, predicates, notifications, tickets, merchant, appointment, republish };
}
async function requested(f: ReturnType<typeof fixture>) { const result = await f.request(); assert.equal(result?.confirmed, true); assert.ok(result?.ticketId); return result!; }
function assertCurrentPair(f: ReturnType<typeof fixture>, index: number) {
  const buyer = f.buyerMessages()[index], context = f.systemMessages()[index]; assert.ok(buyer); assert.ok(context);
  assert.equal(context.metadata.requestMessageId, buyer.id); assert.equal(context.metadata.appointmentId, "owned-123");
  assert.equal(buyer.metadata.kind, "service_appointment_intake"); assert.equal(buyer.metadata.policyVersion, 7); assert.equal(context.metadata.policyVersion, 7);
  assert.equal(buyer.metadata.serviceAppointmentChange.appointmentVersion, f.appointment.version);
  assert.deepEqual(buyer.metadata.serviceAppointmentChange, Object.fromEntries(Object.entries(context.metadata).filter(([key]) => !["kind", "schemaVersion", "requestMessageId"].includes(key))));
}

test("C21 unchanged text deduplicates only its current canonical appointment and published-policy context", async t => {
  await t.test("unchanged genuine retry leaves the case, linked messages and events exactly unchanged", async () => {
    const f = fixture(), before = f.facts(), first = await requested(f); assertCurrentPair(f, 0); const snapshot = f.state();
    const retry = await requested(f); assert.equal(retry.ticketId, first.ticketId); assert.deepEqual(f.state(), snapshot); assert.deepEqual(f.facts(), before);
    assert.equal(f.buyerMessages().length, 1); assert.equal(f.systemMessages().length, 1); assert.equal(f.notifications.length, 1);
  });
  await t.test("same text after changed public-policy content records a new current context once in the same open case", async () => {
    const f = fixture(), first = await requested(f), original = structuredClone(f.buyerMessages()[0].metadata), facts = f.facts();
    f.republish("Política pública atualizada: a equipe analisará a remarcação."); const second = await requested(f); assert.equal(second.ticketId, first.ticketId);
    assert.equal(f.buyerMessages().length, 2); assert.equal(f.systemMessages().length, 2); assertCurrentPair(f, 1);
    assert.notEqual(f.buyerMessages()[1].metadata.serviceAppointmentChange.policyHash, original.serviceAppointmentChange.policyHash);
    assert.deepEqual(f.buyerMessages()[0].metadata, original); assert.match(f.systemMessages()[1].content, /Política pública atualizada/); assert.deepEqual(f.facts(), facts);
    const current = f.state(); await requested(f); assert.deepEqual(f.state(), current); assert.equal(f.tickets.length, 1); assert.equal(f.notifications.length, 1);
  });
  await t.test("same text after a canonical appointment/time revision records the new version without altering booked policy or finances", async () => {
    const f = fixture(), first = await requested(f), original = structuredClone(f.buyerMessages()[0].metadata);
    // Declared canonical read precondition, not proof of the T34 writer.
    f.appointment.version = 4; f.appointment.startsAt = new Date("2030-01-01T14:00:00Z"); f.appointment.endsAt = new Date("2030-01-01T14:30:00Z");
    const revisedFacts = f.facts(), second = await requested(f); assert.equal(second.ticketId, first.ticketId); assertCurrentPair(f, 1);
    assert.equal(f.buyerMessages().length, 2); assert.equal(f.systemMessages().length, 2); assert.equal(f.buyerMessages()[0].metadata.serviceAppointmentChange.appointmentVersion, 3);
    assert.equal(f.buyerMessages()[1].metadata.serviceAppointmentChange.appointmentVersion, 4); assert.equal(f.buyerMessages()[1].metadata.serviceAppointmentChange.policyHash, original.serviceAppointmentChange.policyHash);
    assert.match(f.systemMessages()[1].content, /11:00/); assert.deepEqual(f.facts(), revisedFacts);
    const current = f.state(); await requested(f); assert.deepEqual(f.state(), current); assert.equal(f.tickets.length, 1); assert.equal(f.notifications.length, 1);
  });
  await t.test("same policy text with a newer canonical published source version is not an older-context retry", async () => {
    const f = fixture(), first = await requested(f), original = structuredClone(f.buyerMessages()[0].metadata), facts = f.facts();
    f.republish(f.merchant.storeSettings.policies.general); const second = await requested(f); assert.equal(second.ticketId, first.ticketId);
    assert.equal(f.buyerMessages().length, 2); assert.equal(f.systemMessages().length, 2); assertCurrentPair(f, 1);
    assert.notEqual(f.buyerMessages()[1].metadata.serviceAppointmentChange.publishedPolicies[0].sourceVersion, original.serviceAppointmentChange.publishedPolicies[0].sourceVersion);
    assert.notEqual(f.buyerMessages()[1].metadata.serviceAppointmentChange.policyHash, original.serviceAppointmentChange.policyHash); assert.deepEqual(f.facts(), facts);
    const current = f.state(); await requested(f); assert.deepEqual(f.state(), current); assert.equal(f.tickets.length, 1); assert.equal(f.notifications.length, 1);
  });
});
