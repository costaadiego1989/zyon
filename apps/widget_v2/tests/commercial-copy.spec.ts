import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutApiError } from "../src/api/checkout-api-error";
import { checkoutCouponErrorMessage, checkoutPaymentErrorMessage } from "../src/lib/checkout-error-message";
import { checkoutQuickReplies } from "../src/lib/checkout-quick-replies";
import { cartStatusCopy } from "../src/lib/cart-status-copy";

test("coupon refusals help the buyer without exposing raw financial/internal errors", () => {
  for (const [code, copy] of [["COUPON_INVALID: coupon_not_found", /Confira o código/], ["COUPON_DISCOUNT_REJECTED: product_cost_missing", /não se aplica/], ["coupon_expired", /expirou/], ["coupon_min_cart_value", /valor mínimo/]]) {
    const result = checkoutCouponErrorMessage(new Error(code));
    assert.match(result, copy as RegExp); assert.equal(result.includes(code as string), false); assert.equal(result.includes("cost"), false);
  }
  assert.match(checkoutCouponErrorMessage(new CheckoutApiError("coupon", 429, "rate_limited")), /instantes/);
  assert.equal(checkoutCouponErrorMessage(new Error("private backend stack and token" )).includes("private"), false);
});
test("a non-shipping status never claims that physical freight has been confirmed", () => {
  assert.equal(cartStatusCopy("shipping_calculated", false), "Pedido revisado");
  assert.equal(cartStatusCopy("shipping_calculated", true), "Frete confirmado");
  assert.equal(cartStatusCopy("ready_to_pay", false), "Pronto para pagar");
});
test("payment stock refusals retain the server code and give actionable copy without exposing a SKU", async () => {
  const error = await CheckoutApiError.fromResponse("embed_payment", new Response(JSON.stringify({ message: "cart_insufficient_stock", sku: "INTERNAL-SKU", availableQuantity: 0 }), { status: 409 }));
  assert.equal(error.code, "cart_insufficient_stock");
  assert.match(checkoutPaymentErrorMessage(error), /reduza a quantidade/);
  assert.equal(checkoutPaymentErrorMessage(error).includes("INTERNAL-SKU"), false);
  assert.match(checkoutPaymentErrorMessage(new CheckoutApiError("payment", 409, "cart_product_unavailable")), /Remova ou troque/);
  const unknown = await CheckoutApiError.fromResponse("payment", new Response(JSON.stringify({ message: "private stack and customer data" }), { status: 500 }));
  assert.equal(unknown.code, undefined); assert.equal(checkoutPaymentErrorMessage(unknown).includes("private"), false);
});
test("payment blocks remove duplicate method replies while preserving other navigation", () => {
  const replies = ["Pix", "Pagar com PIX", "Cartão de crédito", "Crédito", "Voltar", "Aplicar cupom", "Boleto"];
  const blocks = [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Crédito" }, { key: "boleto", label: "Boleto" }] } }];
  assert.deepEqual(checkoutQuickReplies(replies, blocks, ["pix", "credito"]), ["Voltar", "Aplicar cupom", "Boleto"]);
  assert.deepEqual(checkoutQuickReplies(replies, [], ["pix", "credito"]), replies);
  assert.ok(checkoutQuickReplies(replies, blocks, ["pix"]).includes("Cartão de crédito"), "do not remove a method that is not rendered");
});
