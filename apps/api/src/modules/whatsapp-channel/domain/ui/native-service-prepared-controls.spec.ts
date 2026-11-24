import assert from "node:assert/strict";
import test from "node:test";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { buildServiceBookingControls, presentServiceBookingControls, checkServiceControlFreshness } from "./service-booking-controls.js";

const now = new Date("2030-01-01T12:00:00Z"), binding = { merchantId: "merchant", configId: "config", whatsappSessionId: "session", conversationId: "cart", validUntil: now.getTime() + 86_400_000 };
const tuple = { productId: "service", variantId: "variant", professionalId: "professional", professionalVersion: 3, policyVersion: 2, date: "2030-01-02",
  startsAt: "2030-01-02T13:00:00.000Z", endsAt: "2030-01-02T13:30:00.000Z", timeZone: "America/Sao_Paulo", durationMinutes: 30, priceInCents: 5000, currency: "BRL" };
const selected = { ...tuple, slotId: professionalSlotId("merchant", tuple), productName: "Consulta", professionalName: "Dra. Joana" };
const model = () => ({ step: "prepared", offer: { productId: "service", variantId: "variant", name: "Consulta" }, source: {
  session_id: "private-checkout", cart_fingerprint: "a".repeat(64), payment_mode: "at_attendance", policy_version: 2,
  requires_hold: false, service_slot_hold: null, selections: [selected] } });
test("T46 separate native confirmation controls", async t => {
  await t.test("prepared at-attendance summary shows one explicit confirmation without another prepare or PSP action", () => {
    const view = buildServiceBookingControls({ binding, model: model() }, now), shown = presentServiceBookingControls(view, "revision", 0, { now });
    assert.equal(shown.numericSelections.filter(a => a.kind === "service_booking" && a.operation === "confirm").length, 1);
    assert.equal(shown.numericSelections.some(a => a.kind === "tool" || a.kind === "service_booking" && a.operation === "continue"), false);
    assert.match(view.body, /Confirme o agendamento/); assert.match(view.body, /Pagamento no atendimento/); assert.match(view.body, /50,00/);
    const text = JSON.stringify(shown.messages); assert.equal(text.includes("private-checkout"), false); assert.equal(text.includes("a".repeat(64)), false);
  });
  await t.test("an actual current button passes only UI freshness while voice/text cannot confirm", () => {
    const view = buildServiceBookingControls({ binding, model: model() }, now), p = presentServiceBookingControls(view, "revision", 0, { now });
    const state: any = { conversationId: "cart", revision: "revision", page: 0, view, selections: p.selections }, action = p.numericSelections[0]!;
    const turn: any = { scope: { merchantId: "merchant", configId: "config", whatsappSessionId: "session" }, conversationId: "cart", origin: "button" };
    const checked = checkServiceControlFreshness({ action, state, turn, now }); assert.equal(checked.ok, true);
    if (!checked.ok) assert.fail("current UI choice expected"); assert.equal(checked.authorizesConfirmation, false); assert.equal(checked.authorizesPayment, false);
    for (const origin of ["voice", "text"]) assert.equal(checkServiceControlFreshness({ action, state, turn: { ...turn, origin }, now }).ok, false);
  });
  await t.test("expired temporary hold removes the confirmation action without inventing an available replacement", () => {
    const raw = model(); raw.source.requires_hold = true; (raw.source as any).service_slot_hold = { expiresAt: now.toISOString(), slots: [{ resourceId: "professional:professional", slotId: selected.slotId, startsAt: selected.startsAt, endsAt: selected.endsAt }] };
    const view = buildServiceBookingControls({ binding, model: raw }, now); assert.match(view.body, /expirou/);
    assert.equal(view.choices.some(c => c.action.kind === "service_booking" && c.action.operation === "confirm"), false);
  });
  await t.test("online policy is kept out of local confirmation controls", () => {
    const raw = model(); raw.source.payment_mode = "online"; const view = buildServiceBookingControls({ binding, model: raw }, now);
    assert.equal(view.choices.some(c => c.action.kind === "service_booking" && c.action.operation === "confirm"), false);
  });
  await t.test("historical confirmation replay displays actual operational state without claiming a new booking or PSP approval", () => {
    const view = buildServiceBookingControls({ binding, model: { step: "confirmed", appointments: [{ id: "appointment", serviceName: "Consulta", professionalName: "Dra. Joana",
      startsAt: "2029-12-01T13:00:00Z", endsAt: "2029-12-01T13:30:00Z", timeZone: "UTC", priceInCents: 5000, currency: "BRL", operationalStatus: "completed", paymentStatus: "approved" }] } }, now);
    assert.match(view.body, /Concluído/); assert.doesNotMatch(view.body, /Pagamento aprovado/); assert.equal(view.choices.some(c => c.action.kind === "service_booking" && c.action.operation === "confirm"), false);
  });
  await t.test("prepared messages preserve readable emoji, Markdown and Portuguese accents", () => {
    const view = buildServiceBookingControls({ binding, model: model() }, now);
    assert.match(view.body, /🗓️ \*Confirme o agendamento\*/);
    assert.match(view.body, /👤 Dra\. Joana/);
    assert.match(view.body, /às 10:00/);
    assert.match(view.body, /A confirmação abaixo registra o agendamento/);
    assert.doesNotMatch(view.body, /Ã|Â|ðŸ/);
  });
});
