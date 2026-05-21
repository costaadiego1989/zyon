import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { EmbedCheckoutGuardHelper } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { WidgetCouponsController } from "./widget-coupons.controller.js";

test("WidgetCouponsController uses merchant from embed token and ignores body merchant_id", async () => {
  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(checkoutSession({ merchantId: "m_token", sessionId: "sess_coupon" }));
  const now = Math.floor(Date.now() / 1000);
  const tokens = new EmbedTokenService({ value: Buffer.from("embed-coupon-spec-secret-32chars!!") });
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 900,
      nonce: "coupon"
    })
  );

  let seen: Record<string, unknown> | undefined;
  const applyCoupon = {
    async execute(input: Record<string, unknown>) {
      seen = input;
      return { redemption_id: "red_1", discount_applied: 10, coupon: { code: "PROMO10" } };
    }
  };
  const controller = new WidgetCouponsController(
    applyCoupon as never,
    new EmbedCheckoutGuardHelper(checkout)
  );

  await controller.apply(
    { embedClaims },
    {
      session_id: "sess_coupon",
      merchant_id: "m_body",
      code: " PROMO10 ",
      cart: { currency: "BRL", total: 100, items: [{ sku: "x", name: "X", price: 100, quantity: 1 }] }
    }
  );

  assert.equal(seen?.merchant_id, "m_token");
  assert.equal(seen?.code, "PROMO10");
  assert.equal(seen?.source, "manual");
});

test("WidgetCouponsController rejects session from another merchant", async () => {
  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(checkoutSession({ merchantId: "m_other", sessionId: "sess_coupon" }));
  const now = Math.floor(Date.now() / 1000);
  const tokens = new EmbedTokenService({ value: Buffer.from("embed-coupon-spec-secret-32chars!!") });
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 900,
      nonce: "coupon-cross"
    })
  );
  const controller = new WidgetCouponsController(
    { async execute() { return {}; } } as never,
    new EmbedCheckoutGuardHelper(checkout)
  );

  await assert.rejects(
    () =>
      controller.apply(
        { embedClaims },
        {
          session_id: "sess_coupon",
          merchant_id: "m_body",
          code: "PROMO10",
          cart: { currency: "BRL", total: 100, items: [{ sku: "x", name: "X", price: 100, quantity: 1 }] }
        }
      ),
    (err: unknown) => err instanceof UnauthorizedException
  );
});
