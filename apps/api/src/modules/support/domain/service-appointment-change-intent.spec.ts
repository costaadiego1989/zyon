import assert from "node:assert/strict";
import test from "node:test";
import { serviceAppointmentChangeIntent, serviceAppointmentReference } from "./service-appointment-change-intent.js";

test("C21 current buyer change request intent is routing only", async t => {
  await t.test("explicit cancellation request", () => { assert.equal(serviceAppointmentChangeIntent("Quero cancelar meu agendamento."), "cancel"); });
  await t.test("explicit rescheduling request", () => { assert.equal(serviceAppointmentChangeIntent("Preciso remarcar minha consulta."), "reschedule"); });
  await t.test("polite request remains explicit", () => { assert.equal(serviceAppointmentChangeIntent("Por favor, poderia reagendar meu atendimento?"), "reschedule"); });
  await t.test("reference is a hint requiring later owned SQL resolution", () => { assert.equal(serviceAppointmentReference("Quero cancelar o agendamento #owned-123"), "owned-123"); });
  await t.test("multiple references cannot choose an arbitrary target", () => { assert.equal(serviceAppointmentReference("Remarcar agendamento #owned-123 e #owned-456"), null); });
  await t.test("absent reference stays absent", () => { assert.equal(serviceAppointmentReference("Quero cancelar meu agendamento"), undefined); });
  await t.test("malformed explicit reference cannot fall back to another unique owned appointment", () => {
    for (const value of ["#../foreign", "#", "#" + "x".repeat(192)]) assert.equal(serviceAppointmentReference("Quero cancelar o agendamento " + value), null);
  });
  await t.test("negation grants no intake", () => { assert.equal(serviceAppointmentChangeIntent("Não quero cancelar meu agendamento."), undefined); });
  await t.test("quoted instruction grants no intake", () => { assert.equal(serviceAppointmentChangeIntent('O site diz "quero cancelar meu agendamento".'), undefined); });
  await t.test("hypothetical request grants no intake", () => { assert.equal(serviceAppointmentChangeIntent("Se eu precisar remarcar minha consulta?"), undefined); });
  await t.test("policy education stays conversational", () => { assert.equal(serviceAppointmentChangeIntent("Como posso cancelar minha consulta?"), undefined); });
  await t.test("cart cancellation is not appointment cancellation", () => { assert.equal(serviceAppointmentChangeIntent("Quero cancelar meu pedido"), undefined); });
  await t.test("generic human request keeps the original path", () => { assert.equal(serviceAppointmentChangeIntent("Quero falar com um atendente"), undefined); });
});
