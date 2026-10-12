import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import { EmbedCheckoutGuardHelper } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { WidgetCouponsController } from "./widget-coupons.controller.js";
import { checkoutWithCoupon } from "../../application/services/checkout-coupon.js";

function fixture(shipping = false) {
  const checkout = new InMemoryCheckoutRepository();
  const embedClaims = { typ: "aacp_embed_v1" as const, merchantId: "m_token", nonce: "coupon",
    issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(embedClaims);
  const persisted = checkoutSession({ merchantId: "m_token", sessionId, persistenceVersion: 7,
    cart: { currency: "BRL", total: 250, items: [{ sku: "real", name: "Real", price: 250, quantity: 1 }] },
    shipping: { customerPrice: 25 } });
  checkout.saveSession(persisted);
  const calls: unknown[] = [];
  const result = { redemption_id: "red", discount_applied: shipping ? 0 : 10,
    shipping_discount_applied: shipping ? 25 : 0,
    coupon: { code: "PROMO", discount_type: shipping ? "shipping_free" : "fixed" } };
  const confirmed = checkoutWithCoupon(persisted, result);
  const service = { async executeForCheckout(input: unknown) {
    calls.push(input);
    return { result, session: confirmed, rules: DEFAULT_MERCHANT_RULES };
  } };
  const controller = new WidgetCouponsController(service as never, new EmbedCheckoutGuardHelper(checkout), checkout,
    { async getProfile() { return { name: "Store" }; } } as never, { platformFeeBrl: 0 });
  return { controller, service, checkout, embedClaims, sessionId, calls, persisted };
}

test("widget coupon forwards only signed scope, code and server version, ignoring forged commerce inputs", async () => {
  const f = fixture();
  const response = await f.controller.apply({ embedClaims: f.embedClaims }, {
    session_id: f.sessionId, merchant_id: "other", code: " PROMO ",
    cart: { currency: "BRL", total: 1, items: [] }, buyer_global_user_id: "forged", buyer_region: "XX",
  });
  assert.deepEqual(f.calls, [{ merchant_id: "m_token", session_id: f.sessionId, code: "PROMO", expectedVersion: 7 }]);
  assert.equal(response.experience.totals.discount, 10);
  assert.equal(response.experience.commercial_nudge?.couponCode, "PROMO");
  // Controller must not perform a second independent session write.
  assert.deepEqual(await f.checkout.getSession("m_token", f.sessionId), f.persisted);
  assert.equal("session" in response, false);
});

test("widget coupon renders the shipping price returned by the committed operation", async () => {
  const f = fixture(true);
  const response = await f.controller.apply({ embedClaims: f.embedClaims }, {
    session_id: f.sessionId, merchant_id: "m_token", code: "PROMO", cart: f.persisted.cart,
  });
  assert.equal(response.experience.totals.shipping, 0);
  assert.equal(response.experience.commercial_nudge?.couponCode, "PROMO");
});

test("widget coupon rejects a session not bound to the embed token before attempting application", async () => {
  const f = fixture();
  await assert.rejects(f.controller.apply({ embedClaims: f.embedClaims }, {
    session_id: "foreign", merchant_id: "m_token", code: "PROMO", cart: f.persisted.cart,
  }), UnauthorizedException);
  assert.equal(f.calls.length, 0);
});

test("widget coupon propagates an atomic failure without returning an applied benefit", async () => {
  const f = fixture();
  f.service.executeForCheckout = async () => { throw new Error("write_failed"); };
  await assert.rejects(f.controller.apply({ embedClaims: f.embedClaims }, {
    session_id: f.sessionId, merchant_id: "m_token", code: "PROMO", cart: f.persisted.cart,
  }), /write_failed/);
  assert.deepEqual(await f.checkout.getSession("m_token", f.sessionId), f.persisted);
});
