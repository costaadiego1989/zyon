import assert from "node:assert/strict";
import test from "node:test";
import { publicAppointmentView } from "./service-appointment-public-view.js";
test("T33 public appointment lease privacy", async t => {
  await t.test("private lease and cleanup canaries are omitted at every nested audit projection", () => {
    const privateCanary = "private-owner-generation-canary", startedAt = new Date("2030-01-02T10:00:00Z");
    const input = { appointment: { id: "a", startedAt, customerSnapshot: { name: "Buyer" }, payments: [] }, replayed: false,
      audits: [{ id: "audit", after: { version: 2, operationalStatus: "cancelled", privateLease: { generation: privateCanary },
        privateLeaseCleanup: { originalAuditId: privateCanary } } }], financialFacts: [{ status: "pending", amountCents: 5000 }] };
    const shown = publicAppointmentView(input), serialized = JSON.stringify(shown);
    assert.equal(serialized.includes(privateCanary), false); assert.equal(serialized.includes("privateLease"), false);
    assert.equal(shown.appointment.startedAt, startedAt); assert.equal(shown.audits[0].after.version, 2);
    assert.deepEqual(shown.financialFacts, input.financialFacts); assert.equal(input.audits[0].after.privateLease.generation, privateCanary);
  });
  await t.test("real null and absent fields and policy text are preserved without fabricated content", () => {
    const input = { appointment: null, policy: { text: null, sourceId: "general" }, optional: undefined, text: "privateLease is just text here" };
    assert.deepEqual(publicAppointmentView(input), input);
  });
});
