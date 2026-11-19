import assert from "node:assert/strict";
import test from "node:test";
import { publicAppointmentView } from "./service-appointment-public-view.js";

test("T35 financial continuation receipt stays private in current and future audit projections", () => {
  const now = new Date("2030-01-02T09:00Z"), source = { appointment: { id: "a", confirmedAt: now, orderId: null,
    audits: [{ after: { version: 1, privatePaymentContinuation: { paymentIntentId: "private-intent", captureAuditId: "private-original" },
      privateLease: { generation: "private-generation" } } }] } };
  const before = structuredClone(source), view = publicAppointmentView(source);
  assert.deepEqual(view, { appointment: { id: "a", confirmedAt: now, orderId: null, audits: [{ after: { version: 1 } }] } });
  assert.deepEqual(source, before); assert.equal(view.appointment.confirmedAt, now); assert.equal(JSON.stringify(view).includes("private-"), false);
});
