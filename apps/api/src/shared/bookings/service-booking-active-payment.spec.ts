import test from "node:test";
import assert from "node:assert/strict";
import { assertNoActiveServiceCheckoutPayment } from "./service-booking-active-payment.js";
test("T45 local booking uses the existing payment repository's non-retryable status set and exact session scope", async () => {
  let captured: unknown;
  await assertNoActiveServiceCheckoutPayment({ paymentIntent: { findFirst: async (input: unknown) => { captured = input; return null; } } } as never, "merchant-a", "session-a");
  assert.deepEqual(captured, { where: { merchantId: "merchant-a", sessionId: "session-a", status: { notIn: ["failed", "cancelled"] } }, select: { id: true } });
});
test("T45 active normal payment blocks local financial admission without appointment, balance or provider writes", async () => {
  for (const status of ["pending", "requires_action", "approved", "refunded"]) {
    let writes = 0;
    await assert.rejects(assertNoActiveServiceCheckoutPayment({ paymentIntent: { findFirst: async () => ({ id: "payment", status }) }, appointmentPayment: { create: () => { writes++; } }, serviceAppointment: { create: () => { writes++; } } } as never, "merchant-a", "session-a"), /service_checkout_payment_in_progress/);
    assert.equal(writes, 0);
  }
});
