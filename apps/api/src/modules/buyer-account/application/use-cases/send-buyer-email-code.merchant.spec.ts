import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SendBuyerEmailCodeUseCase } from "./send-buyer-email-code.use-case.js";
import { InMemoryOtpStore } from "../../infrastructure/in-memory-otp-store.js";
import type { EmailOtpContext, EmailOtpSender } from "../../domain/ports/email-otp.port.js";
import { BuyerAccountController } from "../../presentation/http/buyer-account.controller.js";

function fixture(found = true) {
  const store = new InMemoryOtpStore();
  const deliveries: Array<{ email: string; code: string; context?: EmailOtpContext }> = [];
  const lookups: string[] = [];
  const sender: EmailOtpSender = { async send(email, code, context) { deliveries.push({ email, code, context }); } };
  const useCase = new SendBuyerEmailCodeUseCase(store, sender, {
    async getProfile(id: string) {
      lookups.push(id);
      return found ? { id, name: "Loja do Catálogo" } : undefined;
    },
  } as never);
  return { store, deliveries, lookups, sender, useCase };
}

test("OTP merchant identity comes from the repository and activation keeps the delivered code and TTL", async () => {
  const { store, deliveries, lookups, useCase } = fixture();
  const before = Date.now();
  await useCase.execute({ email: " Buyer@Example.test ", merchantId: "merchant_1", merchantName: "forged store" } as never);
  assert.deepEqual(lookups, ["merchant_1"]);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]!.email, "buyer@example.test");
  assert.deepEqual(deliveries[0]!.context, { merchantName: "Loja do Catálogo" });
  const active = await store.findActive("email:buyer@example.test");
  assert.equal(active?.codeHash, createHash("sha256").update(deliveries[0]!.code).digest("hex"));
  assert.ok(active!.expiresAt.getTime() >= before + 600000);
  assert.ok(active!.expiresAt.getTime() <= Date.now() + 600000);
});

test("without merchant context, OTP remains compatible and does not use body merchant names", async () => {
  const { useCase, deliveries, lookups } = fixture();
  await useCase.execute({ email: "buyer@example.test", merchantName: "forged store" } as never);
  assert.deepEqual(lookups, []);
  assert.equal(deliveries[0]!.context, undefined);
});

test("unknown or malformed merchant fails before delivery or challenge activation", async () => {
  const { store, useCase, deliveries } = fixture(false);
  await assert.rejects(useCase.execute({ email: "buyer@example.test", merchantId: "missing" }), /otp_merchant_not_found/);
  for (const merchantId of [null, 123, {}, "", "a".repeat(192), "../other"]) {
    await assert.rejects(useCase.execute({ email: "buyer@example.test", merchantId } as never), /otp_merchant_id_invalid/);
  }
  assert.equal(deliveries.length, 0);
  assert.equal(await store.findActive("email:buyer@example.test"), null);
});

test("provided merchant requires a configured repository instead of sending an unbranded fallback", async () => {
  const { store, sender, deliveries } = fixture();
  const useCase = new SendBuyerEmailCodeUseCase(store, sender);
  await assert.rejects(useCase.execute({ email: "buyer@example.test", merchantId: "merchant_1" }), /otp_merchant_context_unavailable/);
  assert.equal(deliveries.length, 0);
});

test("email/send forwards only email and merchant_id, ignoring arbitrary body merchantName", async () => {
  const forwarded: unknown[] = [];
  const controller = Object.assign(Object.create(BuyerAccountController.prototype), {
    sendEmailCode: { execute: async (request: unknown) => { forwarded.push(request); return { sent: true }; } },
  }) as BuyerAccountController;
  await controller.handleSendEmailCode({ email: "buyer@example.test", merchant_id: "merchant_1", merchantName: "forged", merchantId: "forged" } as never);
  assert.deepEqual(forwarded, [{ email: "buyer@example.test", merchantId: "merchant_1" }]);
});
