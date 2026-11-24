import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { withWhatsAppExecution } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { withNativeServiceBookingAuthority, assertNativeServiceBookingAdmission, revalidateNativeServiceBookingAdmission, assertNativeServiceBookingGesture } from "../../../../shared/bookings/native-service-booking-authority.js";

const scope = { merchantId: "merchant", sessionId: "checkout", cartRef: "cart", expiresAtUnix: 2_000_000_000,
  buyer: { merchantId: "merchant", conversationId: "cart", globalUserId: "buyer", customer: { phone: "5511999991234", phone_verified: true as const, email_verified: false as const } } };
const input = { merchantId: "merchant", sessionId: "checkout", globalUserId: "buyer", cartRef: "cart", expiresAtUnix: scope.expiresAtUnix };
function execution() {
  return Object.freeze({ authority: Object.freeze({ version: 1 as const, merchantId: "merchant", configId: "config", whatsappSessionId: "wa-session",
    inboxId: "inbox", bindingId: null, epoch: 0, deviceId: "META_CLOUD:config", buyerPhone: "+5511999991234", provider: "META_CLOUD", accountId: "account",
    checkoutSessionId: null, conversationId: "cart", revision: "revision" }), admitEffect: async () => {}, admitDelivery: async () => {},
    startRequest: async (_scope: unknown, start: () => Promise<unknown>) => start() }) as never;
}
test("T46", async t => {
  await t.test("a serialized native capability cannot create initial authority outside a real private execution", () => {
    assert.throws(() => assertNativeServiceBookingAdmission(input, new Date("2030-01-01T00:00:00Z")), /service_booking_native_authority_required/);
    assert.throws(() => withNativeServiceBookingAuthority({ scope, execution: execution(), revalidate: async () => new Date() }, () => {}), /service_booking_native_authority_required/);
  });
  await t.test("the original execution and exact buyer/cart/checkout identity remain bound after snapshots are cloned", async () => {
    const original = execution(); let validations = 0;
    await withWhatsAppExecution(original, () => withNativeServiceBookingAuthority({ scope, execution: original,
      revalidate: async () => { validations++; return new Date("2030-01-01T00:00:00Z"); } }, async () => {
      const clone = structuredClone(input); assertNativeServiceBookingAdmission(clone, new Date("2030-01-01T00:00:00Z"));
      const tx = Object.freeze({}); assert.equal((await revalidateNativeServiceBookingAdmission(tx as never, clone))!.toISOString(), "2030-01-01T00:00:00.000Z");
      assert.equal(validations, 1);
    }));
  });
  await t.test("foreign merchant, buyer, checkout or longer deadline cannot borrow the native frame", async () => {
    const original = execution();
    await withWhatsAppExecution(original, () => withNativeServiceBookingAuthority({ scope, execution: original, revalidate: async () => new Date() }, () => {
      for (const patch of [{ merchantId: "foreign" }, { globalUserId: "foreign" }, { sessionId: "foreign" }, { cartRef: "foreign" }, { expiresAtUnix: scope.expiresAtUnix + 1 }])
        assert.throws(() => assertNativeServiceBookingAdmission({ ...input, ...patch }, new Date("2030-01-01T00:00:00Z")), /service_booking_native_authority_required/);
    }));
  });
  await t.test("the current DB revalidation and initial deadline fence every native command", async () => {
    const original = execution();
    await withWhatsAppExecution(original, () => withNativeServiceBookingAuthority({ scope, execution: original,
      revalidate: async () => new Date(scope.expiresAtUnix * 1000) }, async () => {
      await assert.rejects(revalidateNativeServiceBookingAdmission({} as never, input), /whatsapp_service_authority_expired/);
    }));
  });
  await t.test("undefined or ordinary embed capabilities do not gain a new native-frame prerequisite", async () => {
    assert.equal(await revalidateNativeServiceBookingAdmission({} as never, undefined), undefined);
    assert.equal(await revalidateNativeServiceBookingAdmission({} as never, { ...input, allowedOrigin: "https://store.example.test" }), undefined);
  });
  await t.test("a read-only native context cannot prepare or confirm without its independently verified original button", () => {
    const original = execution();
    withWhatsAppExecution(original, () => withNativeServiceBookingAuthority({ scope, execution: original, revalidate: async () => new Date() }, () => {
      assert.throws(() => assertNativeServiceBookingGesture(scope, "continue"), /whatsapp_service_button_required/);
      assert.throws(() => assertNativeServiceBookingGesture(scope, "confirm"), /whatsapp_service_button_required/);
    }));
    withWhatsAppExecution(original, () => withNativeServiceBookingAuthority({ scope, execution: original, gesture: "continue", revalidate: async () => new Date() }, () => {
      assertNativeServiceBookingGesture(scope, "continue"); assert.throws(() => assertNativeServiceBookingGesture(scope, "confirm"), /whatsapp_service_button_required/);
    }));
  });
});
