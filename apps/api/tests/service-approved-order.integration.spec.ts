// Whole SQL authority cases. Real payment-handler completion and served origin
// have separate companions; these synthetic rows do not claim a PSP call.
import assert from "node:assert/strict";
import test from "node:test";
import { createServiceOperationsHttpFixture } from "./service-operations-http.fixture.js";
import { seedApprovedProfessionalCase } from "./service-approved-order.fixture.js";
import { initializeOrderFulfillment, reserveService } from "../src/shared/persistence/order-fulfillment.js";
import { readFulfillment } from "../src/modules/operations/domain/order-fulfillment.js";
import { OrderFulfillmentUseCase } from "../src/modules/operations/application/order-fulfillment.use-case.js";
test("T35 approved SQL authority", { timeout: 600_000 }, async t => {
  const f = await createServiceOperationsHttpFixture();
  const admit = (c: any) => f.prisma.$transaction((tx: any) => initializeOrderFulfillment(tx, c.order.id, c.merchantId));
  const canonical = (c: any) => f.prisma.serviceAppointment.findUniqueOrThrow({ where: { merchantId_orderId_orderUnitId: { merchantId: c.merchantId, orderId: c.order.id, orderUnitId: c.unitId } } });
  try {
    await t.test("immutable professional line admits via T26 and stores a classified projection", async () => {
      const c = await seedApprovedProfessionalCase(f, "authority"); await admit(c); const a = await canonical(c);
      assert.equal(a.operationalStatus, "scheduled"); assert.equal(a.buyerGlobalUserId, c.buyerId); assert.equal(a.origin, "storefront");
      const r = await f.prisma.serviceReservation.findUniqueOrThrow({ where: { orderId_unitId: { orderId: c.order.id, unitId: c.unitId } } });
      assert.equal(r.appointmentId, a.id); assert.equal(r.classificationPending, false); assert.equal(r.status, "reserved");
      const money = await f.prisma.appointmentPayment.findMany({ where: { appointmentId: a.id } });
      assert.equal(money.length, 1); assert.equal(money[0].status, "approved"); assert.equal(money[0].amountCents, 5000);
      assert.equal(money[0].paymentIntentId, c.payment.id); assert.equal(money[0].providerPaymentId, c.payment.providerPaymentId);
      await admit(c); assert.equal(await f.prisma.appointmentPayment.count({ where: { appointmentId: a.id } }), 1);
      assert.equal(await f.prisma.inventoryMovement.count(), 0);
    });
    await t.test("WhatsApp verified e-mail stays WhatsApp and private proof stays out of real responses", async () => {
      const c = await seedApprovedProfessionalCase(f, "email-whatsapp", { origin: "whatsapp" }); await admit(c); assert.equal((await canonical(c)).origin, "whatsapp");
      // This SQL evidence does not prove Bootstrap writing. The served policy
      // response is still checked for recursive private-field leakage.
      const response = await f.request("/merchants/me/service-business-policy", undefined, f.owner, "GET"); assert.equal(response.status, 200);
      assert.equal(/serviceOrigin|service_origin/.test(JSON.stringify(response.body)), false);
    });
    await t.test("payment mismatch preserves purchase without confirmed appointment", async () => {
      const c = await seedApprovedProfessionalCase(f, "bad-payment"); await f.prisma.paymentIntent.update({ where: { id: c.payment.id }, data: { approvedAmountCents: 1 } });
      await admit(c); assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: c.order.id } }), 0);
      assert.equal(await f.prisma.serviceReservation.count({ where: { orderId: c.order.id } }), 0);
      assert.equal((await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } })).status, "approved");
    });
    await t.test("old paid retry cannot revive cancelled or overwrite rescheduled canonical coordinates", async () => {
      const c = await seedApprovedProfessionalCase(f, "no-revive"); await admit(c); const a = await canonical(c);
      const moved = new Date(a.startsAt.getTime() + 60 * 60_000), end = new Date(a.endsAt.getTime() + 60 * 60_000);
      await f.prisma.serviceAppointment.update({ where: { id: a.id }, data: { startsAt: moved, endsAt: end, version: 2, operationalStatus: "cancelled", cancelledAt: new Date() } });
      const order = await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: c.order.id } }), unit = readFulfillment(order.fulfillmentJson)!.units[0];
      await f.prisma.$transaction((tx: any) => reserveService(tx, order, unit)); const after = await canonical(c);
      assert.equal(after.operationalStatus, "cancelled"); assert.equal(after.startsAt.toISOString(), moved.toISOString());
      const r = await f.prisma.serviceReservation.findUniqueOrThrow({ where: { orderId_unitId: { orderId: c.order.id, unitId: c.unitId } } });
      assert.equal(r.status, "cancelled"); assert.equal(r.startsAt.toISOString(), moved.toISOString());
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: c.order.id } }), 1);
    });
    await t.test("outbox insertion failure rolls back admission and optional projection", async () => {
      const c = await seedApprovedProfessionalCase(f, "paid-rollback"), paymentBefore = await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } });
      await f.prisma.$executeRawUnsafe("CREATE FUNCTION fail_t35_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='service.appointment.scheduled' THEN RAISE EXCEPTION 'owned_t35_rollback'; END IF; RETURN NEW; END $$");
      await f.prisma.$executeRawUnsafe("CREATE TRIGGER fail_t35_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_t35_outbox()");
      try { await assert.rejects(admit(c), /owned_t35_rollback/); } finally {
        await f.prisma.$executeRawUnsafe("DROP TRIGGER fail_t35_outbox ON outbox_messages"); await f.prisma.$executeRawUnsafe("DROP FUNCTION fail_t35_outbox()");
      }
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: c.order.id } }), 0);
      assert.equal(await f.prisma.serviceReservation.count({ where: { orderId: c.order.id } }), 0);
      assert.deepEqual(await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } }), paymentBefore);
    });
    await t.test("every legacy service action refuses canonical units without a second status or capacity writer", async () => {
      const c = await seedApprovedProfessionalCase(f, "legacy-actions"); await admit(c); const a = await canonical(c);
      const before = await f.snapshot(a.id), reservation = await f.prisma.serviceReservation.findUniqueOrThrow({ where: { orderId_unitId: { orderId: c.order.id, unitId: c.unitId } } });
      const order = await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: c.order.id } });
      for (const action of ["reschedule_service", "confirm_schedule", "start_service", "complete_service", "no_show"]) {
        await assert.rejects(new OrderFulfillmentUseCase(f.prisma).execute({ merchantId: c.merchantId, orderId: c.order.id, unitId: c.unitId,
          action, expectedVersion: order.fulfillmentVersion, commandId: "canonical-" + action, actorId: f.owner.user_id }), /service_appointment_versioned_command_required/);
        assert.deepEqual(await f.snapshot(a.id), before);
        assert.deepEqual(await f.prisma.serviceReservation.findUniqueOrThrow({ where: { id: reservation.id } }), reservation);
      }
      assert.equal(await f.prisma.orderFulfillmentAction.count({ where: { orderId: order.id } }), 0);
    });
    await t.test("an unclassified historical line stays reviewable without acquiring guessed variant capacity", async () => {
      const c = await seedApprovedProfessionalCase(f, "historical-review");
      const line = (c.order.lineItemsJson as any[])[0];
      await f.prisma.completedOrder.update({ where: { id: c.order.id }, data: { lineItemsJson: [{ ...line, schedule: {
        startsAt: line.schedule.startsAt, endsAt: line.schedule.endsAt, slotId: "legacy" } }] } });
      await admit(c);
      const order = await f.prisma.completedOrder.findUniqueOrThrow({ where: { id: c.order.id } });
      assert.equal(readFulfillment(order.fulfillmentJson)!.units[0].attention, "service_legacy_classification_required");
      assert.equal(await f.prisma.serviceAppointment.count({ where: { orderId: order.id } }), 0);
      assert.equal(await f.prisma.serviceReservation.count({ where: { orderId: order.id } }), 0);
      assert.equal((await f.prisma.paymentIntent.findUniqueOrThrow({ where: { id: c.payment.id } })).status, "approved");
      await assert.rejects(new OrderFulfillmentUseCase(f.prisma).execute({ merchantId: c.merchantId, orderId: order.id, unitId: c.unitId,
        action: "confirm_schedule", expectedVersion: order.fulfillmentVersion, commandId: "legacy-review-only", actorId: f.owner.user_id }), /service_legacy_classification_required/);
      assert.equal(await f.prisma.orderFulfillmentAction.count({ where: { orderId: order.id } }), 0);
    });
  } finally { await f.close(); }
});
