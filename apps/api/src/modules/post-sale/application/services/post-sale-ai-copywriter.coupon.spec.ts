import test from "node:test";
import assert from "node:assert/strict";
import { PostSaleAiCopywriterService } from "./post-sale-ai-copywriter.service.js";

// No template repo → falls back to the platform default templates, which is
// exactly what the scheduled-message processor uses in the common case.
function makeService() {
  return new PostSaleAiCopywriterService();
}

test("loyalty message surfaces the coupon code + discount", async () => {
  const svc = makeService();
  const msg = await svc.generate({
    type: "loyalty",
    buyerName: "Ana",
    productName: "seu pedido",
    merchantId: "m1",
    buyerId: "b1",
    storeName: "Loja Teste",
    couponCode: "LYAB1234",
    discountPercent: 10,
    expiresAt: "2026-12-31T00:00:00.000Z",
  });
  assert.match(msg, /LYAB1234/, "coupon code present");
  assert.match(msg, /10% OFF/, "discount present");
  assert.match(msg, /Válido até/, "expiry line present");
  assert.doesNotMatch(msg, /\{\{/, "no unresolved placeholders");
  assert.doesNotMatch(msg, /Confira:\s*$/m, "no dangling label");
});

test("win-back message includes free shipping when granted", async () => {
  const svc = makeService();
  const msg = await svc.generate({
    type: "win_back",
    buyerName: "Bruno",
    productName: "seu pedido",
    merchantId: "m1",
    buyerId: "b1",
    couponCode: "WBXYЗ999".replace("З", "Z"),
    discountPercent: 15,
    freeShipping: true,
  });
  assert.match(msg, /frete grátis/i);
  assert.match(msg, /15% OFF/);
});

test("no coupon → no dead link, no dangling coupon block", async () => {
  const svc = makeService();
  const msg = await svc.generate({
    type: "loyalty",
    buyerName: "Carla",
    productName: "seu pedido",
    merchantId: "m1",
    buyerId: "b1",
  });
  assert.doesNotMatch(msg, /#/, "no leftover dead-link hash");
  assert.doesNotMatch(msg, /\{\{/, "no unresolved placeholders");
  assert.doesNotMatch(msg, /🎟️/, "no empty coupon block");
  assert.match(msg, /Carla/, "still personalized");
});

test("cross_sell renders link when provided", async () => {
  const svc = makeService();
  const msg = await svc.generate({
    type: "cross_sell",
    buyerName: "Dora",
    productName: "Teclado",
    merchantId: "m1",
    buyerId: "b1",
    couponCode: "CS10PCT",
    discountPercent: 10,
    link: "https://loja.example/promo",
  });
  assert.match(msg, /https:\/\/loja\.example\/promo/);
  assert.match(msg, /CS10PCT/);
});

test("follow_up (no coupon type) never shows a coupon block", async () => {
  const svc = makeService();
  const msg = await svc.generate({
    type: "follow_up",
    buyerName: "Eve",
    productName: "Mouse",
    merchantId: "m1",
    buyerId: "b1",
  });
  assert.doesNotMatch(msg, /🎟️/);
  assert.doesNotMatch(msg, /\{\{/);
  assert.match(msg, /Mouse/);
});
