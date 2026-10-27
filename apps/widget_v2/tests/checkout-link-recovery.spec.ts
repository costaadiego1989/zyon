import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutApiError } from "../src/api/checkout-api-error";
import { CHECKOUT_LINK_EXPIRED_MESSAGE, checkoutStartErrorMessage } from "../src/lib/checkout-error-message";

test("expired checkout links explain how to request a fresh link instead of repeating a failed retry", async () => {
  const error = await CheckoutApiError.fromResponse("embed_start", new Response(JSON.stringify({ message: "embed_session_token_expired" }), { status: 401 }));
  assert.equal(checkoutStartErrorMessage(error), CHECKOUT_LINK_EXPIRED_MESSAGE);
  assert.match(checkoutStartErrorMessage(error), /Finalizar pedido/);
  assert.doesNotMatch(checkoutStartErrorMessage(error), /Tente novamente em instantes/);
  assert.match(checkoutStartErrorMessage(new CheckoutApiError("embed_start", 401, "invalid_embed_session_token")), /Volte à loja/);
});
