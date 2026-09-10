import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { EmbedCheckoutGuardHelper } from "../../../embed/presentation/http/embed-checkout.controller.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { WidgetCouponsController } from "./widget-coupons.controller.js";

const merchantRepo = {
  async getProfile(merchantId: string) {
    return { merchant_id: merchantId, name: "Loja Teste" };
  },
  async getRules() {
    return {
      maxDiscountPercent: 0,
      minimumMarginPercent: 38,
      allowFreeShipping: false,
      allowShippingDiscount: false,
      allowBonusItem: false,
      allowStackDiscountAndFreeShipping: false,
      freeShippingMinCartValue: 250,
      maxShippingSubsidy: 0,
      maxPartialShippingDiscount: 0,
      offerExpirationMinutes: 15,
      blockedRegions: [],
      brandVoice: "consultative",
      couponBoxEnabled: true
    };
  }
};

test("WidgetCouponsController uses merchant from embed token and ignores body merchant_id", async () => {
  const checkout = new InMemoryCheckoutRepository();
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
  const sessionId = embedCheckoutSessionId(embedClaims);
  const persisted = checkoutSession({
    merchantId: "m_token",
    sessionId,
    cart: {
      currency: "BRL",
      total: 250,
      items: [{ sku: "persisted-sku", name: "Produto persistido", price: 250, quantity: 1 }],
    },
  });
  checkout.saveSession(persisted);

  let seen: Record<string, unknown> | undefined;
  const applyCoupon = {
    async execute(input: Record<string, unknown>) {
      seen = input;
      return { redemption_id: "red_1", discount_applied: 10, coupon: { code: "PROMO10" } };
    }
  };
  const controller = new WidgetCouponsController(
    applyCoupon as never,
    new EmbedCheckoutGuardHelper(checkout),
    checkout,
    merchantRepo as never,
    { platformFeeBrl: 1.99 },
    { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as never
  );

  const response = await controller.apply(
    { embedClaims },
    {
      session_id: sessionId,
      merchant_id: "m_body",
      code: " PROMO10 ",
      cart: { currency: "BRL", total: 1, items: [{ sku: "forged-sku", name: "Carrinho forjado", price: 1, quantity: 1 }] }
    }
  );

  assert.equal(seen?.merchant_id, "m_token");
  assert.equal(seen?.code, "PROMO10");
  assert.equal(seen?.source, "manual");
  assert.deepEqual(seen?.cart, persisted.cart);
  assert.equal(response.experience.totals.discount, 10);
  assert.equal((await checkout.getSession("m_token", sessionId))?.cart.currentDiscount, 10);
});

test("WidgetCouponsController derives the coupon buyer from the persisted session", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const now = Math.floor(Date.now() / 1000);
  const tokens = new EmbedTokenService({ value: Buffer.from("embed-coupon-spec-secret-32chars!!") });
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 900,
      nonce: "coupon-buyer"
    })
  );
  const sessionId = embedCheckoutSessionId(embedClaims);
  checkout.saveSession(checkoutSession({ merchantId: "m_token", sessionId, globalUserId: "usr_persisted_buyer" }));

  let seen: Record<string, unknown> | undefined;
  const controller = new WidgetCouponsController(
    { async execute(input: Record<string, unknown>) { seen = input; return { redemption_id: "red_1", discount_applied: 10, coupon: { code: "PROMO10" } }; } } as never,
    new EmbedCheckoutGuardHelper(checkout),
    checkout,
    merchantRepo as never,
    { platformFeeBrl: 1.99 },
    { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as never
  );

  await controller.apply(
    { embedClaims },
    {
      session_id: sessionId,
      merchant_id: "m_token",
      code: "PROMO10",
      cart: { currency: "BRL", total: 250, items: [] },
      buyer_global_user_id: "usr_forged_buyer"
    }
  );

  assert.equal(seen?.buyer_global_user_id, "usr_persisted_buyer");
});

test("WidgetCouponsController does not accept a buyer id from the widget for a legacy session", async () => {
  const checkout = new InMemoryCheckoutRepository();
  const now = Math.floor(Date.now() / 1000);
  const tokens = new EmbedTokenService({ value: Buffer.from("embed-coupon-spec-secret-32chars!!") });
  const embedClaims = tokens.verify(
    tokens.sign({
      typ: "aacp_embed_v1",
      merchantId: "m_token",
      issuedAtUnix: now,
      expiresAtUnix: now + 900,
      nonce: "coupon-no-buyer"
    })
  );
  const sessionId = embedCheckoutSessionId(embedClaims);
  const session = checkoutSession({ merchantId: "m_token", sessionId });
  delete (session as { globalUserId?: string }).globalUserId;
  checkout.saveSession(session);

  let seen: Record<string, unknown> | undefined;
  const controller = new WidgetCouponsController(
    { async execute(input: Record<string, unknown>) { seen = input; return { redemption_id: "red_1", discount_applied: 10, coupon: { code: "PROMO10" } }; } } as never,
    new EmbedCheckoutGuardHelper(checkout),
    checkout,
    merchantRepo as never,
    { platformFeeBrl: 1.99 },
    { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as never
  );

  await controller.apply(
    { embedClaims },
    {
      session_id: sessionId,
      merchant_id: "m_token",
      code: "PROMO10",
      cart: { currency: "BRL", total: 250, items: [] },
      buyer_global_user_id: "usr_forged_buyer"
    }
  );

  assert.equal(seen?.buyer_global_user_id, undefined);
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
    new EmbedCheckoutGuardHelper(checkout),
    checkout,
    merchantRepo as never,
    { platformFeeBrl: 1.99 },
    { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as never
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
