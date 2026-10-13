import test from "node:test";
import assert from "node:assert/strict";
import { OtpService } from "./otp.service.js";

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
