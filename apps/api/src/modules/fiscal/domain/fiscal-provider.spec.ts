import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFiscalIdentity,
  createFiscalReference,
  fiscalProviderCapabilities,
  listFiscalProviders,
  type FiscalIdentity,
} from "./fiscal-provider.js";

const identity: FiscalIdentity = {
  merchantId: "seller_a", connectionId: "connection_a", provider: "focus",
  environment: "homologation", issuerTaxId: "12ABC34501DE35", reference: "sale_a",
};

test("fiscal provider selection lists all four documented goods issuers", () => {
  assert.deepEqual(listFiscalProviders().map(value => [value.id, value.label]), [
    ["bling", "Bling"], ["omie", "Omie"], ["tiny", "Tiny/Olist"], ["focus", "Focus NF-e"],
  ]);
});

test("Bling exposes ERP-panel cancellation instead of an invented fiscal API", () => {
  const value = fiscalProviderCapabilities("bling");
  assert.equal(value.cancellation, "erp_panel");
  assert.equal(value.issuance, "generate_then_submit");
  assert.equal(value.environmentSelection, "erp_configuration");
  assert.deepEqual(value.documents, ["xml", "danfe"]);
});

test("Omie billing and Olist generation retain their documented fiscal operations", () => {
  assert.equal(fiscalProviderCapabilities("omie").issuance, "validate_then_bill");
  assert.equal(fiscalProviderCapabilities("tiny").issuance, "generate_then_submit");
  for (const provider of ["omie", "tiny"] as const) {
    assert.equal(fiscalProviderCapabilities(provider).cancellation, "api");
    assert.equal(fiscalProviderCapabilities(provider).environmentSelection, "erp_configuration");
    assert.equal(fiscalProviderCapabilities(provider).webhookAuthentication, "query_only");
  }
});

test("Focus issues directly using an explicit environment and company token", () => {
  const value = fiscalProviderCapabilities("focus");
  assert.equal(value.issuance, "direct");
  assert.equal(value.salesOrder, false);
  assert.equal(value.authentication, "basic_company_token");
  assert.equal(value.environmentSelection, "base_url");
  assert.equal(value.webhookAuthentication, "configured_header");
});

test("capabilities cannot be mutated by a client serving another merchant", () => {
  const value = fiscalProviderCapabilities("bling");
  assert.throws(() => { (value as unknown as { cancellation: string }).cancellation = "api"; }, TypeError);
  assert.throws(() => { (value.documents as unknown as string[]).push("preview"); }, TypeError);
  assert.equal(fiscalProviderCapabilities("bling").cancellation, "erp_panel");
});

test("stable sale references survive retries without exposing merchant or order identifiers", () => {
  const input = { merchantId: "seller_a", orderId: "order_private_123", environment: "homologation" as const, operation: "sale" as const };
  const reference = createFiscalReference(input);
  assert.equal(reference, createFiscalReference({ ...input }));
  assert.match(reference, /^zyon-nfe-[a-f0-9]{40}$/);
  assert.equal(reference.includes(input.orderId), false);
  assert.equal(reference.includes(input.merchantId), false);
});

test("merchant, environment and order each produce a separate fiscal reference", () => {
  const input = { merchantId: "seller_a", orderId: "order_a", environment: "homologation" as const, operation: "sale" as const };
  const values = [
    createFiscalReference(input),
    createFiscalReference({ ...input, merchantId: "seller_b" }),
    createFiscalReference({ ...input, orderId: "order_b" }),
    createFiscalReference({ ...input, environment: "production" }),
  ];
  assert.equal(new Set(values).size, 4);
  assert.throws(() => createFiscalReference({ ...input, merchantId: "" }), /fiscal_reference_invalid/);
});

test("provider updates must match the complete original tenant and issuer identity", () => {
  assert.equal(assertFiscalIdentity(identity, { ...identity }), undefined);
  for (const patch of [
    { merchantId: "seller_b" }, { connectionId: "connection_b" }, { provider: "bling" as const },
    { environment: "production" as const }, { issuerTaxId: "12345678000195" }, { reference: "sale_b" },
  ]) assert.throws(() => assertFiscalIdentity(identity, { ...identity, ...patch }), /fiscal_identity_mismatch/);
});
