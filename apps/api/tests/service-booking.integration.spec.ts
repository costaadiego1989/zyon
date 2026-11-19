import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createDisposablePostgres } from "./local-disposable-postgres.mjs";
import { bootstrapServiceSchema } from "./service-migration-bootstrap.mjs";
import { assertServiceArtifacts } from "./service-test-artifacts.mjs";
import { SERVICE_LOCAL_TEST_MS } from "./service-test-startup.mjs";
import { admitServiceAppointment, type ServiceAppointmentAdmissionInput } from "../src/shared/bookings/service-appointment-admission.service.js";
import { snapshotOrderLines } from "../src/modules/operations/domain/order-fulfillment.js";
import { lockCatalogMerchant } from "../src/shared/persistence/catalog-stock-ledger.js";
import { lockServiceProfessional } from "../src/shared/bookings/service-professional-lock.js";

const now = new Date("2030-01-01T09:00:00Z");
function request(date: string, key: string, overrides: Partial<ServiceAppointmentAdmissionInput> = {}): ServiceAppointmentAdmissionInput {
  return { merchantId: "admission-services", professionalId: "admission-professional", productId: "admission-short", variantId: "admission-short-variant",
    date, startsAt: date + "T10:00:00.000Z", endsAt: date + "T10:20:00.000Z", professionalVersion: 1,
    policyVersion: 1, priceInCents: 5000, currency: "BRL", customer: { name: "Synthetic buyer", phone: "+5521999990000" },
    buyerGlobalUserId: "synthetic-buyer", origin: "whatsapp", actorId: "synthetic-buyer", idempotencyKey: key,
    confirmation: { kind: "at_attendance" }, ...overrides };
}

test("T26", { timeout: SERVICE_LOCAL_TEST_MS }, async t => {
  assertServiceArtifacts();
  const db = await createDisposablePostgres({ transport: "loopback-exec" });
  let raw: PrismaClient | undefined;
  try {
    await db.sql(`CREATE TABLE synthetic_native_marker(run_id TEXT PRIMARY KEY); INSERT INTO synthetic_native_marker VALUES ('${db.runId}');`);
    await bootstrapServiceSchema(db);
    raw = new PrismaClient({ datasources: { db: { url: db.prismaUrl } } });
    const prisma = raw;
    await prisma.merchant.create({ data: { id: "admission-services", name: "Synthetic service business", businessMode: "services", businessModeSelectedAt: now } });
    await prisma.merchant.create({ data: { id: "admission-other", name: "Synthetic foreign business", businessMode: "services", businessModeSelectedAt: now } });
    await prisma.serviceBusinessPolicy.create({ data: { merchantId: "admission-services", admissionsEnabled: true, holdEnabled: false,
      holdMinutes: null, paymentMode: "at_attendance", configuredAt: now, version: 1 } });
    await prisma.serviceProfessional.create({ data: { id: "admission-professional", merchantId: "admission-services", publicName: "Synthetic professional",
      timeZone: "UTC", isActive: true, isPublished: true } });
    for (const [id, duration, price] of [["admission-short", 20, 5000], ["admission-long", 30, 7000]] as const) {
      await prisma.product.create({ data: { id, merchantId: "admission-services", name: id, type: "service", isActive: true,
        metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: duration, slots: [] } } } });
      await prisma.productVariant.create({ data: { id: id + "-variant", productId: id, sku: id, isActive: true,
        price: { create: { basePriceInCents: price, currency: "BRL" } } } });
      await prisma.professionalService.create({ data: { merchantId: "admission-services", professionalId: "admission-professional", productId: id } });
    }
    await prisma.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({
      merchantId: "admission-services", professionalId: "admission-professional", weekday, startMinute: 600, endMinute: 720, timeZone: "UTC",
    })) });
    const admit = (input: ServiceAppointmentAdmissionInput) => prisma.$transaction(tx => admitServiceAppointment(tx, input, { clock: () => now }));
    const sideEffects = async (key: string) => ({
      appointments: await prisma.serviceAppointment.count({ where: { merchantId: "admission-services", idempotencyKey: key } }),
      audits: await prisma.appointmentAudit.count({ where: { merchantId: "admission-services", commandId: key } }),
      outbox: await prisma.outboxMessage.count({ where: { merchantId: "admission-services", causationId: key } }),
    });
    const admitAfterObservedWait = async (input: ServiceAppointmentAdmissionInput, resource: "merchant" | "professional", state: { now: Date; reads: number }, afterWait: Date) => {
      let release!: () => void, ready!: () => void, rejectReady!: (error: unknown) => void, holderPid = 0;
      const locked = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
      const allowCommit = new Promise<void>(resolve => { release = resolve; });
      const holder = prisma.$transaction(async tx => {
        if (resource === "merchant") await lockCatalogMerchant(tx, input.merchantId);
        else await lockServiceProfessional(tx, input.merchantId, input.professionalId);
        [{ pid: holderPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        ready(); await allowCommit;
      });
      void holder.catch(rejectReady);
      let admission: ReturnType<typeof admit> | undefined, settled = false;
      try {
        await locked; assert.ok(Number.isInteger(holderPid) && holderPid > 0);
        admission = prisma.$transaction(tx => admitServiceAppointment(tx, input, { clock: () => { state.reads++; return state.now; } }));
        void admission.then(() => { settled = true; }, () => { settled = true; });
        const table = resource === "merchant" ? "merchants" : "service_professionals", deadline = Date.now() + 2000;
        let waiting = false;
        do {
          waiting = Number(await db.sql(`SELECT count(*) FROM pg_stat_activity WHERE ${holderPid}=ANY(pg_blocking_pids(pid))
            AND wait_event_type='Lock' AND position('${table}' in query)>0 AND position('FOR UPDATE' in upper(query))>0;`)) > 0;
        } while (!waiting && Date.now() < deadline);
        assert.equal(waiting, true, "the exact holder must block the actual admission resource query");
        assert.equal(settled, false); assert.equal(state.reads, 0, "clock cannot be captured before acquiring the blocked resource");
        state.now = afterWait;
      } finally {
        release(); await Promise.allSettled([holder, ...(admission ? [admission] : [])]);
      }
      await holder; assert.ok(admission); return await admission;
    };

    await t.test("the actual root Prisma client cannot autocommit an admission", async () => {
      const input = request("2030-01-16", "root-client-refused");
      await assert.rejects(admitServiceAppointment(prisma, input, { clock: () => now }), /service_appointment_transaction_required/);
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 0, audits: 0, outbox: 0 });
    });
    await t.test("three channel commands compete for one confirmed professional interval", async () => {
      const results = await Promise.allSettled((["manual", "whatsapp", "storefront"] as const).map(origin =>
        admit(request("2030-01-02", "race-" + origin, { origin }))));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failures = results.filter(result => result.status === "rejected");
      assert.equal(failures.length, 2);
      for (const failure of failures) assert.match(String(failure.reason), /service_slot_unavailable/);
      const rows = await prisma.serviceAppointment.findMany({ where: { startsAt: new Date("2030-01-02T10:00:00Z") } });
      assert.equal(rows.length, 1); assert.equal(rows[0].operationalStatus, "scheduled");
      assert.equal(rows[0].durationMinutes, 20); assert.equal(rows[0].priceInCents, 5000);
      assert.deepEqual(await sideEffects(rows[0].idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
      assert.equal(await prisma.paymentIntent.count(), 0);
      assert.equal(await prisma.inventoryMovement.count(), 0);
    });
    await t.test("different services with different starts cannot overlap on the same professional", async () => {
      const short = request("2030-01-03", "different-short", { startsAt: "2030-01-03T10:20:00.000Z", endsAt: "2030-01-03T10:40:00.000Z" });
      const long = request("2030-01-03", "different-long", { productId: "admission-long", variantId: "admission-long-variant", priceInCents: 7000,
        startsAt: "2030-01-03T10:30:00.000Z", endsAt: "2030-01-03T11:00:00.000Z" });
      const results = await Promise.allSettled([admit(short), admit(long)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: { gte: new Date("2030-01-03T00:00:00Z"), lt: new Date("2030-01-04T00:00:00Z") } } }), 1);
    });
    await t.test("adjacent half-open intervals both confirm", async () => {
      await admit(request("2030-01-04", "adjacent-first"));
      await admit(request("2030-01-04", "adjacent-second", { startsAt: "2030-01-04T10:20:00.000Z", endsAt: "2030-01-04T10:40:00.000Z" }));
      assert.deepEqual(await sideEffects("adjacent-first"), { appointments: 1, audits: 1, outbox: 1 });
      assert.deepEqual(await sideEffects("adjacent-second"), { appointments: 1, audits: 1, outbox: 1 });
    });
    await t.test("concurrent retries preserve a single snapshot, audit and outbox", async () => {
      const input = request("2030-01-05", "same-command");
      const [first, second] = await Promise.all([admit(input), admit(input)]);
      assert.equal(first.appointment.id, second.appointment.id);
      assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
      await assert.rejects(admit({ ...input, buyerGlobalUserId: "different-buyer" }), /service_appointment_idempotency_conflict/);
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
    });
    await t.test("stale facts and foreign ownership do not leave partial records", async () => {
      for (const [key, change] of [
        ["stale-policy", { policyVersion: 2 }], ["stale-professional", { professionalVersion: 2 }],
        ["stale-price", { priceInCents: 1 }], ["foreign-resource", { merchantId: "admission-other" }],
      ] as Array<[string, Partial<ServiceAppointmentAdmissionInput>]>) {
        await assert.rejects(admit(request("2030-01-06", key, change)));
        assert.deepEqual(await sideEffects(key), { appointments: 0, audits: 0, outbox: 0 });
        assert.equal(await prisma.serviceAppointment.count({ where: { merchantId: "admission-other" } }), 0);
      }
    });
    await t.test("existing foreign professional product and variant identities cannot be admitted into the owner tenant", async () => {
      const merchantId = "admission-other", professionalId = "admission-foreign-professional", productId = "admission-foreign-service", variantId = "admission-foreign-variant";
      const professional = await prisma.serviceProfessional.create({ data: { id: professionalId, merchantId, publicName: "Synthetic foreign professional", timeZone: "UTC", isActive: true, isPublished: true } });
      const product = await prisma.product.create({ data: { id: productId, merchantId, name: "Synthetic foreign service", type: "service", isActive: true, metadata: { serviceSchedule: { timeZone: "UTC", durationMinutes: 20, slots: [] } } } });
      await prisma.productVariant.create({ data: { id: variantId, productId, sku: "foreign-service", isActive: true, price: { create: { basePriceInCents: 5000, currency: "BRL" } } } });
      await prisma.professionalService.create({ data: { merchantId, professionalId, productId } });
      const cases: Array<{ change: Partial<ServiceAppointmentAdmissionInput>; expected: RegExp }> = [
        { change: { professionalId }, expected: /service_professional_not_found/ },
        ...[{ productId, variantId }, { productId }, { variantId }].map(change => ({ change, expected: /service_offer_changed/ })),
      ];
      for (const [index, { change, expected }] of cases.entries()) {
        const input = request("2030-01-17", "foreign-canonical-" + index, change);
        await assert.rejects(admit(input), expected);
        assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 0, audits: 0, outbox: 0 });
      }
      assert.deepEqual(await prisma.serviceProfessional.findUnique({ where: { id: professionalId } }), professional);
      assert.deepEqual(await prisma.product.findUnique({ where: { id: productId } }), product);
      assert.equal(await prisma.serviceAppointment.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.appointmentAudit.count({ where: { merchantId } }), 0);
      assert.equal(await prisma.outboxMessage.count({ where: { merchantId } }), 0);
    });
    await t.test("pending attempts never consume confirmed capacity", async () => {
      const input = request("2030-01-07", "pending-one", { confirmation: { kind: "pending" } });
      const pending = await admit(input);
      await admit({ ...input, idempotencyKey: "pending-two" });
      const confirmed = await admit(request("2030-01-07", "confirmed-after-pending"));
      assert.equal(pending.appointment.operationalStatus, "pending"); assert.equal(pending.appointment.confirmedAt, null);
      assert.equal(confirmed.appointment.operationalStatus, "scheduled");
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date(input.startsAt) } }), 3);
    });
    await t.test("parallel professionals independently confirm the same service interval", async () => {
      const professionalId = "admission-parallel-professional";
      await prisma.serviceProfessional.create({ data: { id: professionalId, merchantId: "admission-services", publicName: "Synthetic parallel professional", timeZone: "UTC", isActive: true, isPublished: true } });
      await prisma.professionalService.create({ data: { merchantId: "admission-services", professionalId, productId: "admission-short" } });
      await prisma.professionalAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ merchantId: "admission-services", professionalId, weekday, startMinute: 600, endMinute: 720, timeZone: "UTC" })) });
      const first = request("2030-01-12", "parallel-first"), second = request("2030-01-12", "parallel-second", { professionalId });
      const results = await Promise.all([admit(first), admit(second)]);
      assert.deepEqual(new Set(results.map(result => result.appointment.professionalId)), new Set([first.professionalId, second.professionalId]));
      assert.ok(results.every(result => result.appointment.operationalStatus === "scheduled"));
      for (const input of [first, second]) assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
    });
    for (const [resource, date] of [["merchant", "2030-01-13"], ["professional", "2030-01-14"]] as const) {
      await t.test("a real " + resource + " lock wait crossing slot start rejects with zero durable effects", async () => {
        const input = request(date, "clock-expired-" + resource), state = { now, reads: 0 };
        await assert.rejects(admitAfterObservedWait(input, resource, state, new Date(input.startsAt)), /service_slot_unavailable/);
        assert.equal(state.reads, 1); assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 0, audits: 0, outbox: 0 });
        assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: new Date(input.startsAt) } }), 0);
      });
    }
    await t.test("an available post-lock decision uses one fresh instant for appointment audit and outbox", async () => {
      const input = request("2030-01-15", "clock-fresh-positive"), state = { now, reads: 0 }, fresh = new Date("2030-01-15T09:59:00Z");
      const result = await admitAfterObservedWait(input, "professional", state, fresh);
      assert.equal(state.reads, 2); assert.equal(result.appointment.confirmedAt?.toISOString(), fresh.toISOString());
      const audit = await prisma.appointmentAudit.findFirstOrThrow({ where: { merchantId: input.merchantId, commandId: input.idempotencyKey } });
      const outbox = await prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: input.merchantId, causationId: input.idempotencyKey } });
      assert.equal(audit.occurredAt.toISOString(), fresh.toISOString()); assert.equal(outbox.occurredAt.toISOString(), fresh.toISOString());
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
    });
    await t.test("unclassified reserved legacy capacity stays blocked regardless of age until explicitly resolved", async () => {
      await prisma.checkoutSession.create({ data: { id: "legacy-unclassified-checkout", merchantId: "admission-services", sessionId: "legacy-unclassified-session",
        globalUserId: "synthetic-legacy-buyer", conversationId: "synthetic-legacy-conversation", cart: { currency: "BRL", items: [] }, createdAt: now, updatedAt: now } });
      await prisma.completedOrder.create({ data: { id: "legacy-unclassified-order", merchantId: "admission-services", sessionId: "legacy-unclassified-session",
        externalOrderId: "synthetic-legacy-order", orderTotal: 50, currency: "BRL", completedAt: now } });
      const legacy = await prisma.serviceReservation.create({ data: { id: "legacy-unclassified-reservation", merchantId: "admission-services", orderId: "legacy-unclassified-order",
        unitId: "legacy-unit", resourceId: "historical-unclassified-resource", startsAt: new Date("2000-01-01T10:00:00Z"), endsAt: new Date("2000-01-01T10:30:00Z"),
        status: "reserved", appointmentId: null, classificationPending: true } });
      await assert.rejects(admit(request("2030-01-11", "legacy-classification-block")), /service_legacy_classification_required/);
      assert.deepEqual(await sideEffects("legacy-classification-block"), { appointments: 0, audits: 0, outbox: 0 });
      assert.deepEqual(await prisma.serviceReservation.findUnique({ where: { id: legacy.id } }), legacy);
      await prisma.completedOrder.update({ where: { id: "legacy-unclassified-order" }, data: { status: "cancelled" } });
      const accepted = await admit(request("2030-01-11", "closed-legacy-order"));
      assert.equal(accepted.appointment.operationalStatus, "scheduled");
      assert.deepEqual(await prisma.serviceReservation.findUnique({ where: { id: legacy.id } }), legacy);
    });
    await t.test("outbox failure rolls back admission and audit and keeps the slot available", async () => {
      await db.sql(`CREATE FUNCTION synthetic_admission_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.causation_id = 'rollback-command' THEN RAISE EXCEPTION 'synthetic_outbox_failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_admission_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION synthetic_admission_outbox_failure();`);
      try {
        await assert.rejects(admit(request("2030-01-08", "rollback-command")), /synthetic_outbox_failure/);
        assert.deepEqual(await sideEffects("rollback-command"), { appointments: 0, audits: 0, outbox: 0 });
        const accepted = await admit(request("2030-01-08", "after-rollback"));
        assert.equal(accepted.appointment.operationalStatus, "scheduled");
        assert.deepEqual(await sideEffects("after-rollback"), { appointments: 1, audits: 1, outbox: 1 });
      } finally {
        await db.sql("DROP TRIGGER synthetic_admission_outbox_failure ON outbox_messages; DROP FUNCTION synthetic_admission_outbox_failure();");
      }
    });
    await t.test("online confirmation requires matching canonical approved order evidence", async () => {
      await prisma.serviceBusinessPolicy.update({ where: { merchantId: "admission-services" }, data: { paymentMode: "online", version: 2 } });
      const input = request("2030-01-09", "approved-webhook", { policyVersion: 2, confirmation: { kind: "approved_order_unit", orderId: "synthetic-approved-order", unitId: "line_1" } });
      await prisma.checkoutSession.create({ data: { id: "synthetic-paid-checkout", merchantId: input.merchantId, sessionId: "synthetic-session",
        globalUserId: "synthetic-buyer", conversationId: "synthetic-conversation", cart: { currency: "BRL", items: [] }, createdAt: now, updatedAt: now } });
      await prisma.paymentIntent.create({ data: { id: "synthetic-intent", merchantId: input.merchantId, sessionId: "synthetic-session",
        idempotencyKey: "synthetic-intent", amountCents: 5000, currency: "BRL", method: "pix", status: "pending", providerPaymentId: "synthetic-provider-id" } });
      await prisma.completedOrder.create({ data: { id: "synthetic-approved-order", merchantId: input.merchantId, sessionId: "synthetic-session",
        externalOrderId: "synthetic-provider-id", orderTotal: 50, currency: "BRL", completedAt: now,
        lineItemsJson: [{ lineId: "line_1", snapshotVersion: 2, sku: "admission-short", variantId: input.variantId, name: "Synthetic service",
          productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, unitPriceCents: 5000,
          schedule: { professionalId: input.professionalId, professionalVersion: input.professionalVersion,
            policyVersion: input.policyVersion, date: input.date, timeZone: "UTC", durationMinutes: 20,
            startsAt: input.startsAt, endsAt: input.endsAt } }] } });
      await assert.rejects(admit(input), /service_payment_evidence_invalid/);
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 0, audits: 0, outbox: 0 });
      // Synthetic persisted approval validates admission's financial guard. No
      // provider is contacted and this is not proof of a real Pix payment.
      await prisma.paymentIntent.update({ where: { id: "synthetic-intent" }, data: { status: "approved", approvedAmountCents: 5000 } });
      const order = await prisma.completedOrder.findUniqueOrThrow({ where: { id: "synthetic-approved-order" } });
      for (const [field, value] of [["professionalVersion", 99], ["policyVersion", 99], ["date", "2030-01-01"], ["timeZone", "Pacific/Tahiti"], ["durationMinutes", 99]] as const) {
        const changed = JSON.parse(JSON.stringify(order.lineItemsJson));
        changed[0].schedule[field] = value;
        await prisma.completedOrder.update({ where: { id: order.id }, data: { lineItemsJson: changed } });
        await assert.rejects(admit({ ...input, idempotencyKey: "wrong-paid-" + field }), /service_payment_unit_mismatch/);
        assert.deepEqual(await sideEffects("wrong-paid-" + field), { appointments: 0, audits: 0, outbox: 0 });
      }
      await prisma.completedOrder.update({ where: { id: order.id }, data: { lineItemsJson: order.lineItemsJson! } });
      await prisma.completedOrder.update({ where: { id: order.id }, data: { currency: "USD" } });
      await prisma.paymentIntent.update({ where: { id: "synthetic-intent" }, data: { currency: "USD" } });
      await assert.rejects(admit({ ...input, idempotencyKey: "wrong-paid-currency" }), /service_payment_evidence_invalid/);
      assert.deepEqual(await sideEffects("wrong-paid-currency"), { appointments: 0, audits: 0, outbox: 0 });
      await prisma.completedOrder.update({ where: { id: order.id }, data: { currency: "BRL" } });
      await prisma.paymentIntent.update({ where: { id: "synthetic-intent" }, data: { currency: "BRL" } });
      await assert.rejects(admit({ ...input, idempotencyKey: "wrong-payment-buyer", buyerGlobalUserId: "other-buyer" }), /service_payment_buyer_mismatch/);
      assert.deepEqual(await sideEffects("wrong-payment-buyer"), { appointments: 0, audits: 0, outbox: 0 });
      const results = await Promise.all([admit(input), admit(input)]);
      assert.equal(results[0].appointment.id, results[1].appointment.id);
      assert.equal(results[0].appointment.orderId, "synthetic-approved-order");
      assert.deepEqual(await sideEffects(input.idempotencyKey), { appointments: 1, audits: 1, outbox: 1 });
    });
    await t.test("distinct approved order deliveries still share one professional capacity authority", async () => {
      const inputs: ServiceAppointmentAdmissionInput[] = [];
      for (const [index, origin] of (["manual", "whatsapp", "storefront"] as const).entries()) {
        const long = index === 1, priceInCents = long ? 7000 : 5000;
        const input = request("2030-01-10", "approved-race-" + origin, { origin, policyVersion: 2, priceInCents,
          productId: long ? "admission-long" : "admission-short", variantId: (long ? "admission-long" : "admission-short") + "-variant",
          startsAt: long ? "2030-01-10T10:30:00.000Z" : "2030-01-10T10:20:00.000Z",
          endsAt: long ? "2030-01-10T11:00:00.000Z" : "2030-01-10T10:40:00.000Z",
          confirmation: { kind: "approved_order_unit", orderId: "approved-race-order-" + origin, unitId: "line_1" } });
        const sessionId = "approved-race-session-" + origin, providerId = "synthetic-approved-race-" + origin;
        await prisma.checkoutSession.create({ data: { id: sessionId, merchantId: input.merchantId, sessionId,
          globalUserId: input.buyerGlobalUserId!, conversationId: "synthetic-race-conversation-" + origin,
          cart: { currency: "BRL", items: [] }, createdAt: now, updatedAt: now } });
        await prisma.paymentIntent.create({ data: { id: "approved-race-intent-" + origin, merchantId: input.merchantId, sessionId,
          idempotencyKey: "approved-race-intent-" + origin, amountCents: priceInCents, approvedAmountCents: priceInCents,
          currency: "BRL", method: "pix", status: "approved", providerPaymentId: providerId } });
        const schedule = { slotId: "synthetic-race-slot-" + origin, startsAt: input.startsAt, endsAt: input.endsAt,
          date: input.date, timeZone: "UTC", durationMinutes: long ? 30 : 20,
          professionalId: input.professionalId, professionalVersion: input.professionalVersion, policyVersion: input.policyVersion };
        const lines = snapshotOrderLines([{ sku: input.productId, variantId: input.variantId, name: "Synthetic approved service",
          productType: "service", fulfillmentStrategy: "scheduled_service", quantity: 1, price: priceInCents / 100, fulfillmentSchedule: schedule }]);
        // The serializer is real; approval and professional selection remain
        // synthetic persisted fixtures, with no PSP or buyer-channel call.
        await prisma.completedOrder.create({ data: { id: "approved-race-order-" + origin, merchantId: input.merchantId, sessionId,
          externalOrderId: providerId, orderTotal: priceInCents / 100, currency: "BRL", completedAt: now,
          lineItemsJson: JSON.parse(JSON.stringify(lines)) } });
        inputs.push(input);
      }
      const results = await Promise.allSettled(inputs.map(admit));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const failures = results.filter(result => result.status === "rejected");
      assert.equal(failures.length, 2);
      for (const failure of failures) assert.match(String(failure.reason), /service_slot_unavailable/);
      assert.equal(await prisma.serviceAppointment.count({ where: { startsAt: { gte: new Date("2030-01-10T00:00:00Z"), lt: new Date("2030-01-11T00:00:00Z") }, operationalStatus: "scheduled" } }), 1);
      assert.equal(await prisma.paymentIntent.count({ where: { id: { startsWith: "approved-race-intent-" }, status: "approved" } }), 3);
      const effects = await Promise.all(inputs.map(input => sideEffects(input.idempotencyKey)));
      assert.equal(effects.reduce((sum, row) => sum + row.appointments, 0), 1);
      assert.equal(effects.reduce((sum, row) => sum + row.audits, 0), 1);
      assert.equal(effects.reduce((sum, row) => sum + row.outbox, 0), 1);
      assert.equal(await prisma.inventoryMovement.count(), 0);
    });
  } finally {
    try { if (raw) await raw.$disconnect(); }
    finally { await db.dispose(); assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 }); }
  }
  assert.deepEqual(db.bridgeStatus(), { listening: false, sockets: 0, children: 0 });
});
