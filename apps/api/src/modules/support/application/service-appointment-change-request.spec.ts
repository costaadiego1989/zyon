import assert from "node:assert/strict";
import test from "node:test";
import { readBuyerAppointmentChangeWithin, assertWhatsAppAppointmentChangeOwnerWithin, ServiceAppointmentChangePrompt, serviceAppointmentChangeMetadata, serviceAppointmentChangeOperatorText } from "./service-appointment-change-request.js";

function fixture(options: { appointments?: Array<Record<string, unknown>>; mode?: string; buyer?: boolean; policy?: string; policyUpdatedAt?: Date; failPolicy?: boolean } = {}) {
  const query: unknown[] = [];
  const appointment = { id: "owned-123", merchantId: "merchant", buyerGlobalUserId: "buyer", professionalId: "professional", productId: "service", variantId: "variant",
    startsAt: new Date("2030-01-01T13:00:00Z"), endsAt: new Date("2030-01-01T13:30:00Z"), timeZone: "America/Sao_Paulo", durationMinutes: 30,
    priceInCents: 5000, currency: "BRL", operationalStatus: "scheduled", version: 3, policyVersion: 2,
    product: { name: "Consulta canônica" }, professional: { publicName: "Profissional canônico" } };
  const merchant = { id: "merchant", name: "Empresa", businessMode: options.mode ?? "services", businessModeSelectedAt: new Date("2029-01-01Z"), businessModeNeedsReview: false,
    storeSettings: { policies: { general: options.policy ?? "Remarcações são analisadas pela equipe." } }, updatedAt: options.policyUpdatedAt ?? new Date("2029-01-01T00:00:00Z") };
  const tx = { $queryRaw: async () => [{ id: "merchant" }], merchant: { findUnique: async () => merchant },
    buyerAccount: { findUnique: async () => options.buyer === false ? null : { globalUserId: "buyer" } },
    serviceAppointment: { findMany: async (args: any) => { query.push(args); const rows = options.appointments ?? [appointment];
      return rows.filter(row => row.merchantId === args.where.merchantId && row.buyerGlobalUserId === args.where.buyerGlobalUserId && (!args.where.id || row.id === args.where.id)); } },
    merchantPolicy: { findUnique: async () => { if (options.failPolicy) throw Error("policy_db_failure"); return null; } } };
  return { tx: tx as never, query, appointment };
}
const read = (f: ReturnType<typeof fixture>, message = "Quero cancelar meu agendamento") => readBuyerAppointmentChangeWithin(f.tx, { merchantId: "merchant", buyerId: "buyer", message });
const prompt = async (work: Promise<unknown>) => { try { await work; assert.fail("choice or privacy response required"); } catch (error) { assert.ok(error instanceof ServiceAppointmentChangePrompt); return error; } };

test("C21 canonical buyer appointment context", async t => {
  await t.test("one owned appointment carries factual public details and published policy", async () => { const f = fixture(), linked = await read(f); assert.ok(linked);
    assert.equal(linked.action, "cancel"); assert.equal(linked.appointment.id, "owned-123"); assert.equal(linked.appointment.version, 3); assert.equal(linked.appointment.policyVersion, 2);
    assert.equal(linked.appointment.startsAt, "2030-01-01T13:00:00.000Z"); assert.equal(linked.appointment.timeZone, "America/Sao_Paulo");
    assert.equal(linked.policies.filter(p => p.publicationState === "published").length, 1); assert.match(linked.policies.find(p => p.sourceId === "general")!.text!, /Remarcações/);
    assert.match(linked.policyHash, /^[a-f0-9]{64}$/); assert.deepEqual((f.query[0] as any).where, { merchantId: "merchant", buyerGlobalUserId: "buyer" }); });
  await t.test("multiple owned appointments require explicit choice without interpreting payment or availability", async () => { const a = fixture().appointment, f = fixture({ appointments: [a, { ...a, id: "owned-456" }] }); const value = await prompt(read(f)); assert.match(value.reply, /Qual agendamento/); assert.match(value.reply, /#owned-123/); assert.match(value.reply, /#owned-456/); });
  await t.test("explicit reference remains scoped to authenticated owner", async () => { const f = fixture(), linked = await read(f, "Preciso remarcar o agendamento #owned-123"); assert.equal(linked?.action, "reschedule"); assert.deepEqual((f.query[0] as any).where, { merchantId: "merchant", buyerGlobalUserId: "buyer", id: "owned-123" }); });
  await t.test("foreign and absent references have identical nondisclosing output", async () => { const a = fixture().appointment;
    const foreign = await prompt(read(fixture({ appointments: [{ ...a, merchantId: "foreign", buyerGlobalUserId: "victim" }] }), "Quero cancelar o agendamento #owned-123"));
    const missing = await prompt(read(fixture({ appointments: [] }), "Quero cancelar o agendamento #missing-456")); assert.equal(foreign.reply, missing.reply); assert.doesNotMatch(foreign.reply, /Profissional|Consulta canônica|victim|foreign/); });
  await t.test("missing authenticated buyer receives no appointment data", async () => { const f = fixture({ buyer: false }); const value = await prompt(read(f)); assert.match(value.reply, /entre na sua conta/); assert.deepEqual(f.query, []); });
  await t.test("product company is left to the original path", async () => { const f = fixture({ mode: "products" }); const value = await prompt(read(f)); assert.equal(value.notService, true); assert.deepEqual(f.query, []); });
  await t.test("native identity still requires the canonical account phone after merchant lock", async () => {
    const f = fixture(); (f.tx as any).buyerAccount.findUnique = async () => ({ globalUserId: "buyer", phone: "5511999998888" });
    await assertWhatsAppAppointmentChangeOwnerWithin(f.tx, { merchantId: "merchant", buyerId: "buyer", phone: "5511999998888" });
    await assert.rejects(assertWhatsAppAppointmentChangeOwnerWithin(f.tx, { merchantId: "merchant", buyerId: "buyer", phone: "5511888887777" }), error => {
      assert.equal((error as any).getStatus(), 404); assert.equal((error as Error).message, "whatsapp_handoff_buyer_not_found"); return true;
    });
  });
  await t.test("deleted native account cannot acquire an appointment link", async () => {
    const f = fixture({ buyer: false }); await assert.rejects(assertWhatsAppAppointmentChangeOwnerWithin(f.tx, { merchantId: "merchant", buyerId: "buyer", phone: "5511999998888" }), error => {
      assert.equal((error as any).getStatus(), 404); assert.equal((error as Error).message, "whatsapp_handoff_buyer_not_found"); return true;
    });
  });
  await t.test("withdrawn policy is explicit and never replaced with invented commercial terms", async () => { const linked = await read(fixture({ policy: "" })); assert.ok(linked); assert.equal(linked.policies.filter(p => p.publicationState === "published").length, 0); assert.match(serviceAppointmentChangeOperatorText(linked), /Nenhuma política publicada/); });
  await t.test("policy read failure is not presented as an empty published policy", async () => { await assert.rejects(read(fixture({ failPolicy: true })), /policy_db_failure/); });
  await t.test("booked policy version remains independent from the current published policy provenance", async () => {
    const publishedAt = new Date("2031-01-01T00:00:00Z"), f = fixture({ policyUpdatedAt: publishedAt, policy: "Texto publicado atual para análise humana." });
    const before = structuredClone(f.appointment), linked = await read(f); assert.ok(linked);
    assert.equal(linked.appointment.policyVersion, 2); assert.equal(linked.appointment.version, 3);
    const published = linked.policies.find(p => p.sourceId === "general")!;
    assert.ok(published.sourceVersion.startsWith(String(publishedAt.getTime()) + ":")); assert.match(published.sourceHash, /^[a-f0-9]{64}$/);
    assert.match(published.text!, /Texto publicado atual/); assert.deepEqual(f.appointment, before);
    const metadata = serviceAppointmentChangeMetadata(linked); assert.equal(metadata.policyVersion, 2);
    assert.equal(metadata.publishedPolicies.find(p => p.sourceId === "general")!.sourceVersion, published.sourceVersion);
  });
  await t.test("operator context and metadata retain the actual request, appointment and policy without private facts", async () => { const linked = await read(fixture()); assert.ok(linked);
    const metadata = serviceAppointmentChangeMetadata(linked), text = serviceAppointmentChangeOperatorText(linked); assert.equal(metadata.appointmentId, "owned-123"); assert.equal(metadata.policyVersion, 2);
    assert.match(text, /Solicitação de cancelamento/); assert.match(text, /#owned-123/); assert.match(text, /Consulta canônica/); assert.match(text, /Remarcações são analisadas/);
    assert.doesNotMatch(JSON.stringify({ metadata, text }), /customerSnapshot|providerEvidence|leaseToken|phone|email|refunded|cancelledAt/); });
});
