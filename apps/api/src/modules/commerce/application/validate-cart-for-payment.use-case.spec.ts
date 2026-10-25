import test from "node:test";
import assert from "node:assert/strict";
import { ValidateCartForPaymentUseCase } from "./validate-cart-for-payment.use-case.js";

test("ignores inflated browser total when trusted commerce cart differs", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 5000,
        lines: [{ sku: "a", quantity: 1, unitPriceCents: 5000, title: "A" }],
        commerceCartRef: "c1"
      };
    }
  });
  await assert.rejects(
    () =>
      uc.execute({
        merchantId: "m1",
        commerceCartRef: "c1",
        clientReportedTotalCents: 1
      }),
    /client_total_mismatch/
  );
});

test("accepts matching client reported total optionally", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 5000,
        lines: [],
        commerceCartRef: "c1"
      };
    }
  });
  const out = await uc.execute({
    merchantId: "m1",
    commerceCartRef: "c1",
    clientReportedTotalCents: 5000
  });
  assert.equal(out.trustedCart.totalCents, 5000);
});

test("omitting client reported total trusts commerce snapshot only", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 12_099,
        lines: [{ sku: "z", quantity: 3, unitPriceCents: 4033, title: "Z" }],
        commerceCartRef: "ref_x"
      };
    }
  });
  const out = await uc.execute({ merchantId: "m1", commerceCartRef: "ref_x" });
  assert.equal(out.trustedCart.totalCents, 12_099);
});

test("rejects when commerce snapshot cart ref differs from requested ref", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      return {
        currency: "BRL",
        totalCents: 100,
        lines: [],
        commerceCartRef: "other_ref"
      };
    }
  });
  await assert.rejects(
    () =>
      uc.execute({
        merchantId: "m1",
        commerceCartRef: "expected_ref",
        clientReportedTotalCents: 100
      }),
    /commerce_cart_ref_mismatch/
  );
});

test("propagates errors from commerce cart validation", async () => {
  const uc = new ValidateCartForPaymentUseCase({
    async validateCart() {
      throw new Error("commerce_upstream_rate_limited");
    }
  });
  await assert.rejects(
    () => uc.execute({ merchantId: "m1", commerceCartRef: "c1" }),
    /commerce_upstream_rate_limited/
  );
});
