import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { buildExperienceFromSession } from "./checkout-experience.service.js";
import { GetCheckoutSessionUseCase } from "../use-cases/get-checkout-session.use-case.js";

const session = checkoutSession({ cart: { currency: "BRL", total: 100, items: [{ sku: "p", name: "Produto", quantity: 1, price: 100 }], cashbackCents: 9999 },
  shipping: { customerPrice: 15, realCost: 15, region: "SP" } });

test("CB-13 checkout experience displays authoritative cashback separately and subtracts it once", () => {
  const experience = buildExperienceFromSession(session, { cashbackCents: 2000 });
  assert.equal(experience.totals.subtotal, 100); assert.equal(experience.totals.shipping, 15);
  assert.equal(experience.totals.discount, 0); assert.equal(experience.totals.cashback_cents, 2000);
  assert.equal(experience.totals.total, 95);
});

test("CB-15 client cart cashback projection cannot change authoritative experience totals", () => {
  const experience = buildExperienceFromSession(session, {});
  assert.equal(experience.totals.total, 115); assert.equal(experience.totals.cashback_cents, undefined);
});

test("CB-20 checkout reload projects reserved credit from the same server wallet", async () => {
  const reader = new GetCheckoutSessionUseCase({ getSession: async () => session } as any, undefined,
    { checkoutCashbackCents: async () => 2000 } as any);
  const result = await reader.execute(session.merchantId, session.sessionId);
  assert.equal(result.cart.cashbackCents, 2000); assert.equal(result.cart.total, 100);
  assert.equal(result.globalUserId, session.globalUserId);
});

test("CB-17 reload without cashback omits any untrusted client projection", async () => {
  const reader = new GetCheckoutSessionUseCase({ getSession: async () => session } as any);
  const result = await reader.execute(session.merchantId, session.sessionId);
  assert.equal("cashbackCents" in result.cart, false); assert.equal(result.cart.total, 100);
});

test("CB-16 digital and service cashback totals exclude freight left by a previous physical cart", () => {
  for (const productType of ["digital", "service"] as const) {
    const experience = buildExperienceFromSession({ ...session, cart: { ...session.cart,
      items: [{ ...session.cart.items[0], productType }] } }, { cashbackCents: 2000 });
    assert.equal(experience.totals.shipping, 0); assert.equal(experience.totals.total, 80);
    assert.equal(experience.totals.cashback_cents, 2000);
  }
});
