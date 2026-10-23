import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { CheckoutEmailOtpVerificationError } from "../domain/services/checkout-email-otp-verification.js";
import { checkoutSession } from "./checkout-test-fixtures.js";
import { ConflictException } from "@nestjs/common";

function fixture() {
  const original = checkoutSession({ persistenceVersion: 4, globalUserId: "visitor", shipping: undefined,
    customer: { email: "returning@example.test", email_verified: false, otp_code: "123456", otp_expires_at: new Date(Date.now() + 600_000).toISOString() },
    cart: { currency: "BRL", total: 9, items: [{ sku: "SKU", name: "Item", price: 9, quantity: 1,
      crossSellIntent: { version: 1, promotionId: "promotion", promotionUpdatedAt: "2026-10-20T10:00:00.000Z",
        acceptedQuantity: 1, originalUnitPriceCents: 1000, maximumUnitPriceCents: 900 } }] } });
  const calls: unknown[][] = [], generic: unknown[] = [];
  const verified = { ...structuredClone(original), globalUserId: "returning", persistenceVersion: 5,
    customer: { ...original.customer, email_verified: true, otp_code: "", otp_expires_at: "" } };
  const repository = { verifyEmailOtpAndRecognize: async (...args: unknown[]) => { calls.push(args); return verified; },
    commitCommercialMutation: async (input: { next: typeof original }) => { generic.push(input); return input.next; } };
  const service = () => new CheckoutCustomerService(repository as never, undefined, new OtpService());
  return { original, verified, calls, generic, repository, service };
}
test("normal OTP delegates scope/code/version and actual server claim without a partial generic verified save", async () => {
  const f = fixture(), claim = { requestId: "request", requestHash: "a".repeat(64) };
  const result = await f.service().processCustomerInput(f.original, "123456", undefined, undefined, claim);
  assert.deepEqual(result, f.verified); assert.deepEqual(f.calls, [[{ merchantId: f.original.merchantId, sessionId: f.original.sessionId },
    { expectedVersion: 4, code: "123456" }, claim]]); assert.equal(f.generic.length, 0);
  assert.equal(f.original.customer?.email_verified, false); assert.equal(f.original.customer?.otp_code, "123456");
});
test("actual normal review or stale OTP leaves local verified flag uncommitted", async () => {
  for (const error of [new Error("checkout_buyer_identity_review_required"), new Error("cross_sell_quote_review_required"),
    new CheckoutEmailOtpVerificationError("expired"), new CheckoutEmailOtpVerificationError("invalid")]) {
    const f = fixture(); f.repository.verifyEmailOtpAndRecognize = async () => { throw error; };
    await assert.rejects(f.service().processCustomerInput(f.original, "123456", undefined, undefined), value =>
      value instanceof Error && value.name === "OtpValidationError"); assert.equal(f.generic.length, 0);
  }
});
test("only actual absence dispatch may retain the old V1 OTP implementation", async () => {
  const f = fixture(); f.repository.verifyEmailOtpAndRecognize = async () => undefined as never;
  const result = await f.service().processCustomerInput(f.original, "123456", undefined, undefined);
  assert.equal(result.customer?.email_verified, true); assert.equal(f.generic.length, 1);
});
test("normal intent with missing dedicated persistence cannot fall back to a flag write", async () => {
  const f = fixture(); Reflect.deleteProperty(f.repository, "verifyEmailOtpAndRecognize");
  await assert.rejects(f.service().processCustomerInput(f.original, "123456", undefined, undefined), /confirmar a identidade/);
  assert.equal(f.generic.length, 0);
});
test("legacy cart without intent retains its OTP journey and never invokes normal verification", async () => {
  const f = fixture(); delete f.original.cart.items[0]!.crossSellIntent;
  const result = await f.service().processCustomerInput(f.original, "123456", undefined, undefined);
  assert.equal(result.customer?.email_verified, true); assert.equal(f.calls.length, 0); assert.equal(f.generic.length, 1);
});
test("post-verification profile hydration is pinned to the canonical UID already committed", async () => {
  const f = fixture(); let received: unknown;
  const recognition = { recognizeVerifiedBuyer: async (session: typeof f.original, _merge: unknown, trusted: string) => {
    received = trusted; return { session, globalUserId: "other" }; } };
  const service = new CheckoutCustomerService(f.repository as never, undefined, new OtpService(), recognition as never);
  await assert.rejects(service.processCustomerInput(f.original, "123456", undefined, undefined), /checkout_buyer_session_binding_mismatch/);
  assert.equal(received, "returning"); assert.equal(f.generic.length, 0);
});
test("remount cannot reassign NORMAL after a concurrent account appeared, even with current D", async () => {
  const f = fixture(); f.verified.cart.currentDiscount = 1;
  Reflect.set(f.repository, "readVerifiedNormalBuyerIdentity", async () => "returning");
  const recognition = { recognizeVerifiedBuyer: async (session: typeof f.original, _merge: unknown, trusted: string) => {
    assert.equal(trusted, "returning"); return { session, globalUserId: "concurrently-created" }; } };
  const service = new CheckoutCustomerService(f.repository as never, undefined, new OtpService(), recognition as never);
  await assert.rejects(service.hydrateReturningBuyerFromEmailHint(f.verified), /checkout_buyer_session_binding_mismatch/);
  assert.equal(f.generic.length, 0);
});
test("NORMAL correction uses the server detachment command and only saves the new challenge generically", async () => {
  const f = fixture(), claim = { requestId: "request", requestHash: "a".repeat(64) }, calls: unknown[][] = [], sent: string[] = [];
  const anonymous = "usr_12345678-1234-4234-8234-123456789abc";
  Reflect.set(f.repository, "detachNormalBuyerEmail", async (...args: unknown[]) => { calls.push(args); return {
    ...f.original, globalUserId: anonymous, persistenceVersion: 5, customer: { email: "new@example.test", email_verified: false, otp_code: "", otp_expires_at: "" },
  }; });
  const otp = new OtpService(); otp.generateCode = () => "654321";
  const service = new CheckoutCustomerService(f.repository as never, undefined, otp, undefined, undefined,
    { send: async (value: { to: string }) => { sent.push(value.to); return { status: "sent", messageId: "synthetic" }; } } as never);
  const result = await service.correctCustomerInput(f.original, "Corrigir email para new@example.test", undefined, undefined, claim);
  assert.equal(result?.session.globalUserId, anonymous); assert.equal(result?.session.customer?.otp_code, "654321");
  assert.deepEqual(calls, [[{ merchantId: f.original.merchantId, sessionId: f.original.sessionId }, { expectedVersion: 4, email: "new@example.test" }, claim]]);
  assert.deepEqual(sent, ["new@example.test"]); assert.equal(f.generic.length, 1);
  assert.equal((f.generic[0] as { next: { globalUserId: string } }).next.globalUserId, anonymous);
  assert.equal(f.original.globalUserId, "visitor"); assert.equal(f.original.customer?.otp_code, "123456");
});
test("a benign correction review returns the existing blocked flow, not an unknown chat exception", async () => {
  const f = fixture(); Reflect.set(f.repository, "detachNormalBuyerEmail", async () => { throw new ConflictException("checkout_buyer_identity_review_required"); });
  Reflect.set(f.repository, "getSession", async () => f.original);
  const result = await f.service().correctCustomerInput(f.original, "Corrigir email para new@example.test");
  assert.equal(result?.blocked, true); assert.deepEqual(result?.session, f.original); assert.equal(f.generic.length, 0);
});
test("the prior authenticated buyer cannot hydrate an anonymous corrected email", async () => {
  const f = fixture(), detached = { ...f.original, globalUserId: "usr_12345678-1234-4234-8234-123456789abc", customer: { email: "new@example.test", email_verified: false } };
  await assert.rejects(f.service().prepareTrustedBuyerForCheckout(detached, { globalUserId: f.original.globalUserId,
    customer: { email: f.original.customer!.email!, email_verified: true } }), /checkout_buyer_session_binding_mismatch/);
  assert.equal(await f.service().hydrateReturningBuyerFromEmailHint(detached), detached); assert.equal(f.generic.length, 0);
});
