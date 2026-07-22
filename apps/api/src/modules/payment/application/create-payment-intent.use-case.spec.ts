import { BadRequestException, ConflictException } from "@nestjs/common";
import test from "node:test";
import assert from "node:assert/strict";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../infrastructure/fake-payment-provider.js";
import type { CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { CreateProviderPaymentInput, CreateProviderPaymentOutput, PaymentProviderPort } from "../domain/ports/payment-provider.port.js";
import { ValidateCartForPaymentUseCase } from "../../commerce/application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "../../commerce/application/sync-pending-order.use-case.js";
import { InMemoryPendingCommerceOrderIndex } from "../../commerce/infrastructure/in-memory-pending-commerce-order-index.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";

class CapturingPaymentProvider implements PaymentProviderPort {
  readonly inputs: CreateProviderPaymentInput[] = [];

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    this.inputs.push(input);
    return {
      providerPaymentId: "fake_pay_1",
      status: "requires_action",
      buyerFacingPayload: {
        qrCodeCopyPaste: "fake_br_code",
        invoiceUrl: "https://example.test/invoice/fake_pay_1"
      }
    };
  }
}

test("CreatePaymentIntentUseCase throws NotFound when checkout session is missing", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());
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

  const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());

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
  assert.deepEqual(a.statusHistory.map((entry) => entry.status), ["pending", "requires_action"]);
  assert.equal(checkout.listOutbox("mrc_1").some((event) => event.event_type === "payment.status.changed"), true);
});

test("CreatePaymentIntentUseCase charges cart total with selected shipping and discount", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      cart: {
        currency: "BRL",
        total: 200,
        currentDiscount: 20,
        items: [{ sku: "sku", name: "Item", price: 200, quantity: 1 }]
      },
      shipping: { customerPrice: 30, realCost: 20, method: "PAC" },
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());
  const intent = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_total"
  });

  assert.equal(intent.amountCents, 21000);
});

test("CreatePaymentIntentUseCase rejects payment before selected shipping exists", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      shipping: undefined,
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());

  await assert.rejects(
    () =>
      uc.execute({
        merchant_id: "mrc_1",
        session_id: "chk_1",
        idempotency_key: "idem_missing_shipping"
      }),
    /shipping_method_required_before_payment/
  );
});

test("CreatePaymentIntentUseCase returns Stripe client secret and publishable key for card", async () => {
  const keys = [
    "STRIPE_SECRET_KEY_TEST",
    "STRIPE_PUBLISHABLE_KEY_TEST",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "PLATFORM_FEE_BRL"
  ] as const;
  const backup: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) backup[k] = process.env[k];
  try {
    process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fixture";
    process.env.STRIPE_PUBLISHABLE_KEY_TEST = "pk_test_fixture";
    process.env.PLATFORM_FEE_BRL = "1.99";

    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(
      checkoutSession({
        shipping: { customerPrice: 0, realCost: 20, method: "Frete gratis" },
        customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
      })
    );

    class StripeCapturingProvider extends CapturingPaymentProvider {
      async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
        this.inputs.push(input);
        return {
          providerPaymentId: "pi_test_123",
          status: "requires_action",
          buyerFacingPayload: {
            clientSecret: "pi_test_123_secret_abc",
            stripePublishableKey: "pk_test_fixture"
          }
        };
      }
    }

    const provider = new StripeCapturingProvider();
    const uc = new CreatePaymentIntentUseCase(
      checkout,
      checkout,
      new InMemoryPaymentRepository(checkout),
      provider
    );

    const intent = await uc.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      idempotency_key: "idem_card_stripe",
      method: "card"
    });

    assert.equal(intent.method, "card");
    assert.equal(intent.status, "requires_action");
    assert.equal(intent.providerPaymentId, "pi_test_123");
    assert.equal(intent.buyerFacing?.clientSecret, "pi_test_123_secret_abc");
    assert.equal(intent.buyerFacing?.stripePublishableKey, "pk_test_fixture");
    assert.equal(provider.inputs[0]?.stripeConnectAccountId, "acct_test_connect");
    assert.equal(provider.inputs[0]?.platformFeeCents, 597);
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("CreatePaymentIntentUseCase calculates Growth transaction fee from subscription", async () => {
  const previous = process.env.STRIPE_BILLING_PRICE_GROWTH;
  process.env.STRIPE_BILLING_PRICE_GROWTH = "price_growth_test";
  try {
    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(
      checkoutSession({
        shipping: { customerPrice: 0, realCost: 20, method: "Frete gratis" },
        customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
      })
    );
    const platform = new InMemoryPaymentPlatformRepository();
    await platform.saveBilling({
      merchantId: "mrc_1",
      status: "active",
      stripePriceId: "price_growth_test",
    });
    const provider = new CapturingPaymentProvider();
    const uc = new CreatePaymentIntentUseCase(
      checkout,
      checkout,
      new InMemoryPaymentRepository(checkout),
      provider,
      undefined,
      undefined,
      undefined,
      platform,
    );

    const intent = await uc.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      idempotency_key: "idem_growth_fee",
    });

    assert.equal(intent.amountCents, 30000);
    assert.equal(provider.inputs[0]?.amountCents, 30000);
    assert.equal(provider.inputs[0]?.platformFeeCents, 447);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_BILLING_PRICE_GROWTH;
    else process.env.STRIPE_BILLING_PRICE_GROWTH = previous;
  }
});

test("CreatePaymentIntentUseCase passes platform fee to crypto provider", async () => {
  const previous = process.env.STRIPE_BILLING_PRICE_GROWTH;
  process.env.STRIPE_BILLING_PRICE_GROWTH = "price_growth_test";
  try {
    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(
      checkoutSession({
        shipping: { customerPrice: 0, realCost: 20, method: "Frete gratis" },
        customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
      })
    );
    const platform = new InMemoryPaymentPlatformRepository();
    await platform.saveBilling({
      merchantId: "mrc_1",
      status: "active",
      stripePriceId: "price_growth_test",
    });
    const provider = new CapturingPaymentProvider();
    const uc = new CreatePaymentIntentUseCase(
      checkout,
      checkout,
      new InMemoryPaymentRepository(checkout),
      provider,
      undefined,
      undefined,
      undefined,
      platform,
    );

    await uc.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      idempotency_key: "idem_crypto_fee",
      method: "crypto",
    });

    assert.equal(provider.inputs[0]?.method, "crypto");
    assert.equal(provider.inputs[0]?.platformFeeCents, 447);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_BILLING_PRICE_GROWTH;
    else process.env.STRIPE_BILLING_PRICE_GROWTH = previous;
  }
});

test("CreatePaymentIntentUseCase rejects card when Stripe is not configured", async () => {
  const keys = [
    "STRIPE_SECRET_KEY_TEST",
    "STRIPE_PUBLISHABLE_KEY_TEST",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY"
  ] as const;
  const backup: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) backup[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];

    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(
      checkoutSession({
        customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
      })
    );

    const provider = new CapturingPaymentProvider();
    const uc = new CreatePaymentIntentUseCase(
      checkout,
      checkout,
      new InMemoryPaymentRepository(checkout),
      provider
    );

    await assert.rejects(
      () =>
        uc.execute({
          merchant_id: "mrc_1",
          session_id: "chk_1",
          idempotency_key: "idem_card_no_stripe",
          method: "card"
        }),
      (err: unknown) =>
        err instanceof ConflictException &&
        err.message.includes("stripe_provider_not_configured")
    );
    assert.equal(provider.inputs.length, 0);
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("CreatePaymentIntentUseCase allows zero-price selected shipping", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      shipping: { customerPrice: 0, realCost: 20, method: "Frete gratis" },
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());

  const intent = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_free_shipping"
  });

  assert.equal(intent.amountCents, 30000);
});

test("CreatePaymentIntentUseCase validates commerce cart and creates pending order before provider payment", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      cart: {
        currency: "BRL",
        source: "platform_api",
        commerceCartRef: "cart_123",
        total: 300,
        items: [{ sku: "sku", name: "Item", price: 300, quantity: 1 }]
      },
      shipping: { customerPrice: 0, realCost: 0, method: "Frete gratis" },
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  let validateCalls = 0;
  let createCalls = 0;
  const validateCart = new ValidateCartForPaymentUseCase({
    async validateCart(input) {
      validateCalls += 1;
      assert.equal(input.merchantId, "mrc_1");
      assert.equal(input.commerceCartRef, "cart_123");
      return {
        currency: "BRL",
        totalCents: 30000,
        commerceCartRef: "cart_123",
        lines: [{ sku: "sku", quantity: 1, unitPriceCents: 30000, title: "Item" }]
      };
    }
  });
  const syncPendingOrder = new SyncPendingOrderUseCase(
    {
      async createPendingOrder(input) {
        createCalls += 1;
        assert.equal(input.merchantId, "mrc_1");
        assert.equal(input.sessionId, "chk_1");
        assert.equal(input.cart.commerceCartRef, "cart_123");
        return { commerceOrderId: "draft_123" };
      },
      async markOrderPaid() {
        throw new Error("not_expected");
      }
    },
    new InMemoryPendingCommerceOrderIndex()
  );
  const provider = new CapturingPaymentProvider();
  const uc = new CreatePaymentIntentUseCase(
    checkout,
    checkout,
    new InMemoryPaymentRepository(checkout),
    provider,
    undefined,
    validateCart,
    syncPendingOrder
  );

  const first = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_commerce"
  });
  const second = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    idempotency_key: "idem_commerce"
  });

  assert.deepEqual(second, first);
  assert.equal(validateCalls, 1);
  assert.equal(createCalls, 1);
  assert.equal(provider.inputs.length, 1);
  assert.equal(first.commerceOrderId, "draft_123");
  assert.match(provider.inputs[0]?.description ?? "", /commerce_order:draft_123/);
  assert.equal(checkout.listOutbox("mrc_1").at(-1)?.payload.commerce_order_id, "draft_123");
});

test("CreatePaymentIntentUseCase rejects commerce-backed payment when trusted cart total differs", async () => {
  const checkout = new InMemoryCheckoutRepository();
  await checkout.saveSession(
    checkoutSession({
      cart: {
        currency: "BRL",
        source: "platform_api",
        commerceCartRef: "cart_changed",
        total: 300,
        items: [{ sku: "sku", name: "Item", price: 300, quantity: 1 }]
      },
      shipping: { customerPrice: 0, realCost: 0, method: "Frete gratis" },
      customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
    })
  );

  const validateCart = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 99900,
        commerceCartRef: "cart_changed",
        lines: [{ sku: "sku", quantity: 1, unitPriceCents: 99900, title: "Item" }]
      };
    }
  });
  const provider = new CapturingPaymentProvider();
  const uc = new CreatePaymentIntentUseCase(
    checkout,
    checkout,
    new InMemoryPaymentRepository(checkout),
    provider,
    undefined,
    validateCart,
    new SyncPendingOrderUseCase(
      {
        async createPendingOrder() {
          throw new Error("not_expected");
        },
        async markOrderPaid() {
          throw new Error("not_expected");
        }
      },
      new InMemoryPendingCommerceOrderIndex()
    )
  );

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "idem_bad_cart" }),
    /client_total_mismatch/
  );
  assert.equal(provider.inputs.length, 0);
});

test("CreatePaymentIntentUseCase never auto-approves from runtime flags", async () => {
  const previousSeed = process.env.E2E_SEED_ENABLED;
  const previousAutoApprove = process.env.PAYMENT_FAKE_AUTO_APPROVE;
  process.env.E2E_SEED_ENABLED = "true";
  process.env.PAYMENT_FAKE_AUTO_APPROVE = "true";
  try {
    const checkout = new InMemoryCheckoutRepository();
    await checkout.saveSession(
      checkoutSession({
        customer: { email: "buyer@example.com", asaasCustomerId: "cus_fixture_1" }
      })
    );

    const completed: unknown[] = [];
    const checkoutPayment: CheckoutPaymentPort = {
      completeAfterApproval: async (input) => { completed.push(input); },
      recordPaymentFailure: async () => undefined,
      recordPaymentStatusChanged: async () => undefined
    };
    const uc = new CreatePaymentIntentUseCase(
      checkout,
      checkout,
      new InMemoryPaymentRepository(checkout),
      new FakePaymentProvider(),
      checkoutPayment
    );

    const intent = await uc.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      idempotency_key: "idem_auto_approve",
      method: "pix"
    });

    assert.equal(intent.status, "requires_action");
    assert.deepEqual(intent.statusHistory.map((entry) => entry.status), ["pending", "requires_action"]);
    assert.equal(completed.length, 0);
  } finally {
    if (previousSeed === undefined) delete process.env.E2E_SEED_ENABLED;
    else process.env.E2E_SEED_ENABLED = previousSeed;
    if (previousAutoApprove === undefined) delete process.env.PAYMENT_FAKE_AUTO_APPROVE;
    else process.env.PAYMENT_FAKE_AUTO_APPROVE = previousAutoApprove;
  }
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

    const uc = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), new FakePaymentProvider());

    await assert.rejects(() => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "z1" }), (err: unknown) => err instanceof BadRequestException);
  } finally {
    for (const k of keys) {
      const v = backup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
