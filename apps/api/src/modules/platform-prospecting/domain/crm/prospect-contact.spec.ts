import assert from "node:assert/strict";
import { test } from "node:test";
import { contactPermission, normalizeContactIdentity, resolveContactAttribution, sequenceIdentity } from "./prospect-contact.js";

test("PROS-09 AC1 normalizes actual phones including DDD55 and shares one sender sequence without merging companies", () => {
  const phone = normalizeContactIdentity({ kind: "phone", value: "(55) 99999-1234" });
  assert.deepEqual(phone, { kind: "phone", value: "+5555999991234", businessScope: null });
  assert.deepEqual(normalizeContactIdentity({ kind: "phone", value: "+55 55 99999-1234" }), phone);
  assert.equal(sequenceIdentity("zyon", phone), sequenceIdentity("zyon", normalizeContactIdentity({ kind: "phone", value: "5555999991234" })));
  assert.notEqual(sequenceIdentity("zyon", phone), sequenceIdentity("other", phone));
  assert.deepEqual(resolveContactAttribution([{ prospectId: "cnpj-a", confirmed: false }, { prospectId: "cnpj-b", confirmed: false }]), { prospectId: null, ambiguousBindings: ["cnpj-a", "cnpj-b"] });
  assert.deepEqual(resolveContactAttribution([{ prospectId: "cnpj-a", confirmed: true }, { prospectId: "cnpj-b", confirmed: false }]), { prospectId: "cnpj-a", ambiguousBindings: [] });
  assert.throws(() => normalizeContactIdentity({ kind: "phone", value: "BSUID.AbC123" }), /invalid_contact/);
});

test("PROS-09 AC1 preserves case-sensitive opaque BSUID and business scope without a phone", () => {
  const identity = normalizeContactIdentity({ kind: "bsuid", value: "BSUID.AbC_001-X", businessScope: "portfolio-a" });
  assert.deepEqual(identity, { kind: "bsuid", value: "BSUID.AbC_001-X", businessScope: "portfolio-a" });
  assert.notEqual(sequenceIdentity("zyon", identity), sequenceIdentity("zyon", { ...identity, value: "BSUID.abc_001-X" }));
  assert.notEqual(sequenceIdentity("zyon", identity), sequenceIdentity("zyon", { ...identity, businessScope: "portfolio-b" }));
  assert.throws(() => normalizeContactIdentity({ kind: "bsuid", value: "BSUID.AbC" }), /invalid_contact:businessScope/);
  assert.deepEqual(resolveContactAttribution([]), { prospectId: null, ambiguousBindings: [] });
});

test("PROS-09 AC3 authorization stays bound to platform sender endpoint and purpose and never inherits merchant consent", () => {
  const scope = { senderBindingId: "zyon", endpointId: "endpoint", purpose: "zyon_sales" };
  const receipt = { ...scope, source: "zyon_platform", status: "opted_in" as const, evidenceRef: "receipt", occurredAt: new Date("2026-11-01") };
  assert.equal(contactPermission(scope, [receipt]), "opted_in");
  for (const change of [{ source: "merchant_buyer" }, { senderBindingId: "athom" }, { endpointId: "other" }, { purpose: "checkout" }, { evidenceRef: null }]) {
    assert.equal(contactPermission(scope, [{ ...receipt, ...change }]), "no_opt_in");
  }
  assert.equal(contactPermission(scope, [receipt, { ...receipt, status: "revoked", occurredAt: new Date("2026-11-02") }]), "revoked");
  assert.equal(contactPermission(scope, []), "no_opt_in");
});
