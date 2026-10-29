import test from "node:test";
import assert from "node:assert/strict";
import { OtpService } from "./otp.service.js";
import { verifyCheckoutEmailOtp } from "../../domain/services/checkout-email-otp.js";

test("email challenges and resends persist the same ten-minute deadline advertised by the authentication template", () => {
  const service = new OtpService(), started = Date.now();
  const fresh = service.processEmailOtp("ana@example.test", undefined, "ana@example.test", true)!;
  assert.match(fresh.otp_code!, /^\d{6}$/);
  assert.ok(Date.parse(fresh.otp_expires_at!) >= started + 600_000);
  assert.ok(Date.parse(fresh.otp_expires_at!) <= Date.now() + 600_000);
  const resent = service.processEmailOtp("Reenviar código", { ...fresh, otp_expires_at: "2000-01-01T00:00:00Z" }, "ana@example.test", false)!;
  assert.ok(Date.parse(resent.otp_expires_at!) > Date.now());
});

test("only an unexpired matching challenge verifies email and consumes the code", () => {
  const service = new OtpService();
  const patch = service.processEmailOtp("123456", { email: "ana@example.test", otp_code: "123456", otp_expires_at: new Date(Date.now() + 60_000).toISOString() }, "ana@example.test", false);
  assert.equal(patch?.email_verified, true);
  assert.equal(patch?.otp_code, "");
  assert.equal(patch?.otp_expires_at, "");
});

test("expired, malformed and legacy challenges cannot verify an email, even with the correct code", () => {
  const service = new OtpService();
  for (const deadline of [undefined, "invalid", new Date(Date.now() - 1).toISOString()]) {
    assert.throws(() => service.processEmailOtp("123456", { otp_code: "123456", otp_expires_at: deadline }, "ana@example.test", false), /expirou/);
  }
});

test("expiry does not authorize a wrong code or turn an unrelated message into verification", () => {
  const service = new OtpService(), customer = { otp_code: "123456", otp_expires_at: new Date(Date.now() + 60_000).toISOString() };
  assert.throws(() => service.processEmailOtp("654321", customer, "ana@example.test", false), /inválido/);
  assert.equal(service.processEmailOtp("Ver carrinho", { ...customer, otp_expires_at: "2000-01-01T00:00:00Z" }, "ana@example.test", false), null);
});

test("shared email policy uses only the supplied clock, including the exact expiration boundary", () => {
  const now = Date.parse("2000-01-01T00:00:00Z");
  const input = { code: "123456", challenge: "123456", expiresAt: "2000-01-01T00:00:00.001Z", nowMilliseconds: now };
  assert.equal(verifyCheckoutEmailOtp(input), "verified");
  assert.equal(verifyCheckoutEmailOtp({ ...input, nowMilliseconds: now + 1 }), "expired");
  assert.equal(verifyCheckoutEmailOtp({ ...input, nowMilliseconds: NaN }), "expired");
  assert.equal(verifyCheckoutEmailOtp({ ...input, nowMilliseconds: Infinity }), "expired");
});
test("shared email policy cannot match an empty/non-string challenge or malformed deadline", () => {
  const input = { code: "123456", challenge: "123456", expiresAt: "2000-01-01T00:00:00.001Z", nowMilliseconds: Date.parse("2000-01-01T00:00:00Z") };
  for (const challenge of [undefined, null, 123456, "", "654321"])
    assert.equal(verifyCheckoutEmailOtp({ ...input, challenge }), "invalid");
  assert.equal(verifyCheckoutEmailOtp({ ...input, code: "", challenge: "" }), "invalid");
  for (const expiresAt of [undefined, null, 123456, "invalid", ""])
    assert.equal(verifyCheckoutEmailOtp({ ...input, expiresAt }), "expired");
});
