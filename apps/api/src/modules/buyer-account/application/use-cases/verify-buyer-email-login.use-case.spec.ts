import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { EmailVerificationReceiptService } from "../../domain/services/email-verification-receipt.service.js";
import { InMemoryBuyerAccountRepository } from "../../infrastructure/in-memory-buyer-account.repository.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";
import { VerifyBuyerEmailCodeUseCase } from "./verify-buyer-email-code.use-case.js";
import { VerifyBuyerEmailLoginUseCase } from "./verify-buyer-email-login.use-case.js";

test("email OTP authenticates an existing buyer and consumes the challenge", async () => {
  const email = "buyer@example.test";
  const code = "654321";
  const accounts = new InMemoryBuyerAccountRepository();
  const otpStore = new InMemoryOtpStore();
  await accounts.save(new BuyerAccount({
    globalUserId: "buyer_email_otp",
    email,
    passwordHash: null,
    displayName: "Buyer Email",
    phone: "5511999990001",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await otpStore.save({
    phone: `email:${email}`,
    codeHash: createHash("sha256").update(code).digest("hex"),
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const jwt = new BuyerJwtService("buyer-test-secret", 3600);
  const useCase = new VerifyBuyerEmailLoginUseCase(
    new VerifyBuyerEmailCodeUseCase(otpStore, new EmailVerificationReceiptService()),
    accounts,
    jwt,
  );

  const result = await useCase.execute({ email, code });
  assert.equal(result.globalUserId, "buyer_email_otp");
  assert.equal(jwt.verify(result.accessToken).email, email);
  assert.equal(await otpStore.findActive(`email:${email}`), null);
});

test("a login attempt for an unregistered buyer preserves the valid OTP for registration", async () => {
  const email = "new-buyer@example.test";
  const code = "654321";
  const accounts = new InMemoryBuyerAccountRepository();
  const otpStore = new InMemoryOtpStore();
  const verifyEmailCode = new VerifyBuyerEmailCodeUseCase(otpStore, new EmailVerificationReceiptService());
  await otpStore.save({
    phone: `email:${email}`,
    codeHash: createHash("sha256").update(code).digest("hex"),
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const login = new VerifyBuyerEmailLoginUseCase(
    verifyEmailCode,
    accounts,
    new BuyerJwtService("buyer-test-secret", 3600),
  );

  await assert.rejects(login.execute({ email, code }), /email_otp_account_not_found/);
  assert.ok(await otpStore.findActive(`email:${email}`));
  assert.equal((await verifyEmailCode.execute({ email, code })).verified, true);
  assert.equal(await otpStore.findActive(`email:${email}`), null);
});
