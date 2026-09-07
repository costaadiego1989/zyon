import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { AuthorizeStorefrontCartService } from "../../application/authorize-storefront-cart.service.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { EmbedSessionsController } from "./embed-sessions.controller.js";
import { EmbedCheckoutController } from "./embed-checkout.controller.js";
import { CheckoutCartAuthorityService } from "../../../checkout/application/services/checkout-cart-authority.service.js";
import { CartPromoResolutionService } from "../../../checkout/application/services/cart-promo-resolution.service.js";
import { createStartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.fixture.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { UpdateCartUseCase } from "../../../checkout/application/use-cases/update-cart.use-case.js";

const origin = "https://store.example";
const capabilities = new RealtimeCapabilityService("native-checkout-test-secret-32-characters");
const cartAccess = new AuthorizeStorefrontCartService(capabilities);
const proof = () => capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "conv_cart", origin }).token;

function fixture() {
  const stored = {
    merchantId: "merchant", sessionId: "conv_cart", expiresAt: new Date(Date.now() + 3600000), discount: 100,
    items: [
      { variantId: "variant", productId: "product", sku: "sku", name: "Sanduíche", quantity: 1, unitPriceCents: 2000 },
      { variantId: "variant", productId: "product", sku: "sku", name: "Sanduíche com queijo", quantity: 2, unitPriceCents: 2500,
        selectedOptions: [{ groupId: "extras", groupName: "Extras", itemId: "cheese", itemName: "Queijo", priceModifierInCents: 500 }] },
    ],
  };
  const variant = {
    id: "variant", productId: "product", sku: "sku", product: { merchantId: "merchant", name: "Sanduíche", type: "physical",
      metadata: { optionGroups: [{ id: "extras", name: "Extras", selectionType: "multiple", items: [{ id: "cheese", name: "Queijo", priceModifierInCents: 500 }] }] } },
    price: { currency: "BRL", costInCents: 1000 }, stock: [{ quantity: 10, reserved: 0 }],
  };
  const authority = new CheckoutCartAuthorityService({
    storefrontCart: { findUnique: async ({ where }: any) => where.merchantId_sessionId.merchantId === "merchant" && where.merchantId_sessionId.sessionId === "conv_cart" ? stored : null },
    productVariant: { findMany: async () => [variant] },
  } as never, { execute: async () => { throw new Error("native_cart_must_not_call_commerce"); } } as never,
  new CartPromoResolutionService({ findActiveBySku: async () => [{ discountType: "percent", discountValue: 10 }] } as never));
  return { stored, variant, authority };
}

test("native conversation capability issues a cart-bound token without requiring an external installation", async () => {
  const tokens = new EmbedTokenService({ value: Buffer.from("native-embed-test-secret-32-characters") });
  const issuer = new EmbedSessionsController(new IssueEmbedSessionUseCase(tokens), {} as never,
    { getProfile: async () => undefined } as never, undefined, cartAccess);
  const result = await issuer.issueSession({ apiKey: { id: "internal-storefront", merchantId: "merchant", environment: "live" } },
    { cart_ref: "conv_cart", conversation_token: proof(), allowed_origin: origin });
  const claims = tokens.verify(result.embed_session_token);
  assert.equal(claims.storefrontCartRef, "conv_cart");
  assert.equal(claims.cartRef, undefined);
  assert.equal(claims.allowedOrigin, origin);

  const repo = new InMemoryCheckoutRepository();
  const { authority } = fixture();
  const start = createStartCheckoutUseCase(repo, repo, { cartAuthority: authority });
  const controller = new EmbedCheckoutController(start, {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never);
  const response = await controller.start({ embedClaims: claims }, { merchant_id: "victim", cart_ref: "conv_cart",
    cart: { items: [{ sku: "forged", quantity: 99, name: "forged", price: 0.01 }], currency: "USD", total: 0.01 } });
  assert.equal(response.experience.items.length, 2);
  assert.equal(response.experience.items[0]!.unit_price, 18);
  assert.equal(response.experience.items[1]!.unit_price, 22.5);
  assert.equal(response.experience.totals.subtotal, 63);
  assert.equal(response.experience.totals.discount, 1);
  const session = repo.getSession("merchant", response.session_id)!;
  assert.equal((session.cart as any).cart_ref, "conv_cart");
  assert.equal(session.cart.items[1]!.selected_options?.[0]?.item_name, "Queijo");
  assert.notEqual(session.cart.items[0]!.variant, session.cart.items[1]!.variant);

  const update = new UpdateCartUseCase(repo, repo);
  await assert.rejects(update.execute({ merchant_id: "merchant", session_id: response.session_id, items: [{ sku: "sku", quantity: 3 }] }), /update_cart_variant_required/);
  const changed = await update.execute({ merchant_id: "merchant", session_id: response.session_id,
    items: [{ sku: "sku", quantity: 1, variant: session.cart.items[1]!.variant }] } as never);
  assert.deepEqual(changed.experience.items.map(item => item.quantity), [1, 1]);
  assert.equal(changed.experience.totals.subtotal, 40.5);
  assert.equal(changed.experience.totals.discount, 0);
});

test("borrowed, cross-merchant, cross-origin, expired and forged conversation proofs fail closed", () => {
  const input = { token: proof(), merchantId: "merchant", cartRef: "conv_cart", origin };
  for (const patch of [{ cartRef: "victim" }, { merchantId: "victim" }, { origin: "https://evil.example" }, { token: "forged" },
    { token: capabilities.issue({ purpose: "storefront-conversation", merchantId: "merchant", resourceId: "conv_cart", origin }, Math.floor(Date.now() / 1000) - 3601).token }]) {
    assert.throws(() => cartAccess.authorize({ ...input, ...patch }), /public_embed_cart_ownership_required/);
  }
});

test("native cart validates expiry, product availability and combined stock across option selections", async () => {
  const { authority, stored, variant } = fixture();
  await assert.rejects(authority.resolveStorefront("other", "conv_cart"), /checkout_cart_expired/);
  variant.stock[0]!.quantity = 2;
  await assert.rejects(authority.resolveStorefront("merchant", "conv_cart"), /checkout_insufficient_stock/);
  variant.stock[0]!.quantity = 10;
  stored.expiresAt = new Date(0);
  await assert.rejects(authority.resolveStorefront("merchant", "conv_cart"), /checkout_cart_expired/);
});
