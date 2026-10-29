import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { InMemoryEmailChangeOtpStore } from "../infrastructure/in-memory-email-change-otp-store.js";
import { EmailChangeRateLimiter } from "../domain/services/email-change-rate-limiter.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import type { EmailSenderPort } from "../../notifications/domain/ports/email-sender.port.js";
import { RequestEmailChangeUseCase } from "./request-email-change.use-case.js";
import { ConfirmEmailChangeUseCase } from "./confirm-email-change.use-case.js";
import {
  EmailAlreadyRegisteredError,
  EmailChangeRequestThrottledError,
  InvalidEmailError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
} from "../domain/errors.js";

class FakeEmailSender implements EmailSenderPort {
  public sent: Array<{ to: string; subject: string; html: string }> = [];
  async send(input: { to: string; subject: string; html: string }) {
    this.sent.push(input);
    return { messageId: "msg_1", status: "sent" as const };
  }
}

function makeSut() {
  const repo = new InMemoryAuthRepository();
  const otpStore = new InMemoryEmailChangeOtpStore();
  const emailSender = new FakeEmailSender();
  const rateLimiter = new EmailChangeRateLimiter(3, 15 * 60 * 1000);
  const request = new RequestEmailChangeUseCase(repo, otpStore, emailSender, rateLimiter);
  const confirm = new ConfirmEmailChangeUseCase(repo, otpStore, emailSender, rateLimiter);
  return { repo, otpStore, emailSender, rateLimiter, request, confirm };
}

async function seedMerchant(repo: InMemoryAuthRepository, email = "owner@x.com") {
  const { user } = await repo.createMerchantWithOwner({
    merchantId: "merch_1",
    merchantName: "Loja X",
    email,
    passwordHash: await new PasswordHasher().hash("currentPass1"),
  });
  await repo.updateOwnerProfile(user.id, "merch_1", { ownerName: "Owner", ownerPhone: "" });
  return user;
}

test("RequestEmailChangeUseCase: rejects invalid email", async () => {
  const { request } = makeSut();
  await assert.rejects(
    () => request.execute({ merchantId: "merch_1", newEmail: "not-an-email" }),
    InvalidEmailError,
  );
});

test("RequestEmailChangeUseCase: rejects when new email equals current", async () => {
  const { repo, request } = makeSut();
  await seedMerchant(repo);
  await assert.rejects(
    () => request.execute({ merchantId: "merch_1", newEmail: "owner@x.com" }),
    BadRequestException,
  );
});

test("RequestEmailChangeUseCase: rejects when new email already taken", async () => {
  const { repo, request } = makeSut();
  await seedMerchant(repo, "owner@x.com");
  await repo.createMerchantWithOwner({
    merchantId: "merch_2",
    merchantName: "Loja Y",
    email: "other@y.com",
    passwordHash: "h",
  });
  await assert.rejects(
    () => request.execute({ merchantId: "merch_1", newEmail: "other@y.com" }),
    BadRequestException,
  );
});

test("RequestEmailChangeUseCase: sends OTP email and stores hash", async () => {
  const { repo, emailSender, otpStore, request } = makeSut();
  await seedMerchant(repo);
  const result = await request.execute({ merchantId: "merch_1", newEmail: "new@x.com" });
  assert.equal(result.sent, true);
  assert.match(result.delivered_to, /\*\*\*/);
  assert.equal(emailSender.sent.length, 1);
  assert.equal(emailSender.sent[0]!.to, "new@x.com");
  assert.match(emailSender.sent[0]!.html, />\d{6}</);

  const record = await otpStore.findActive(
    (await repo.getOwnerProfile("merch_1"))!.userId,
  );
  assert.ok(record);
  assert.equal(record.newEmail, "new@x.com");
  assert.match(record.codeHash, /^[0-9a-f]{64}$/); // sha256 hex
});

test("RequestEmailChangeUseCase: rate-limits after 3 requests in 15min", async () => {
  const { repo, request } = makeSut();
  await seedMerchant(repo);
  for (let i = 0; i < 3; i++) {
    await request.execute({ merchantId: "merch_1", newEmail: `new${i}@x.com` });
  }
  await assert.rejects(
    () => request.execute({ merchantId: "merch_1", newEmail: "new3@x.com" }),
    EmailChangeRequestThrottledError,
  );
});

test("RequestEmailChangeUseCase: rejects when profile missing", async () => {
  const { request } = makeSut();
  await assert.rejects(
    () => request.execute({ merchantId: "ghost", newEmail: "new@x.com" }),
    NotFoundException,
  );
});

test("ConfirmEmailChangeUseCase: rejects when no active OTP", async () => {
  const { repo, confirm } = makeSut();
  await seedMerchant(repo);
  await assert.rejects(
    () => confirm.execute({ merchantId: "merch_1", newEmail: "new@x.com", code: "123456" }),
    OtpExpiredError,
  );
});

test("ConfirmEmailChangeUseCase: rejects when code is wrong (increments attempts)", async () => {
  const { repo, otpStore, request, confirm } = makeSut();
  await seedMerchant(repo);
  await request.execute({ merchantId: "merch_1", newEmail: "new@x.com" });

  await assert.rejects(
    () => confirm.execute({ merchantId: "merch_1", newEmail: "new@x.com", code: "000000" }),
    OtpInvalidError,
  );
  const userId = (await repo.getOwnerProfile("merch_1"))!.userId;
  const record = await otpStore.findActive(userId);
  assert.equal(record?.attempts, 1);
});

test("ConfirmEmailChangeUseCase: locks after maxAttempts wrong codes", async () => {
  const { repo, request, confirm } = makeSut();
  await seedMerchant(repo);
  await request.execute({ merchantId: "merch_1", newEmail: "new@x.com" });

  for (let i = 0; i < 4; i++) {
    try {
      await confirm.execute({ merchantId: "merch_1", newEmail: "new@x.com", code: "000000" });
    } catch { /* expected */ }
  }

  // 5th attempt is the one that triggers the lock.
  await assert.rejects(
    () => confirm.execute({ merchantId: "merch_1", newEmail: "new@x.com", code: "000000" }),
    OtpLockedError,
  );
});

test("ConfirmEmailChangeUseCase: rejects when newEmail taken by another user (race)", async () => {
  const { repo, otpStore, emailSender, rateLimiter } = makeSut();
  await seedMerchant(repo, "owner@x.com");
  await repo.createMerchantWithOwner({
    merchantId: "merch_2",
    merchantName: "Loja Y",
    email: "new@x.com",
    passwordHash: "h",
  });

  // Manually inject an OTP record to bypass the "email already taken" check at request time.
  const userId = (await repo.getOwnerProfile("merch_1"))!.userId;
  const { createHash } = await import("node:crypto");
  await otpStore.save({
    userId,
    newEmail: "new@x.com",
    codeHash: createHash("sha256").update("111111").digest("hex"),
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const confirm = new ConfirmEmailChangeUseCase(repo, otpStore, emailSender, rateLimiter);
  await assert.rejects(
    () => confirm.execute({ merchantId: "merch_1", newEmail: "new@x.com", code: "111111" }),
    EmailAlreadyRegisteredError,
  );
});

test("ConfirmEmailChangeUseCase: rejects when newEmail doesn't match OTP", async () => {
  const { repo, request, confirm } = makeSut();
  await seedMerchant(repo);
  await request.execute({ merchantId: "merch_1", newEmail: "new@x.com" });

  // Code is wrong → OtpInvalidError thrown before the email_mismatch check
  // (which is intentional — do not leak whether the email was the right one).
  await assert.rejects(
    () => confirm.execute({ merchantId: "merch_1", newEmail: "different@x.com", code: "000000" }),
    OtpInvalidError,
  );
});
