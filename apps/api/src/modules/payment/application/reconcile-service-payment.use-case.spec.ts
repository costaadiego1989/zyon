import assert from "node:assert/strict";
import test from "node:test";
import type { DomainEvent } from "../../../shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { ReconcileServicePaymentUseCase, regularizationIdentity, servicePaymentBookingConfirmed } from "./reconcile-service-payment.use-case.js";

test("T36 financial reconciliation preserves payment identity and actual booking state", async t => {
  await t.test("one receipt identity survives duplicate webhooks and separates tenant intent order and unit", () => {
    const values = ["merchant", "intent", "order", "unit"] as const;
    const key = regularizationIdentity(...values);
    assert.equal(regularizationIdentity(...values), key); assert.match(key, /^[a-f0-9]{64}$/);
    for (let index = 0; index < values.length; index++) {
      const changed = [...values] as [string, string, string, string]; changed[index] += "-other";
      assert.notEqual(regularizationIdentity(...changed), key);
    }
  });
  await t.test("scheduled and actual attended terminal states retain the historical confirmation fact", () => {
    for (const operationalStatus of ["scheduled", "in_service", "completed", "no_show"])
      assert.equal(servicePaymentBookingConfirmed({ operationalStatus }), true, operationalStatus);
  });
  await t.test("pending cancelled missing and unknown states never claim a confirmed slot", () => {
    for (const operationalStatus of ["pending", "cancelled", "invented"])
      assert.equal(servicePaymentBookingConfirmed({ operationalStatus }), false, operationalStatus);
    assert.equal(servicePaymentBookingConfirmed(null), false);
  });
  const tenant = new TenantContextService(), bus = new InMemoryDomainEventBus();
  const state = { writes: 0 };
  const prisma = { $transaction: () => { state.writes++; throw new Error("unexpected_database_admission"); } } as any;
  const command = new ReconcileServicePaymentUseCase(prisma, bus, tenant);
  const input: DomainEvent = { eventId: "event", eventType: "payment.status.changed", schemaVersion: 1, merchantId: "merchant",
    correlationId: "correlation", causationId: "intent", payload: { payment_intent_id: "intent", session_id: "session", status: "approved" } };
  await t.test("a JSON token cannot authorize durable reconciliation", async () => {
    await assert.rejects(command.handle({ ...input, deliveryLeaseToken: "forged" }), /service_payment_claim_required/);
    assert.deepEqual(state, { writes: 0 });
  });
  await t.test("a spread or serialized event loses the original nonpublic dispatch capability", async () => {
    const claimed = { ...input }; Object.defineProperty(claimed, "deliveryLeaseToken", { value: "token", enumerable: false });
    await assert.rejects(command.handle({ ...claimed }), /service_payment_claim_required/);
    await assert.rejects(command.handle(JSON.parse(JSON.stringify(claimed))), /service_payment_claim_required/);
    assert.deepEqual(state, { writes: 0 });
  });
  await t.test("wrong event schema session or payment reference is rejected before financial work", async () => {
    for (const override of [{ schemaVersion: 2 }, { causationId: "other-intent" }, { payload: { status: "approved" } },
      { payload: { payment_intent_id: "intent", session_id: "", status: "approved" } }]) {
      const event = { ...input, ...override }; Object.defineProperty(event, "deliveryLeaseToken", { value: "token", enumerable: false });
      await assert.rejects(command.handle(event), /service_payment_claim_required/);
    }
    assert.deepEqual(state, { writes: 0 });
  });
  await t.test("an existing foreign tenant scope cannot be replaced by a financial event", async () => {
    const event = { ...input }; Object.defineProperty(event, "deliveryLeaseToken", { value: "token", enumerable: false });
    await tenant.run({ merchantId: "foreign", userId: "foreign-owner", role: "owner" }, () =>
      assert.rejects(command.handle(event), /service_payment_scope_mismatch/));
    assert.deepEqual(state, { writes: 0 });
  });
  await t.test("unknown pending and failed event payloads do not become approved payment commands", async () => {
    for (const status of ["unknown", "pending", "failed"]) await command.handle({ ...input, payload: { ...input.payload as object, status } });
    assert.deepEqual(state, { writes: 0 });
  });
  await t.test("the durable payment handler registers once under a stable consumer identity", () => {
    command.onModuleInit();
    assert.deepEqual(bus.handlersFor("payment.status.changed").map(row => row.handlerId), ["service-payment.reconcile.v1"]);
  });
});
