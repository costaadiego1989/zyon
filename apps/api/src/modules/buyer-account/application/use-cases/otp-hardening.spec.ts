import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { SendBuyerPhoneCodeUseCase } from "./send-buyer-phone-code.use-case.js";
import { VerifyBuyerPhoneCodeUseCase } from "./verify-buyer-phone-code.use-case.js";

function makeServices() {
  const repo = new InMemoryBuyerAccountRepository();
  const otpStore = new InMemoryOtpStore();
  const jwt = new BuyerJwtService("buyer-test-secret", 3600);
  const delivered: string[] = [];
  const send = new SendBuyerPhoneCodeUseCase(otpStore, { async send(_phone, message) { delivered.push(message); } });
  const verify = new VerifyBuyerPhoneCodeUseCase(repo, otpStore, jwt);
  return { repo, otpStore, jwt, send, verify, delivered };
}

// B3 (P1) regression: OTP must be stored in the injected OtpStore (not a
// module-level Map) so it is accessible after send and consumable after verify.
test("OTP flow: send stores code, verify consumes it and returns JWT (B3 P1 regression)", async () => {
  const { send, verify, otpStore, delivered } = makeServices();
  const phone = "5511999990001";

  await send.execute({ phone });
  const record = await otpStore.findActive(`BR:${phone}`);
  assert.ok(record, "OTP record must be stored in OtpStore after send");
  assert.ok(record.codeHash, "OTP must be stored as a hash, not plaintext");

  // Wrong code increments attempts.
  await assert.rejects(
    () => verify.execute({ phone, code: "000000" }),
    UnauthorizedException
  );
  const afterFailure = await otpStore.findActive(`BR:${phone}`);
  assert.equal(afterFailure?.attempts, 1, "attempt counter must increment on failure");
  const code = delivered[0]!.match(/\d{6}/)![0];
  const result = await verify.execute({ phone, code });
  assert.ok(result.accessToken, "the delivered OTP authenticates the buyer");
  assert.equal(await otpStore.findActive(`BR:${phone}`), null, "successful verification consumes the challenge");
});

// B2 (P0) regression: 5 wrong attempts must lock the OTP (prevent brute force).
test("OTP lockout after maxAttempts wrong codes (B2 P0 regression)", async () => {
  const { send, verify, otpStore } = makeServices();
  const phone = "5511999990002";

  await send.execute({ phone });

  // Exhaust all attempts with wrong codes.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await verify.execute({ phone, code: String(attempt).padStart(6, "0") });
    } catch {
      // Expected to throw; we continue until locked out.
    }
  }

  // 6th attempt must be locked regardless of the code.
  await assert.rejects(
    () => verify.execute({ phone, code: "000000" }),
    UnauthorizedException
  );

  // Confirm the lock reason is otp_locked, not otp_invalid.
  try {
    await verify.execute({ phone, code: "000000" });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof UnauthorizedException);
    assert.match((err as UnauthorizedException).message, /otp_locked/);
  }
});

// B4 (P2) regression: OTP is stored hashed — the store must NOT contain
// the plaintext code (prevents log/memory exposure).
test("OTP is stored as hash, not plaintext (B4 P2 regression)", async () => {
  const { send, otpStore } = makeServices();
  const phone = "5511999990003";

  await send.execute({ phone });
  const record = await otpStore.findActive(`BR:${phone}`);
  assert.ok(record, "OTP record must exist");

  // codeHash must be a hex sha256 (64 chars), not a 6-digit code.
  assert.match(record.codeHash, /^[0-9a-f]{64}$/, "codeHash must be a sha256 hex string");
  // The 6-digit code range is 100000–999999; the hash must not be within that range.
  assert.doesNotMatch(record.codeHash, /^\d{6}$/, "codeHash must not be a raw 6-digit code");
});

// B1 (P0) regression: BuyerJwtService uses BUYER_JWT_SECRET (separate from
// merchant JWT_SECRET). Verify the buyer token payload carries aud/role:"buyer"
// which merchant JwtService.verify explicitly rejects.
test("BuyerJwtService tokens carry aud:buyer and role:buyer (B1 P0 regression)", () => {
  const buyerJwt = new BuyerJwtService("buyer-test-secret", 3600);
  const buyerToken = buyerJwt.sign({ globalUserId: "buyer_1", email: "b@b.com" }, 100);
  const parts = buyerToken.split(".");
  const decoded = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  assert.equal(decoded.aud, "buyer", "buyer JWT must have aud:buyer");
  assert.equal(decoded.role, "buyer", "buyer JWT must have role:buyer");
  // The merchant guard rejects this because JwtService.verify checks for
  // aud === "buyer" or role === "buyer" and throws jwt_wrong_audience.
});
