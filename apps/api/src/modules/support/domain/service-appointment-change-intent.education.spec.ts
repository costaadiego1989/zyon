import assert from "node:assert/strict";
import test from "node:test";
import { serviceAppointmentChangeIntent } from "./service-appointment-change-intent.js";

test("C21 educational prefixes remain conversational while direct requests stay explicit", async t => {
  await t.test("wanting to know how to reschedule asks for information", () => {
    assert.equal(serviceAppointmentChangeIntent("Gostaria de saber como remarcar minha consulta"), undefined);
  });
  await t.test("wanting to know how to cancel asks for information", () => {
    assert.equal(serviceAppointmentChangeIntent("Quero saber como cancelar meu agendamento"), undefined);
  });
  await t.test("understanding how it works is educational", () => {
    assert.equal(serviceAppointmentChangeIntent("Queria entender como reagendar meu atendimento"), undefined);
  });
  await t.test("a direct polite rescheduling request still requests intake", () => {
    assert.equal(serviceAppointmentChangeIntent("Gostaria de remarcar minha consulta"), "reschedule");
  });
  await t.test("a direct cancellation request still requests intake", () => {
    assert.equal(serviceAppointmentChangeIntent("Quero cancelar meu agendamento"), "cancel");
  });
  await t.test("a how-to follow-up does not erase the preceding direct request", () => {
    assert.equal(serviceAppointmentChangeIntent("Quero cancelar meu agendamento. Como faço?"), "cancel");
    assert.equal(serviceAppointmentChangeIntent("Gostaria de remarcar minha consulta, como faço?"), "reschedule");
  });
});
