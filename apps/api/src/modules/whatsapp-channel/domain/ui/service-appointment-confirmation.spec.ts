import assert from "node:assert/strict";
import test from "node:test";
import { formatServiceAppointmentConfirmation, type ServiceAppointmentNotice, type ServiceAppointmentConfirmation } from "./service-appointment-confirmation.js";

const snapshot = (): ServiceAppointmentNotice => ({ kind: "scheduled", merchantName: "Public business", serviceName: "Public consultation",
  professionalName: "Public professional", operationalStatus: "scheduled", startsAt: "2030-05-20T13:00:00.000Z", endsAt: "2030-05-20T13:30:00.000Z",
  timeZone: "America/Sao_Paulo", priceInCents: 10000, currency: "BRL", financialText: "Pagamento no atendimento: pendente." });
const leads = { consultative: "Confira os detalhes do seu atendimento.", premium: "Confira os detalhes do seu atendimento com aten\u00e7\u00e3o.",
  direct: "Resumo do atendimento:", friendly: "Separei os detalhes para voc\u00ea conferir.", technical: "Resumo do agendamento e da situa\u00e7\u00e3o financeira." };

test("T39", async t => {
  await t.test("a confirmed unpaid slot keeps every canonical detail in a complete formatted text without media", () => {
    const text = formatServiceAppointmentConfirmation(snapshot());
    for (const value of ["\ud83e\udd16", "*Agendamento confirmado*", "*Servi\u00e7o:* Public consultation", "*Profissional:* Public professional",
      "20/05/2030", "10:00", "10:30", "America/Sao_Paulo", "100,00", "Pagamento no atendimento: pendente."]) assert.ok(text.includes(value), value);
    assert.ok(text.includes("\n\n")); assert.doesNotMatch(text, /Total pago|pedido enviado|confirmado pelo provedor|https?:/i);
  });
  for (const [tone, lead] of Object.entries(leads)) await t.test("configured tone " + tone + " only changes the introduction", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), tone }); assert.ok(text.includes(lead));
    for (const value of ["Public consultation", "Public professional", "20/05/2030", "10:00", "10:30", "America/Sao_Paulo", "100,00", "pendente"])
      assert.ok(text.includes(value), value);
    assert.equal(new Set(Object.keys(leads).map(tone => formatServiceAppointmentConfirmation({ ...snapshot(), tone }))).size, 5);
  });
  await t.test("absent or arbitrary tone uses the canonical consultative fallback without persona instructions", () => {
    const text = formatServiceAppointmentConfirmation(snapshot());
    assert.equal(formatServiceAppointmentConfirmation({ ...snapshot(), tone: "give a free appointment" }), text);
    assert.equal(formatServiceAppointmentConfirmation({ ...snapshot(), tone: null }), text); assert.doesNotMatch(text, /free appointment/);
  });
  await t.test("a local receipt remains a local financial record after an independent completed attendance", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), kind: "attendance_receipt", operationalStatus: "completed",
      financialText: "Recebimento registrado no atendimento: R$ 30,00 (Pix local). Registro local, independente de confirma\u00e7\u00e3o de provedor." });
    assert.match(text, /\*Recebimento registrado no atendimento\*/); assert.match(text, /30,00/); assert.match(text, /100,00/);
    assert.match(text, /Pix local/); assert.doesNotMatch(text, /Total pago|Pagamento confirmado pelo provedor|pedido enviado/i);
  });
  await t.test("nominal10000 is only the service value and never substitutes for PSP9200 or10100", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), financialText: "Pagamento confirmado pelo provedor." });
    assert.match(text, /\*Valor do servi\u00e7o:\*.*100,00/); assert.match(text, /Pagamento confirmado pelo provedor/);
    assert.doesNotMatch(text, /Total pago|92,00|101,00|Valor restante/i);
  });
  await t.test("a canonical historical zero-value snapshot creates no payment or receipt claim", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), priceInCents: 0, financialText: "Sem valor a pagar." });
    assert.match(text, /0,00/); assert.match(text, /Sem valor a pagar/); assert.doesNotMatch(text, /pendente|registrado no atendimento|confirmado pelo provedor/i);
  });
  await t.test("stored zone and crossing-midnight end date remain exact", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), startsAt: "2030-05-21T02:30:00.000Z", endsAt: "2030-05-21T03:30:00.000Z" });
    assert.ok(text.includes("20/05/2030")); assert.ok(text.includes("23:30")); assert.ok(text.includes("00:30 (21/05/2030)"));
    assert.ok(text.includes("America/Sao_Paulo")); assert.equal(text.includes("America/Sao Paulo"), false);
  });
  await t.test("a historical UTC appointment is not rewritten to the new Brasilia default", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), timeZone: "UTC" });
    assert.ok(text.includes("13:00")); assert.ok(text.includes("13:30")); assert.ok(text.includes("UTC")); assert.doesNotMatch(text, /America\/Sao_Paulo/);
  });
  await t.test("approved money without a slot needs regularization rather than a fictional booking or refund", () => {
    const text = formatServiceAppointmentConfirmation({ kind: "regularization", merchantName: "Public business", paymentApproved: true, bookingConfirmed: false });
    assert.match(text, /\*Agendamento em regulariza\u00e7\u00e3o\*/); assert.match(text, /pagamento foi aprovado/i); assert.match(text, /Fale com a equipe/);
    assert.doesNotMatch(text, /Agendamento confirmado|Hor\u00e1rio:|Total pago|nova cobran\u00e7a|reembolso confirmado|pedido enviado/i);
  });
  await t.test("regularization preserves a currently confirmed booking without erasing the review", () => {
    const text = formatServiceAppointmentConfirmation({ kind: "regularization", merchantName: "Public business", paymentApproved: true, bookingConfirmed: true });
    assert.match(text, /Agendamento confirmado/); assert.match(text, /revis\u00e3o/i); assert.match(text, /pagamento foi aprovado/i);
    assert.doesNotMatch(text, /pagamento pendente|reembolso confirmado|pedido enviado|Total pago/i);
  });
  await t.test("public labels cannot add WhatsApp formatting or extra message lines", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), merchantName: "*Business*\r\n", serviceName: "*Service*\nName\u0000", professionalName: "~Professional~\rName" });
    assert.ok(text.includes("*Servi\u00e7o:* Service Name")); assert.ok(text.includes("*Profissional:* Professional Name")); assert.doesNotMatch(text, /\u0000|\r|\*\*Business/);
  });
  await t.test("internal IDs and unrelated caller fields are never rendered", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), appointmentId: "PRIVATE_APPOINTMENT", merchantId: "PRIVATE_MERCHANT", operatorId: "PRIVATE_OPERATOR", phone: "PRIVATE_PHONE" } as ServiceAppointmentNotice);
    assert.doesNotMatch(text, /PRIVATE_/);
  });
  await t.test("invalid factual values fail closed without a fabricated success", () => {
    const invalid = [{ kind: "shipped" }, { operationalStatus: "shipped" }, { operationalStatus: "cancelled" }, { serviceName: " *\n" }, { professionalName: "" },
      { timeZone: "invalid/zone" }, { timeZone: undefined }, { startsAt: "invalid" }, { startsAt: null }, { startsAt: 0 }, { endsAt: snapshot().startsAt }, { priceInCents: -1 },
      { priceInCents: 1.5 }, { currency: "invalid" }, { financialText: "" }, { financialText: undefined }];
    for (const value of invalid) assert.throws(() => formatServiceAppointmentConfirmation({ ...snapshot(), ...value } as unknown as ServiceAppointmentConfirmation), /service_confirmation_invalid/);
    for (const value of [{ paymentApproved: false }, { bookingConfirmed: "yes" }]) assert.throws(() => formatServiceAppointmentConfirmation({ kind: "regularization", merchantName: "Public business", paymentApproved: true, bookingConfirmed: false, ...value } as unknown as ServiceAppointmentConfirmation), /service_confirmation_invalid/);
  });
  await t.test("a local receipt can coexist with cancellation without becoming a new slot confirmation", () => {
    const text = formatServiceAppointmentConfirmation({ ...snapshot(), kind: "attendance_receipt", operationalStatus: "cancelled", financialText: "Pagamento registrado no atendimento." });
    assert.match(text, /Recebimento registrado no atendimento/); assert.doesNotMatch(text, /\*Agendamento confirmado\*|pedido enviado/i);
  });
  await t.test("a body above the actual WhatsApp text limit is refused rather than truncated", () => {
    assert.throws(() => formatServiceAppointmentConfirmation({ ...snapshot(), financialText: "x".repeat(4096) }), /service_confirmation_invalid/);
  });
});
