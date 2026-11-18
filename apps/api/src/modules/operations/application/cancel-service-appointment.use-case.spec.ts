// T33 cancellation components. Earlier unit20 passed; expanded private cleanup cases await their whole gate.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { captureAppointmentLease } from "../../../shared/bookings/appointment-lease-proof.js";
import { slotFingerprint } from "../../../shared/bookings/redis-service-slots.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { CancelServiceAppointmentUseCase, cancelServiceAppointmentWithin, readCancellationPoliciesWithin,
  type CancelServiceAppointmentCommand } from "./cancel-service-appointment.use-case.js";

const actor = { merchantId: "services", userId: "operator", role: "owner" };
const now = new Date("2030-01-02T10:15:00Z");
function fixture(status = "scheduled") {
  let state: any = {
    merchant: { id: "services", name: "Synthetic business", businessMode: "services", businessModeSelectedAt: new Date("2029-01-01Z"),
      businessModeNeedsReview: false, storeSettings: { policies: { general: "Alteracoes pela equipe humana.", returns: "Consulte a politica publicada." } }, updatedAt: now },
    policy: { general: "Legacy text must not override settings", updatedAt: now },
    appointment: { id: "appointment", merchantId: "services", professionalId: "professional", productId: "service", variantId: "variant",
      buyerGlobalUserId: "buyer", customerSnapshot: { name: "Private buyer", email: "private@example.test" },
      startsAt: new Date("2030-01-02T10:00Z"), endsAt: new Date("2030-01-02T10:30Z"), timeZone: "UTC", durationMinutes: 30,
      priceInCents: 5000, currency: "BRL", origin: "storefront", operationalStatus: status, version: 1, policyVersion: 2,
      policySnapshot: { paymentMode: "at_attendance", holdEnabled: false, holdMinutes: null }, cancelledAt: null },
    request: { id: "request", senderType: "buyer", metadata: { kind: "whatsapp_intake", schemaVersion: 1, appointmentId: "appointment", policyVersion: 2 },
      ticket: { id: "ticket", merchantId: "services", buyerId: "buyer", source: "whatsapp", status: "closed" } },
    payments: [{ id: "balance", mode: "at_attendance", status: "pending", amountCents: 5000, currency: "BRL", version: 1,
      requiresRegularization: false, regularizationReason: null }],
    reservations: [{ id: "own", merchantId: "services", appointmentId: "appointment", status: "reserved" },
      { id: "other", merchantId: "services", appointmentId: "other-appointment", status: "reserved" },
      { id: "foreign", merchantId: "foreign", appointmentId: "appointment", status: "reserved" }], audits: [], events: [],
  };
  let locks = 0, time = now, fail = "", casZero = false;
  const forbidden = async () => assert.fail("cancellation must not mutate finance, Order, physical stock, Redis or provider");
  const matches = (where: any) => where.id === state.appointment.id && where.merchantId === state.appointment.merchantId;
  const tx = {
    $queryRaw: async () => { locks++; return [{ id: "resource" }]; },
    merchant: { findUnique: async ({ where }: any) => where.id === state.merchant.id ? structuredClone(state.merchant) : null },
    merchantPolicy: { findUnique: async () => structuredClone(state.policy) }, product: { count: async () => 0 },
    serviceBusinessPolicy: { findUnique: async () => assert.fail("new-admission toggle is not cancellation authority") },
    serviceAppointment: { findFirst: async ({ where }: any) => matches(where) ? structuredClone(state.appointment) : null,
      updateMany: async ({ where, data }: any) => { if (casZero || !matches(where) || where.version !== state.appointment.version
        || where.operationalStatus !== state.appointment.operationalStatus) return { count: 0 };
        const { version, ...fields } = data; Object.assign(state.appointment, fields); state.appointment.version += version.increment; return { count: 1 }; } },
    supportTicketMessage: { findFirst: async ({ where }: any) => {
      const r = state.request, scope = where.ticket;
      return r && r.id === where.id && r.senderType === where.senderType && r.ticket.merchantId === scope.merchantId
        && r.ticket.buyerId === scope.buyerId && r.ticket.source === scope.source ? structuredClone(r) : null;
    } },
    appointmentAudit: { findFirst: async () => state.audits.filter((row: any) => row.after?.privateLease)
      .sort((a: any, b: any) => b.version - a.version)[0] ?? null,
      findUnique: async ({ where }: any) => state.audits.find((row: any) => row.merchantId === where.merchantId_commandId.merchantId
      && row.commandId === where.merchantId_commandId.commandId) ?? null,
      create: async ({ data }: any) => { if (fail === "audit") throw new Error("synthetic_cancel_audit_failure"); state.audits.push(data); return data; } },
    outboxMessage: { create: async ({ data }: any) => { if (fail === "outbox" || fail === "cleanup" && data.producer === "service-booking-private") throw new Error("synthetic_cancel_outbox_failure"); state.events.push(data); return data; } },
    serviceReservation: { count: async () => 0, updateMany: async ({ where, data }: any) => {
      let count = 0; for (const row of state.reservations) if (row.merchantId === where.merchantId && row.appointmentId === where.appointmentId
        && row.status === where.status) { Object.assign(row, data); count++; } return { count }; } },
    appointmentPayment: { findMany: async ({ where, take }: any) => {
      assert.equal(where.merchantId, actor.merchantId); assert.equal(where.appointmentId, "appointment"); return structuredClone(state.payments.slice(0, take));
    }, create: forbidden, update: forbidden, updateMany: forbidden },
    paymentIntent: { findFirst: forbidden, update: forbidden }, completedOrder: { findFirst: forbidden, update: forbidden },
    productStock: { update: forbidden, updateMany: forbidden }, inventoryMovement: { create: forbidden },
    availabilityException: { update: forbidden, delete: forbidden },
  } as unknown as Prisma.TransactionClient;
  const prisma = { $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = structuredClone(state); try { return await work(tx); } catch (error) { state = before; throw error; }
  } } as unknown as PrismaClient;
  const context = { clock: () => { assert.ok(locks >= 3); return new Date(time); } };
  const command = async (): Promise<CancelServiceAppointmentCommand> => ({ appointmentId: "appointment", expectedVersion: 1,
    commandId: "cancel-first", requestMessageId: "request", policyHash: (await readCancellationPoliciesWithin(tx, actor.merchantId)).hash });
  return { tx, prisma, command, get state() { return state; }, advance: (value: Date) => { time = value; },
    fail: (stage: string) => { fail = stage; }, loseCas: () => { casZero = true; },
    run: (input: CancelServiceAppointmentCommand, principal = actor) => new CancelServiceAppointmentUseCase(prisma).execute(principal, input, context) };
}

test("T33", async t => {
  await t.test("explicit cancellation has a canonical nonterminal edge and preserves recorded terminal outcomes", async () => {
    for (const state of ["pending", "scheduled", "in_service", "completed", "no_show", "cancelled"]) {
      const f = fixture(state), command = await f.command(), before = structuredClone(f.state);
      if (["completed", "no_show", "cancelled"].includes(state)) {
        await assert.rejects(f.run(command), /service_cancellation_state_conflict/); assert.deepEqual(f.state, before);
      } else { const result = await f.run(command); assert.equal(result.appointment.operationalStatus, "cancelled");
        assert.equal(result.appliedVersion, 2); assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1); }
    }
  });
  await t.test("owner/admin cancellation ignores new-admission disable and retains original appointment snapshots", async () => {
    for (const role of ["owner", "admin"]) { const f = fixture(), command = await f.command(), before = structuredClone(f.state.appointment);
      const result = await f.run(command, { ...actor, role });
      for (const field of ["professionalId", "productId", "variantId", "startsAt", "endsAt", "timeZone", "priceInCents", "currency", "policyVersion", "policySnapshot", "customerSnapshot"])
        assert.deepEqual((result.appointment as any)[field], before[field]); }
  });
  await t.test("staff/foreign/product/review principals are denied without writes", async () => {
    for (const role of ["staff", "buyer"]) { const f = fixture(); await assert.rejects(f.run(await f.command(), { ...actor, role }), /service_operator_required/); }
    const foreign = fixture(); await assert.rejects(foreign.run(await foreign.command(), { ...actor, merchantId: "foreign" }), /merchant_not_found/);
    for (const change of [{ businessMode: "products" }, { businessModeNeedsReview: true }]) { const f = fixture(), c = await f.command(); Object.assign(f.state.merchant, change);
      await assert.rejects(f.run(c), /services_mode_required|business_mode_classification_required/); assert.equal(f.state.audits.length, 0); }
  });
  await t.test("request must match trusted T49 buyer/tenant/appointment/booked-policy identity", async () => {
    for (const mutate of [(s: any) => { s.request.ticket.merchantId = "foreign"; }, (s: any) => { s.request.ticket.buyerId = "other"; },
      (s: any) => { s.request.senderType = "merchant"; }, (s: any) => { s.request.metadata.kind = "model_claim"; },
      (s: any) => { s.request.metadata.appointmentId = "other"; }, (s: any) => { s.request.metadata.policyVersion = 99; }]) {
      const f = fixture(), c = await f.command(); mutate(f.state); await assert.rejects(f.run(c), /service_cancellation_request_not_found/); assert.equal(f.state.events.length, 0);
    }
  });
  await t.test("missing request, foreign appointment and manual appointment without trusted buyer link cannot invent a handoff", async () => {
    const f = fixture(), c = await f.command(); f.state.request = null; await assert.rejects(f.run(c), /service_cancellation_request_not_found/);
    const foreign = fixture(); await assert.rejects(foreign.run({ ...await foreign.command(), appointmentId: "foreign" }), /service_appointment_not_found/);
    const manual = fixture(), cm = await manual.command(); manual.state.appointment.buyerGlobalUserId = null;
    await assert.rejects(manual.run(cm), /service_cancellation_request_not_found/);
  });
  await t.test("current policy content/removal changes require a fresh operator snapshot without parsing financial rules", async () => {
    for (const changed of ["Nova politica da empresa", ""]) { const f = fixture(), c = await f.command(); f.state.merchant.storeSettings.policies.general = changed;
      await assert.rejects(f.run(c), /service_cancellation_policy_changed/); assert.equal(f.state.appointment.version, 1); }
    const f = fixture(); f.state.merchant.storeSettings.policies.general = "NAO REEMBOLSAR AUTOMATICAMENTE / prazo em texto livre";
    await f.run(await f.command()); assert.equal(f.state.payments[0].status, "pending");
  });
  await t.test("policy references preserve canonical explicit removal and never invent a cancellation policy", async () => {
    const f = fixture(); f.state.merchant.storeSettings.policies.general = "";
    const view = await readCancellationPoliciesWithin(f.tx, actor.merchantId);
    assert.equal(view.references.length, 5); assert.equal(view.references.find(r => r.sourceId === "general")?.publicationState, "withdrawn");
    await f.run(await f.command()); assert.deepEqual(f.state.audits[0].after.publicPolicies, view.references);
    assert.equal(JSON.stringify(f.state.audits[0].after.publicPolicies).includes("Legacy text"), false);
  });
  await t.test("same original command replays once after policy/financial changes without restoring historical state", async () => {
    const f = fixture(), c = await f.command(); await f.run(c); f.state.merchant.storeSettings.policies.general = "Updated later";
    f.state.payments[0].status = "approved"; f.state.appointment.version = 3;
    const replay = await f.run(c); assert.equal(replay.replayed, true); assert.equal(replay.appliedVersion, 2);
    assert.equal(replay.appointment.version, 3); assert.equal(replay.financialFacts[0].status, "approved");
    assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1);
  });
  await t.test("same commandId cannot cross actor, version, request, policy or appointment identity", async () => {
    const f = fixture(), c = await f.command(); await f.run(c);
    for (const change of [{ expectedVersion: 2 }, { requestMessageId: "another" }, { policyHash: "a".repeat(64) }])
      await assert.rejects(f.run({ ...c, ...change }), /service_appointment_idempotency_conflict/);
    await assert.rejects(f.run(c, { ...actor, userId: "other", role: "admin" }), /service_appointment_idempotency_conflict/);
    f.state.appointment.id = "other"; await assert.rejects(f.run({ ...c, appointmentId: "other" }), /service_appointment_idempotency_conflict/);
  });
  await t.test("stale version and losing CAS leave appointment/projection/audit/outbox untouched", async () => {
    for (const race of [false, true]) { const f = fixture(), c = await f.command(), before = structuredClone(f.state);
      if (race) f.loseCas(); else c.expectedVersion = 99;
      await assert.rejects(f.run(c), /service_appointment_version_conflict/); assert.deepEqual(f.state, before); }
  });
  await t.test("only the exact tenant/appointment compatibility reservation releases; unrelated capacity and one-off survive", async () => {
    const f = fixture(); await f.run(await f.command()); assert.deepEqual(f.state.reservations.map((r: any) => r.status), ["cancelled", "reserved", "reserved"]);
    assert.equal(f.state.appointment.professionalId, "professional"); assert.equal(f.state.events[0].payload.appointmentId, "appointment");
  });
  await t.test("pending/approved/unknown refund facts remain unchanged and no refund/provider/Order/stock method exists", async () => {
    for (const status of ["pending", "approved", "refunded", "partially_refunded"]) { const f = fixture(); f.state.payments[0].status = status;
      f.state.payments[0].requiresRegularization = true; f.state.payments[0].regularizationReason = "provider_refund_unknown";
      const before = structuredClone(f.state.payments), result = await f.run(await f.command());
      assert.deepEqual(f.state.payments, before); assert.deepEqual(result.financialFacts, before); }
  });
  await t.test("audit/outbox failure rolls canonical cancellation and its linked projection back", async () => {
    for (const stage of ["audit", "outbox"]) { const f = fixture(), c = await f.command(), before = structuredClone(f.state); f.fail(stage);
      await assert.rejects(f.run(c), /synthetic_cancel_/); assert.deepEqual(f.state, before); }
  });
  await t.test("post-lock server timestamp is shared and compact event excludes buyer/policy/request/payment details", async () => {
    const f = fixture(), c = await f.command(), fresh = new Date("2030-02-01T09:00Z"); f.advance(fresh); await f.run(c);
    assert.equal(f.state.appointment.cancelledAt.toISOString(), fresh.toISOString()); assert.equal(f.state.audits[0].occurredAt.toISOString(), fresh.toISOString());
    assert.equal(f.state.events[0].occurredAt.toISOString(), fresh.toISOString());
    assert.deepEqual(f.state.events[0].payload, { appointmentId: "appointment", version: 2, operationalStatus: "cancelled" });
    for (const secret of ["private@example.test", "policySnapshot", "requestMessageId", "provider_refund_unknown"])
      assert.equal(JSON.stringify(f.state.events).includes(secret), false);
    assert.equal(f.state.audits[0].after.handoff.requestMessageId, "request");
  });
  await t.test("root client, malformed input and financial/status/body identity overrides reject before writes", async () => {
    const f = fixture(), c = await f.command(); await assert.rejects(cancelServiceAppointmentWithin(f.prisma as unknown as Prisma.TransactionClient, actor, c), /service_cancellation_transaction_required/);
    for (const change of [{ expectedVersion: 0 }, { commandId: "" }, { policyHash: "unknown" }, { refund: true }, { merchantId: "foreign" }, { operationalStatus: "cancelled" }, { cancelledAt: now }])
      await assert.rejects(f.run({ ...c, ...change } as unknown as CancelServiceAppointmentCommand), /service_cancellation_command_invalid|expected_version_required/);
    assert.equal(f.state.appointment.version, 1); assert.equal(f.state.events.length, 0);
  });
  await t.test("unbounded financial facts are unavailable and roll back rather than returning a partial empty balance", async () => {
    const f = fixture(), c = await f.command(); f.state.payments = Array.from({ length: 101 }, (_, index) => ({ ...f.state.payments[0], id: String(index) }));
    const before = structuredClone(f.state); await assert.rejects(f.run(c), /service_cancellation_financial_facts_limit/); assert.deepEqual(f.state, before);
  });
  await t.test("manual and non-WhatsApp requests are authenticated operator records without invented buyer or intake", async () => {
    for (const origin of ["manual", "storefront"] as const) {
      const f = fixture(); f.state.appointment.origin = origin; f.state.appointment.buyerGlobalUserId = null; f.state.request = null;
      f.tx.supportTicketMessage.findFirst = async () => assert.fail("operator request must not fabricate or read buyer intake");
      const command = { ...await f.command(), requestMessageId: undefined, operatorRequestId: "authenticated-operator-request" };
      const result = await f.run(command); assert.equal(result.appointment.operationalStatus, "cancelled");
      assert.deepEqual(f.state.audits[0].after.handoff, { kind: "operator_request", requestId: "authenticated-operator-request", operatorId: actor.userId, originalChannel: origin });
      assert.equal(result.appointment.buyerGlobalUserId, null); assert.equal(f.state.payments[0].status, "pending");
    }
  });
  await t.test("operator and buyer-intake request kinds cannot be mixed or switched on the original receipt", async () => {
    const f = fixture(), base = await f.command();
    await assert.rejects(f.run({ ...base, operatorRequestId: "ambiguous" }), /service_cancellation_command_invalid/);
    await f.run({ ...base, requestMessageId: undefined, operatorRequestId: "operator-request" });
    await assert.rejects(f.run(base), /service_appointment_idempotency_conflict/);
    assert.equal(f.state.audits.length, 1); assert.equal(f.state.events.length, 1);
  });
  await t.test("a malformed optional request ID is refused even beside the other valid request kind", async () => {
    for (const invalid of [null, 0, false, "", " spaced ", [], {}]) {
      const f = fixture(), base = await f.command(), before = structuredClone(f.state);
      await assert.rejects(f.run({ ...base, operatorRequestId: invalid } as unknown as CancelServiceAppointmentCommand), /service_cancellation_command_invalid/);
      await assert.rejects(f.run({ ...base, requestMessageId: invalid, operatorRequestId: "valid-operator-request" } as unknown as CancelServiceAppointmentCommand), /service_cancellation_command_invalid/);
      assert.deepEqual(f.state, before);
    }
  });

});


function managedFixture() {
  const f = fixture(), slot = { resourceId: "professional:professional", slotId: "slot-a",
    startsAt: f.state.appointment.startsAt.toISOString(), endsAt: f.state.appointment.endsAt.toISOString() };
  f.state.appointment.policySnapshot.holdEnabled = true;
  const capture = captureAppointmentLease(actor.merchantId, "original-checkout", { merchantId: actor.merchantId,
    ownerHash: createHash("sha256").update("original-checkout").digest("hex"), generation: "00000000-0000-4000-8000-000000000001",
    fingerprint: slotFingerprint([slot]), expiresAt: "2030-01-02T10:17:00.000Z", slots: [slot] }, slot);
  f.state.audits.push({ id: "original-capture", merchantId: actor.merchantId, appointmentId: "appointment", commandId: "original-command",
    version: 1, action: "checkout_confirm", after: { privateLease: capture } });
  return { ...f, get state() { return f.state; }, capture };
}
test("T33 managed hold cancellation intent", async t => {
  await t.test("queues only the original private pointer atomically and returns no owned proof", async () => {
    const f = managedFixture(), command = await f.command(), result = await f.run(command);
    const cleanup = f.state.events.find((event: any) => event.producer === "service-booking-private");
    assert.deepEqual(cleanup.payload, { originalAuditId: "original-capture", appointmentId: "appointment", cancelVersion: 2 });
    assert.equal(cleanup.causationId, command.commandId); assert.equal(cleanup.correlationId, "appointment");
    assert.equal(f.state.audits.find((row: any) => row.action === "cancel").after.privateLeaseCleanup.originalAuditId, "original-capture");
    assert.equal(JSON.stringify(result).includes(f.capture.generation), false);
    assert.equal(JSON.stringify(f.state.events).includes(f.capture.ownerHash), false);
    assert.equal(JSON.stringify(f.state.events).includes(f.capture.generation), false);
    const before = structuredClone(f.state); await f.run(command); assert.deepEqual(f.state, before);
  });
  await t.test("private intent failure rolls back cancellation, audit and both outbox effects", async () => {
    const f = managedFixture(), command = await f.command(), before = structuredClone(f.state); f.fail("cleanup");
    await assert.rejects(f.run(command), /synthetic_cancel_outbox_failure/); assert.deepEqual(f.state, before);
  });
  await t.test("missing or mismatched original capture never guesses ownership or frees a foreign target", async () => {
    for (const missing of [false, true]) {
      const f = managedFixture(), command = await f.command();
      if (missing) f.state.audits.length = 0; else f.state.appointment.startsAt = new Date("2030-01-03T10:00Z");
      const before = structuredClone(f.state);
      await assert.rejects(f.run(command), /service_hold_original_proof_required|service_appointment_lease_binding_mismatch/);
      assert.deepEqual(f.state, before);
    }
  });
});
