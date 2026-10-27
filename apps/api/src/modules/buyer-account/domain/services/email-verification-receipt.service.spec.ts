import assert from "node:assert/strict";
import test from "node:test";
import { EmailVerificationReceiptService } from "./email-verification-receipt.service.js";

test("email verification receipt is bound to the verified email", () => {
  const receipts = new EmailVerificationReceiptService();
  const now = Date.now();
  const token = receipts.issue("Buyer@Example.com", now);

  assert.doesNotThrow(() => receipts.assertValid(token, "buyer@example.com", now + 1));
  assert.throws(() => receipts.assertValid(token, "other@example.com", now + 1), /email_verification_invalid/);
});

test("email verification receipt rejects tampering and expiration", () => {
  const receipts = new EmailVerificationReceiptService();
  const now = Date.now();
  const token = receipts.issue("buyer@example.com", now);

  assert.throws(() => receipts.assertValid(`${token}x`, "buyer@example.com", now + 1), /email_verification_invalid/);
  assert.throws(() => receipts.assertValid(token, "buyer@example.com", now + 15 * 60 * 1000), /email_verification_invalid/);
});
