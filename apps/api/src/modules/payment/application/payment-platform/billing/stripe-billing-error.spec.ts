import assert from "node:assert/strict";
import test from "node:test";
import { stripeBillingError } from "./stripe-billing-error.js";

test("Stripe billing errors are actionable without provider details", () => {
  const exception = stripeBillingError({
    code: "resource_missing",
    message: "No such price: 'price_private'",
  });

  assert.equal(exception.getStatus(), 503);
  assert.deepEqual(exception.getResponse(), {
    code: "stripe_billing_price_unavailable",
    detail: "O plano escolhido ainda não está disponível para assinatura. Tente novamente em alguns minutos.",
  });
  assert.doesNotMatch(JSON.stringify(exception.getResponse()), /price_private/);
});

test("Stripe billing authentication errors expose a safe remediation code", () => {
  const exception = stripeBillingError({ type: "StripeAuthenticationError" });

  assert.equal(exception.getStatus(), 503);
  assert.deepEqual(exception.getResponse(), {
    code: "stripe_billing_credentials_invalid",
    detail: "A configuração de assinatura da plataforma precisa ser revisada. Tente novamente em alguns minutos.",
  });
});

test("Stripe billing portal errors retain their own safe remediation code", () => {
  const exception = stripeBillingError({ code: "resource_missing" }, "portal");

  assert.equal(exception.getStatus(), 503);
  assert.deepEqual(exception.getResponse(), {
    code: "stripe_billing_portal_unavailable",
    detail: "O gerenciamento da assinatura ainda não está disponível. Tente novamente em alguns minutos.",
  });
});
