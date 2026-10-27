import assert from "node:assert/strict";
import test from "node:test";
import { checkoutPolicyLinks, publicPolicyUrl, resolveStorePolicies } from "./store-policies.js";

test("saved text and explicit removals take precedence over older policy sources", () => {
  assert.deepEqual(resolveStorePolicies({ policies: { returns: " Nova regra ", shipping: "" } }, { returns: "Antiga", shipping: "2 a 10 dias", warranty: "Garantia informada pelo fornecedor" }, { shippingUrl: "https://old.example/shipping" }), {
    returns: "Nova regra", warranty: "Garantia informada pelo fornecedor",
  });
});

test("unconfigured stores have no invented conditions", () => {
  assert.deepEqual(resolveStorePolicies(null), {});
});

test("persisted checkout URLs are published while edited store text remains authoritative", () => {
  const settings = { checkoutPolicyLinks: { privacyUrl: "https://supplier.example/privacy", shippingUrl: "https://supplier.example/shipping" }, policies: { shipping: "Condições vigentes" } };
  assert.deepEqual(resolveStorePolicies(settings), { privacy: "https://supplier.example/privacy", shipping: "Condições vigentes" });
  assert.deepEqual(checkoutPolicyLinks(settings, undefined, "https://store.example"), { privacyUrl: "https://supplier.example/privacy" });
});

test("legal links accept only HTTP documents without embedded credentials", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,a", "https://user:password@example.com", "/terms", "invalid"]) assert.equal(publicPolicyUrl(value), undefined);
  assert.equal(publicPolicyUrl("https://store.example/terms"), "https://store.example/terms");
});

test("checkout routes saved texts to the store, retains external URLs and removes cleared links", () => {
  assert.deepEqual(checkoutPolicyLinks({ slug: "loja teste", policies: { returns: "Texto vigente", shipping: "", terms: "https://terms.example" } }, { shippingUrl: "https://old.example", privacyUrl: "https://privacy.example" }, "https://sandbox.example/old?tracking=1"), {
    privacyUrl: "https://privacy.example/", termsUrl: "https://terms.example/", refundUrl: "https://sandbox.example/store/loja%20teste/politicas#returns",
  });
});

test("checkout-only stores never receive a broken route for an unpublished storefront", () => {
  assert.deepEqual(checkoutPolicyLinks({ policies: { returns: "Texto" } }, {}, "https://store.example"), {});
});
