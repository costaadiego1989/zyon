import { BadRequestException } from "@nestjs/common";
import test from "node:test";
import assert from "node:assert/strict";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../infrastructure/fake-payment-provider.js";

test("CreatePaymentIntentUseCase throws NotFound when checkout session is missing", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const uc = new CreatePaymentIntentUseCase(checkout, new InMemoryPaymentRepository(), new FakePaymentProvider());
  await assert.rejects(
    () =>
      uc.execute({
        merchant_id: "m1",
        session_id: "missing",
        idempotency_key: "k1"
      }),
    /checkout_session_not_found/
  );
});

test("CreatePaymentIntentUseCase is idempotent on (merchant, session, idempotency_key)", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  const uc = new CreatePaymentIntentUseCase(checkout, new InMemoryPaymentRepository(), new FakePaymentProvider());

  const a = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_1",
    accepted_offer_id: "offer_1"
  });
  const b = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_1",
    accepted_offer_id: "offer_1"
  });

  assert.deepEqual(a, b);
  assert.match(a.id, /^pay_int_/);
  assert.equal(a.status, "requires_action");
  assert.equal(a.providerPaymentId, "fake_pay_1");
  assert.equal(a.acceptedOfferId, "offer_1");
});

test("CreatePaymentIntentUseCase rejects when Asaas is configured but session buyer has no asaasCustomerId", async () => {
  const keys = [
    "ASAAS_SANDBOX",
    "ASAAS_API_KEY_SANDBOX",
    "ASAAS_API_KEY",
    "ASAAS_API_BASE_URL",
    "ASAAS_API_BASE_URL_SANDBOX"
  ] as const;
  const backup: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) backup[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    process.env.ASAAS_SANDBOX = "true";
    process.env.ASAAS_API_KEY_SANDBOX = "sk_sb_test";

    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(checkoutSession({ customer: { email: "a@b.com" } }));

    const uc = new CreatePaymentIntentUseCase(checkout, new InMemoryPaymentRepository(), new FakePaymentProvider());

    await assert.rejects(() => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "z1" }), (err: unknown) => err instanceof BadRequestException);
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
