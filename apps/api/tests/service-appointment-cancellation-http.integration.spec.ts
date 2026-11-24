import assert from "node:assert/strict";
import test from "node:test";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";

test("T33 HTTP and SQL", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  const f = await createServiceOperationsHttpFixture({ serviceReleaseFixture: "matching" });
  try {
    // Two real owners share this same verified application/database. The two
    // negative-heavy cases use their own normal tenant quota; defaults stay on.
    const scopeOwner = await f.register("services", "cancel-scope-cohort");
    const prepareScoped = async (suffix: string) => {
      const auth = scopeOwner, merchantId = auth.merchant_id;
      const current = await f.prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } });
      const policy = await f.request("/merchants/me/service-business-policy", { expectedVersion: current?.version ?? 0,
        paymentMode: "at_attendance", holdEnabled: false, admissionsEnabled: true }, auth, "PUT");
      assert.equal(policy.status, 200, JSON.stringify(policy));
      const product = await f.prisma.product.create({ data: { merchantId, name: "Public " + suffix, type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } }, variants: { create: { sku: "ops-" + suffix,
          isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } } }, include: { variants: true } });
      const created = await f.request(f.path(auth), { publicName: "Public professional " + suffix, timeZone: "America/Sao_Paulo", isPublished: true, productIds: [product.id] }, auth);
      assert.equal(created.status, 201, JSON.stringify(created));
      const grade = await f.request(f.path(auth) + "/" + created.body.id + "/availability", { expectedVersion: created.body.version, timeZone: "America/Sao_Paulo",
        rows: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 420, endMinute: 540 })) }, auth, "PUT");
      assert.equal(grade.status, 200, JSON.stringify(grade));
      const professional = await f.prisma.serviceProfessional.findUniqueOrThrow({ where: { id: created.body.id } });
      const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const command = { commandId: "manual-" + suffix, productId: product.id, variantId: product.variants[0].id, professionalId: professional.id,
        expectedProfessionalVersion: professional.version, expectedPolicyVersion: policy.body.version, startsAt: date + "T10:00:00.000Z",
        customer: { kind: "contact", name: "Synthetic operator contact", email: "operator-contact@example.test" } };
      const made = await f.request(f.prefix(auth) + "/manual", command, auth); assert.equal(made.status, 201, JSON.stringify(made));
      return { auth, merchantId, product, professional, date, command, appointment: made.body.appointment };
    };
    const policy = async (c: any) => { const response = await f.request(f.prefix(c.auth) + "/" + c.appointment.id + "/operation-policy", undefined, c.auth, "GET");
      assert.equal(response.status, 200, JSON.stringify(response)); return response.body; };
    const command = async (c: any) => ({ expectedVersion: 1, commandId: "cancel-" + c.appointment.id,
      operatorRequestId: "operator-request-" + c.appointment.id, policyHash: (await policy(c)).hash });
    const cancel = (c: any, body: unknown, auth = c.auth) => f.request(f.prefix(c.auth) + "/" + c.appointment.id + "/cancel", body, auth);
    await t.test("manual operator request cancels only its own capacity without a buyer or WhatsApp intake", async () => {
      const c = await f.prepare("cancel-manual"), other = await f.prepare("cancel-other"), before = await f.snapshot(c.appointment.id), untouched = await f.snapshot(other.appointment.id);
      const result = await cancel(c, await command(c)); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.operationalStatus, "cancelled"); assert.equal(after.appointment.version, 2);
      assert.equal(after.appointment.buyerGlobalUserId, null); assert.deepEqual(after.balances, before.balances); assert.deepEqual(await f.snapshot(other.appointment.id), untouched);
      const audit = after.audits.find((row: any) => row.action === "cancel"); assert.equal(audit.after.handoff.kind, "operator_request"); assert.equal(audit.after.handoff.operatorId, f.owner.user_id);
      // Each actual policy PUT advances version, including the other fixture above.
      const currentPolicy = await f.request("/merchants/me/service-business-policy", undefined, f.owner, "GET");
      assert.equal(currentPolicy.status, 200, JSON.stringify(currentPolicy));
      const retrySlot = await f.request(f.prefix() + "/manual", { ...c.command, expectedPolicyVersion: currentPolicy.body.version, commandId: "after-own-cancel" }); assert.equal(retrySlot.status, 201, JSON.stringify(retrySlot));
      assert.equal(retrySlot.body.appointment.professionalId, c.professional.id); assert.equal((await f.snapshot(other.appointment.id)).appointment.operationalStatus, "scheduled");
    });
    await t.test("verified stored buyer intake is scoped to the exact appointment/tenant and is distinct from operator requests", async () => {
      const c = await f.prepare("cancel-intake"), buyerId = "synthetic-known-buyer";
      await f.prisma.serviceAppointment.update({ where: { id: c.appointment.id }, data: { buyerGlobalUserId: buyerId } });
      const ticket = await f.prisma.supportTicket.create({ data: { id: "cancel-intake-ticket", merchantId: c.merchantId, buyerId,
        buyerMessage: "Synthetic persisted request", status: "closed", source: "whatsapp", createdAt: new Date() } });
      const message = await f.prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, senderType: "buyer", content: "Synthetic request only",
        metadata: { kind: "whatsapp_intake", schemaVersion: 1, appointmentId: c.appointment.id, policyVersion: c.appointment.policyVersion } } });
      const base = await command(c), request = { ...base, operatorRequestId: undefined, requestMessageId: message.id };
      const bad = await cancel(c, { ...request, requestMessageId: "absent-intake" }); assert.equal(bad.status, 404);
      const result = await cancel(c, request); assert.equal(result.status, 201, JSON.stringify(result));
      const audit = (await f.snapshot(c.appointment.id)).audits.find((row: any) => row.action === "cancel"); assert.equal(audit.after.handoff.requestMessageId, message.id);
      // This fixture is stored intake correlation, not a real WhatsApp buyer/provider proof.
    });
    await t.test("auth/role/foreign body and forged financial or request grants cause no appointment effects", async () => {
      const c = await prepareScoped("cancel-scope"), base = await command(c), before = await f.snapshot(c.appointment.id);
      assert.equal((await cancel(c, base, f.foreign)).status, 403); assert.equal((await cancel(c, base, f.staff)).status, 403);
      assert.equal((await cancel(c, { ...base, merchantId: f.foreign.merchant_id })).status, 403);
      assert.equal((await cancel(c, { ...base, refundApproved: true })).status, 400);
      assert.equal((await cancel(c, { ...base, requestMessageId: "ambiguous" })).status, 400);
      for (const invalid of [null, 0, false, "", [], {}]) {
        assert.equal((await cancel(c, { ...base, operatorRequestId: invalid, requestMessageId: "valid-shape-id" })).status, 400);
        assert.equal((await cancel(c, { ...base, requestMessageId: invalid })).status, 400);
      } assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("stale CAS/current public policy and missing request do not cancel or refund", async () => {
      const c = await prepareScoped("cancel-stale"), base = await command(c), before = await f.snapshot(c.appointment.id);
      assert.equal((await cancel(c, { ...base, expectedVersion: 2 })).status, 409);
      assert.equal((await cancel(c, { ...base, operatorRequestId: undefined })).status, 400);
      const merchant = await f.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
      await f.prisma.merchant.update({ where: { id: c.merchantId }, data: { storeSettings: { ...merchant.storeSettings, policies: { general: "Changed public operator policy" } } } });
      assert.equal((await cancel(c, base)).status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("same command replays without resetting independent real-stored financial facts", async () => {
      const c = await f.prepare("cancel-replay"), base = await command(c), balances = (await f.snapshot(c.appointment.id)).balances;
      await f.prisma.appointmentPayment.update({ where: { id: balances[0].id }, data: { status: "approved", receivedAt: new Date(), version: { increment: 1 } } });
      assert.equal((await cancel(c, base)).status, 201); const before = await f.snapshot(c.appointment.id);
      const replay = await cancel(c, base); assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true); assert.deepEqual(await f.snapshot(c.appointment.id), before);
      assert.equal(before.balances[0].status, "approved"); assert.equal((await cancel(c, { ...base, operatorRequestId: "changed-request" })).status, 409);
    });
    await t.test("recorded terminal attendance cannot be replaced by cancellation", async () => {
      const c = await f.prepare("cancel-terminal");
      const transition = await f.request(f.prefix() + "/" + c.appointment.id + "/transitions", { expectedVersion: 1, commandId: "explicit-no-show", action: "no_show" });
      assert.equal(transition.status, 201, JSON.stringify(transition)); const before = await f.snapshot(c.appointment.id);
      assert.equal((await cancel(c, { ...await command(c), expectedVersion: 2 })).status, 409); assert.deepEqual(await f.snapshot(c.appointment.id), before);
    });
    await t.test("actual cancellation outbox failure rolls back status/version/audit and capacity", async () => {
      const c = await f.prepare("cancel-rollback"), base = await command(c), before = await f.snapshot(c.appointment.id);
      await f.runtime.db.sql("CREATE FUNCTION t33_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.cancelled' THEN RAISE EXCEPTION 'synthetic_t33_event_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER t33_fail_event BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION t33_fail_event();");
      try { assert.equal((await cancel(c, base)).status, 500); assert.deepEqual(await f.snapshot(c.appointment.id), before); }
      finally { await f.runtime.db.sql("DROP TRIGGER IF EXISTS t33_fail_event ON outbox_messages; DROP FUNCTION IF EXISTS t33_fail_event();"); }
    });
    await t.test("pending online and stored provider uncertainty survive cancellation without payment or refund claims", async () => {
      const c = await f.prepare("cancel-online-unknown", "online");
      // Synthetic persisted unresolved fact, not a provider payment/refund result.
      await f.prisma.appointmentPayment.create({ data: { merchantId: c.merchantId, appointmentId: c.appointment.id,
        mode: "online", amountCents: 5000, currency: "BRL", status: "pending", provider: "synthetic-local",
        providerEvidence: { synthetic: true, outcome: "unknown" }, requiresRegularization: true,
        regularizationReason: "provider_result_unknown", idempotencyKey: "t33-online-unknown", requestFingerprint: "a".repeat(64) } });
      const before = await f.snapshot(c.appointment.id); assert.equal(before.appointment.operationalStatus, "pending");
      const result = await cancel(c, await command(c)); assert.equal(result.status, 201, JSON.stringify(result));
      const after = await f.snapshot(c.appointment.id); assert.equal(after.appointment.operationalStatus, "cancelled");
      assert.equal(after.appointment.confirmedAt, null); assert.deepEqual(after.balances, before.balances);
      assert.equal(result.body.financialFacts[0].status, "pending"); assert.equal(result.body.financialFacts[0].requiresRegularization, true);
      assert.equal(result.body.financialFacts[0].regularizationReason, "provider_result_unknown");
      assert.equal(after.balances[0].receivedAt, null);
    });
    await t.test("explicitly withdrawn public policy is returned as null text and audited without a fabricated rule", async () => {
      const c = await f.prepare("cancel-withdrawn");
      const merchant = await f.prisma.merchant.findUniqueOrThrow({ where: { id: c.merchantId } });
      await f.prisma.merchant.update({ where: { id: c.merchantId }, data: { storeSettings: { ...merchant.storeSettings, policies: { general: "" } } } });
      const view = await policy(c), general = view.policies.find((row: any) => row.sourceId === "general");
      assert.ok(general); assert.equal(general.publicationState, "withdrawn"); assert.equal(general.text, null);
      const result = await cancel(c, { ...await command(c), policyHash: view.hash }); assert.equal(result.status, 201, JSON.stringify(result));
      const audit = (await f.snapshot(c.appointment.id)).audits.find((row: any) => row.action === "cancel");
      assert.deepEqual(audit.after.publicPolicies, view.references);
    });
    assert.equal(f.runtime.evidence().providerCalls, 0);
  } finally { await f.close(); }
});
