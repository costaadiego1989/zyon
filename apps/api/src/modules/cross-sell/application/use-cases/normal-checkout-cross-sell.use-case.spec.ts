import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { DEFAULT_MERCHANT_RULES, DEFAULT_MERCHANT_THEME, type CheckoutSession } from "@zyon/shared-types";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";
import type { NormalCheckoutCrossSellPort } from "../../domain/ports/normal-checkout-cross-sell.port.js";
import { NormalCheckoutCrossSellUseCase } from "./normal-checkout-cross-sell.use-case.js";

const scope = { merchantId: "merchant", sessionId: "session" };
const quote = () => normalCheckoutCrossSellQuoteSchema.parse({ version: 1, ...scope, suggestionId: "suggestion", sessionVersion: 7,
  contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: scope.merchantId,
    items: [{ variantId: "base", productId: "base-product", sku: "BASE", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
      { variantId: "target", productId: "target-product", sku: "TARGET", quantity: 1, baseUnitPriceCents: 5000, unitPriceCents: 4500,
        selectedOptions: [{ groupId: "group", groupName: "Extra", itemId: "option", itemName: "Large", priceModifierInCents: 500 }] }],
    originalSubtotalCents: 15000, preservedSavingsCents: 0, allocatedSavingsCents: 500, promotionDiscountCents: 500,
    cartDiscountCents: 1000, merchandiseSubtotalCents: 14500, payableMerchandiseCents: 13500, remainingDiscountCents: 1500,
    targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T00:00:00Z", acceptedQuantity: 1,
      originalUnitPriceCents: 5000, maximumUnitPriceCents: 4500, selectedOptionItemIds: ["option"], variantId: "target",
      productId: "target-product", sku: "TARGET", source: "cross_sell" }] } });
const request = () => ({ suggestion_id: "suggestion", accepted_skus: ["TARGET"], expected_quote: quote() });
function fixture() {
  const calls: string[] = [];
  let quoted = quote();
  const ack = { version: 1 as const, status: "accepted" as const, ...scope, suggestionId: "suggestion", persistenceVersion: 8,
    quoteHash: createHash("sha256").update(JSON.stringify(quoted)).digest("hex") };
  let acknowledgement: unknown = ack;
  let failure: Error | undefined, readFailure: Error | undefined, policyFailure: Error | undefined;
  const session: CheckoutSession = { ...scope, globalUserId: "buyer", conversationId: "conversation", persistenceVersion: 8,
    cart: { currency: "BRL", total: 145, currentDiscount: 10, items: [
      { sku: "BASE", variantId: "base", product_id: "base-product", name: "Base", quantity: 1, price: 100, variant: JSON.stringify(["base", []]) },
      { sku: "TARGET", variantId: "target", product_id: "target-product", name: "Target", quantity: 1, price: 45, originalPrice: 50,
        variant: JSON.stringify(["target", ["option"]]), selected_options: [{ group_name: "Extra", item_name: "Large", price_modifier: 5 }] },
    ] }, abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
  const port: NormalCheckoutCrossSellPort = { async quote(actualScope, selection) { calls.push("quote"); assert.deepEqual(actualScope, scope);
    assert.equal(selection.suggestion_id, "suggestion"); return quoted; },
    async accept(actualScope, input) { calls.push("accept"); assert.deepEqual(actualScope, scope); assert.deepEqual(input, request());
      if (failure) throw failure; return acknowledgement as typeof ack; },
    async read(actualScope) { calls.push("read"); assert.deepEqual(actualScope, scope); if (readFailure) throw readFailure; return session; },
    async updateCart() { assert.fail("no post-commit mutation"); }, async prepareBenefits() { assert.fail("no post-commit benefit mutation"); },
    async applyOffer() { assert.fail("no post-commit offer mutation"); } };
  const merchants = { async getProfile(merchantId: string) { calls.push("profile"); assert.equal(merchantId, scope.merchantId); return { id: merchantId, name: "Store" }; },
    async getExistingRules() { calls.push("policy"); if (policyFailure) throw policyFailure; return DEFAULT_MERCHANT_RULES; } };
  const useCase = new NormalCheckoutCrossSellUseCase(port, merchants);
  return { useCase, calls, session, ack, merchants,
    setAck(value: unknown) { acknowledgement = value; }, setQuote(value: typeof quoted) { quoted = value; },
    failWriter(error: Error) { failure = error; }, failRead() { readFailure = new Error("projection_sensitive_failure"); },
    failPolicy() { policyFailure = new Error("policy_sensitive_failure"); } };
}
test("normal public projection preserves canonical digital/service types without exposing metadata", async () => {
  const f = fixture(); f.session.cart.items[0]!.productType = "digital"; f.session.cart.items[0]!.fulfillmentStrategy = "digital";
  f.session.cart.items[1]!.productType = "service"; f.session.cart.items[1]!.fulfillmentStrategy = "service";
  const result = await f.useCase.accept(scope, request()); assert.equal(result.projection_status, "available");
  if (result.projection_status !== "available") assert.fail("projection missing");
  assert.equal(result.cart.items[0]!.productType, "digital"); assert.equal(result.cart.items[0]!.fulfillmentStrategy, "digital");
  assert.equal(result.cart.items[1]!.productType, "service"); assert.equal(result.cart.items[1]!.fulfillmentStrategy, "service");
});

test("quote delegates parsed targets once without a cart mutation", async () => {
  const f = fixture(); assert.deepEqual(await f.useCase.quote(scope, { suggestion_id: "suggestion", targets: [{ sku: "TARGET", variant_id: "target", quantity: 1, selected_option_item_ids: ["option"] }] }), quote());
  assert.deepEqual(f.calls, ["quote"]);
});
test("quote does not present different options than the explicit requested selection", async () => {
  const f = fixture();
  await assert.rejects(f.useCase.quote(scope, { suggestion_id: "suggestion", targets: [{ sku: "TARGET", variant_id: "target", quantity: 1 }] }));
  assert.deepEqual(f.calls, ["quote"]);
});
test("quote rejects mismatched server response scope", async () => {
  const f = fixture(); f.setQuote({ ...quote(), sessionId: "other" });
  await assert.rejects(f.useCase.quote(scope, { suggestion_id: "suggestion", targets: [{ sku: "TARGET", variant_id: "target", quantity: 1 }] }));
});
test("accept writer runs once before canonical read and produces consistent public experience", async () => {
  const f = fixture(), result = await f.useCase.accept(scope, request());
  assert.equal(result.projection_status, "available"); assert.deepEqual(result.acknowledgement, f.ack);
  if (result.projection_status !== "available") assert.fail("projection missing");
  assert.equal(result.cart.total, 145); assert.equal(result.cart.currentDiscount, 10);
  assert.equal(result.experience.totals.total, 135); assert.equal(result.experience.totals.total_to_pay, 135.99);
  assert.deepEqual(f.calls, ["accept", "read", "profile", "policy"]);
});
for (const method of ["failRead", "failPolicy"] as const) test(`${method} after commit returns review with ACK, no accept replay`, async () => {
  const f = fixture(); f[method](); assert.deepEqual(await f.useCase.accept(scope, request()), { acknowledgement: f.ack, projection_status: "requires_review" });
  assert.equal(f.calls.filter(value => value === "accept").length, 1);
});
test("writer error identity is not swallowed as projection review", async () => {
  const f = fixture(), fault = new Error("unknown_commit_outcome"); f.failWriter(fault);
  await assert.rejects(f.useCase.accept(scope, request()), error => error === fault); assert.deepEqual(f.calls, ["accept"]);
});
for (const patch of [{ merchantId: "other" }, { sessionId: "other" }, { suggestionId: "other" },
  { persistenceVersion: 7 }, { persistenceVersion: 9 }, { quoteHash: "c".repeat(64) }, { status: "pending" }, { creation: "private" }]) {
  test(`invalid ACK ${Object.keys(patch)[0]} stops projection and does not replay`, async () => {
    const f = fixture(); f.setAck({ ...f.ack, ...patch }); await assert.rejects(f.useCase.accept(scope, request()));
    assert.deepEqual(f.calls, ["accept"]);
  });
}
for (const change of ["money", "discount", "identity", "quantity", "original", "option", "scope", "version"] as const) {
  test(`postcommit ${change} mismatch requires canonical review, not another mutation`, async () => {
    const f = fixture(), item = f.session.cart.items[1]!;
    if (change === "money") item.price = 44;
    if (change === "discount") f.session.cart.currentDiscount = 11;
    if (change === "identity") item.product_id = "wrong";
    if (change === "quantity") item.quantity = 2;
    if (change === "original") item.originalPrice = 51;
    if (change === "option") item.variant = JSON.stringify(["target", ["other"]]);
    if (change === "scope") f.session.merchantId = "other";
    if (change === "version") f.session.persistenceVersion = 9;
    assert.deepEqual(await f.useCase.accept(scope, request()), { acknowledgement: f.ack, projection_status: "requires_review" });
    assert.equal(f.calls.filter(value => value === "accept").length, 1);
  });
}
test("public cart/customer/shipping whitelist strips nested private canaries without changing money", async () => {
  const f = fixture();
  Object.assign(f.session.cart, { cost: "PRIVATE", _storefrontCouponBinding: { token: "PRIVATE" }, provider: "PRIVATE", discountBudget: { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 500 } });
  Object.assign(f.session.cart.items[1]!, { cost: 987654, crossSellIntent: { secret: "PRIVATE" }, creation: "PRIVATE" });
  f.session.customer = { fullName: "Buyer", otp_code: "PRIVATE", phone_otp_code: "PRIVATE", asaasCustomerId: "PRIVATE", email: "test@example.invalid", address: { city: "City" } };
  Object.assign(f.session.customer.address!, { provider: "PRIVATE" });
  f.session.shipping = { customerPrice: 0, realCost: 987654, carrier: "Carrier" };
  Object.assign(f.session.shipping, { creation: "PRIVATE" });
  Object.assign(f.session.cart.items[1]!.selected_options![0]!, { creation: "PRIVATE" });
  f.merchants.getProfile = async merchantId => ({ id: merchantId, name: "Store",
    theme: Object.assign({ ...DEFAULT_MERCHANT_THEME }, { secret: "PRIVATE" }) });
  f.merchants.getExistingRules = async () => ({ ...DEFAULT_MERCHANT_RULES,
    policies: Object.assign({ privacyUrl: "https://example.invalid/privacy" }, { secret: "PRIVATE" }),
    cryptoPayments: { enabled: true, chain: "base", network: "testnet", treasuryAddress: "PRIVATE", token: "USDC", quoteTtlSeconds: 60 } });
  const result = await f.useCase.accept(scope, request()); assert.equal(result.projection_status, "available");
  const json = JSON.stringify(result); assert.ok(!json.includes("PRIVATE")); assert.ok(!json.includes("987654"));
  for (const key of ["_storefrontCouponBinding", "crossSellIntent", "discountBudget", "realCost", "otp_code", "asaasCustomerId"]) assert.ok(!json.includes(key), key);
});
test("missing ACK never becomes a projection success", async () => {
  const f = fixture(); f.setAck(null); await assert.rejects(f.useCase.accept(scope, request())); assert.deepEqual(f.calls, ["accept"]);
});
test("foreign quote scope is rejected before the writer", async () => {
  const f = fixture(); await assert.rejects(f.useCase.accept({ ...scope, merchantId: "foreign" }, request())); assert.deepEqual(f.calls, []);
});
