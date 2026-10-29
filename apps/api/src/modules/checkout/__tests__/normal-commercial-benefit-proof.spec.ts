import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MERCHANT_RULES, type CheckoutSession } from "@zyon/shared-types";
import { assertNormalCommercialGrantBasis, createNormalPolicyBenefitAuthorization, NormalCommercialBenefitReviewRequired,
  normalCommercialRulesForMatching, type NormalCommercialPolicyContext } from "../domain/services/normal-commercial-benefit-proof.js";
function context(): NormalCommercialPolicyContext {
  const session: CheckoutSession = { merchantId: "merchant", sessionId: "session", globalUserId: "buyer", conversationId: "conversation",
    persistenceVersion: 2, cart: { currency: "BRL", total: 135, currentDiscount: 0,
      discountBudget: { version: 1, originalSubtotalCents: 15000, promotionDiscountCents: 1500 },
      items: [{ sku: "SKU", variantId: "variant", product_id: "product", name: "Canonical", quantity: 1, price: 135, originalPrice: 150,
        variant: JSON.stringify(["variant", []]) }] }, abandonmentScore: 0, triggerAgent: false, chatHistory: [], createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
  return { session, rules: { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 20, allowFreeShipping: false }, advancedRules: [], method: "pix",
    progressivePolicy: { enabled: true, stages: { initial_coupon: 5, exit_intent: 5, abandoned_cart: 10, payment_nudge: 15 } },
    events: [{ id: "stage", eventName: "payment_method_selected" }], settingsHash: "a".repeat(64) };
}
test("explicit preparation shares P0+A+D ceiling and stores original approved basis once", () => {
  const input = context(), before = structuredClone(input.session), grant = createNormalPolicyBenefitAuthorization(input)!;
  assert.equal(grant.discountCents, 1500); assert.equal(grant.basis.originalSubtotalCents, 15000);
  assert.equal(grant.basis.promotionDiscountCents + grant.discountCents, 3000);
  assert.equal(grant.origin, "progressive"); assert.deepEqual(input.session, before);
});
test("uncompleted stages and disabled/coupon-only policies do not manufacture a grant", () => {
  const input = context(); input.events = [{ id: "start", eventName: "checkout_started" }];
  assert.equal(createNormalPolicyBenefitAuthorization(input), undefined);
  input.events = [{ id: "stage", eventName: "payment_method_selected" }]; input.progressivePolicy!.mode = "coupon_only";
  assert.equal(createNormalPolicyBenefitAuthorization(input), undefined);
});
test("advanced rule method/product conditions precede generic progressive policy without rejecting configuration", () => {
  const input = context(); input.progressivePolicy!.enabled = false;
  input.advancedRules = [{ id: "rule", enabled: true, priority: 1, conditions: [{ field: "product_in_cart", operator: "contains", value: "SKU" },
    { field: "payment_method", operator: "is", value: "card" }], action: { type: "offer_discount", params: { percent: 10, maxDiscountReais: 7 } } }];
  assert.equal(createNormalPolicyBenefitAuthorization(input), undefined); input.method = "card";
  const grant = createNormalPolicyBenefitAuthorization(input)!; assert.equal(grant.discountCents, 700); assert.equal(grant.origin, "advanced_rule");
});

for (const operator of ["is", "eq", "=="]) for (const alias of ["card", "credit_card"]) {
  test(`normal card matches exact merchant alias ${alias} with ${operator} without changing raw rules`, () => {
    const input = context(); input.progressivePolicy!.enabled = false; input.method = "card";
    input.advancedRules = [{ id: "card-rule", enabled: true, priority: 1,
      conditions: [{ field: "payment_method", operator, value: alias }],
      action: { type: "offer_discount", params: { percent: 90 } } }];
    const before = structuredClone(input.advancedRules), grant = createNormalPolicyBenefitAuthorization(input)!;
    assert.equal(grant.discountCents, 1500); assert.equal(grant.basis.promotionDiscountCents + grant.discountCents, 3000);
    assert.equal(grant.paymentMethod, "card"); assert.equal(grant.ruleId, "card-rule");
    assert.deepEqual(input.advancedRules, before);
  });
}
for (const selected of ["pix", "boleto"] as const) for (const alias of ["card", "credit_card"]) {
  test(`card alias ${alias} never qualifies ${selected}`, () => {
    const input = context(); input.progressivePolicy!.enabled = false; input.method = selected;
    input.advancedRules = [{ enabled: true, priority: 1, conditions: [{ field: "payment_method", operator: "is", value: alias }],
      action: { type: "offer_discount", params: { percent: 10 } } }];
    assert.equal(createNormalPolicyBenefitAuthorization(input), undefined);
  });
}
test("normal card alias preserves first-match priority instead of evaluating/granting twice", () => {
  const input = context(); input.progressivePolicy!.enabled = false; input.method = "card";
  input.advancedRules = [{ id: "later", enabled: true, priority: 2, conditions: [{ field: "payment_method", operator: "is", value: "card" }],
    action: { type: "offer_discount", params: { percent: 15 } } },
  { id: "first", enabled: true, priority: 1, conditions: [{ field: "payment_method", operator: "is", value: "credit_card" }],
    action: { type: "offer_discount", params: { percent: 5 } } }];
  const grant = createNormalPolicyBenefitAuthorization(input)!;
  assert.equal(grant.ruleId, "first"); assert.equal(grant.discountCents, 675);
});
for (const value of [" credit_card", "CREDIT_CARD", "credit_card_suffix"]) test(`non-exact card spelling ${value} stays unmatched`, () => {
  const input = context(); input.progressivePolicy!.enabled = false; input.method = "card";
  input.advancedRules = [{ enabled: true, priority: 1, conditions: [{ field: "payment_method", operator: "is", value }],
    action: { type: "offer_discount", params: { percent: 10 } } }];
  assert.equal(createNormalPolicyBenefitAuthorization(input), undefined);
});
test("card alias does not normalize product/category strings or unsupported operators", () => {
  for (const condition of [{ field: "product_in_cart", operator: "contains", value: "credit_card" },
    { field: "payment_method", operator: "contains", value: ["credit_card", "card"] },
    { field: "payment_method", operator: "not", value: "credit_card" }]) {
    const input = context(); input.progressivePolicy!.enabled = false; input.method = "card";
    input.advancedRules = [{ enabled: true, priority: 1, conditions: [condition], action: { type: "offer_discount", params: { percent: 10 } } }];
    const before = structuredClone(input.advancedRules);
    assert.equal(createNormalPolicyBenefitAuthorization(input), undefined); assert.deepEqual(input.advancedRules, before);
  }
});
test("normal matching projection clones exact method aliases only, including array values, without rewriting raw configuration", () => {
  const input = context(); input.advancedRules = [{ enabled: true, priority: 1, conditions: [
    { field: "payment_method", operator: "contains", value: ["credit_card", "card", "pix", "CREDIT_CARD"] },
    { field: "category_in_cart", operator: "contains", value: ["credit_card", "card"] },
    { field: "cart_total", operator: "eq", value: 135 },
  ], action: { type: "offer_discount", params: { percent: 10 } } }];
  const before = structuredClone(input.advancedRules), projected = normalCommercialRulesForMatching(input.advancedRules);
  assert.deepEqual(projected[0]!.conditions.map(condition => condition.value), [
    ["card", "card", "pix", "CREDIT_CARD"], ["credit_card", "card"], 135,
  ]);
  assert.notEqual(projected[0]!.conditions, input.advancedRules[0]!.conditions);
  assert.deepEqual(input.advancedRules, before);
});
test("cost and obsolete margin are not read to authorize or block a normal grant", () => {
  const input = context(); Object.defineProperty(input.session.cart.items[0]!, "cost", { get() { assert.fail("cost must not gate grant"); } });
  input.rules.minimumMarginPercent = Number.NaN;
  assert.equal(createNormalPolicyBenefitAuthorization(input)!.discountCents, 1500);
});
test("quote/read preservation keeps fixed original D after a new line and does not grant a percentage on new units", () => {
  const input = context(), grant = createNormalPolicyBenefitAuthorization(input)!, cart = structuredClone(input.session.cart);
  cart.currentDiscount = grant.discountCents / 100;
  cart.items.push({ sku: "NEW", variantId: "new", product_id: "new-product", name: "New", quantity: 1, price: 50 });
  cart.total += 50; cart.discountBudget!.originalSubtotalCents += 5000;
  const proof = assertNormalCommercialGrantBasis(cart, grant, input.rules);
  assert.equal(proof.grant.discountCents, 1500); assert.equal(proof.approvedCart.total, 135);
  assert.equal(cart.currentDiscount, 15);
});
test("additional units do not enlarge the grant's original approved quantity or fixed D", () => {
  const input = context(), grant = createNormalPolicyBenefitAuthorization(input)!, cart = structuredClone(input.session.cart);
  cart.currentDiscount = 15; cart.items[0]!.quantity = 2; cart.total *= 2;
  cart.discountBudget!.originalSubtotalCents *= 2; cart.discountBudget!.promotionDiscountCents *= 2;
  const proof = assertNormalCommercialGrantBasis(cart, grant, input.rules);
  assert.equal(proof.approvedCart.items[0]!.quantity, 1); assert.equal(proof.approvedCart.total, 135);
  assert.equal(proof.grant.discountCents, 1500);
});
test("original approved subset retains category from the current trusted canonical projection", () => {
  const input = context(); input.progressivePolicy!.enabled = false; input.session.cart.items[0]!.category = "canonical-category";
  input.advancedRules = [{id:"category-rule",enabled:true,priority:1,conditions:[{field:"category_in_cart",operator:"contains",value:"canonical-category"}],
    action:{type:"offer_discount",params:{percent:10}}}];
  const grant = createNormalPolicyBenefitAuthorization(input)!; input.session.cart.currentDiscount = grant.discountCents / 100;
  const {approvedCart} = assertNormalCommercialGrantBasis(input.session.cart, grant, input.rules);
  assert.equal(approvedCart.items[0]!.category, "canonical-category");
  assert.equal(createNormalPolicyBenefitAuthorization({...input,session:{...input.session,cart:approvedCart}})!.discountCents, grant.discountCents);
});
for (const reason of ["changed saved unit", "forged D", "lowered company cap", "removed approved basis"] as const) test(`existing grant rejects ${reason} rather than repricing/regranting`, () => {
  const input = context(), grant = createNormalPolicyBenefitAuthorization(input)!, cart = structuredClone(input.session.cart);
  cart.currentDiscount = 15;
  if (reason === "changed saved unit") { cart.items[0]!.price -= 1; cart.total -= 1; cart.discountBudget!.promotionDiscountCents += 100; }
  if (reason === "forged D") cart.currentDiscount = 14;
  if (reason === "lowered company cap") input.rules.maxDiscountPercent = 10;
  if (reason === "removed approved basis") { cart.items[0]!.variantId = "different"; cart.items[0]!.variant = JSON.stringify(["different", []]); }
  assert.throws(() => assertNormalCommercialGrantBasis(cart, grant, input.rules), NormalCommercialBenefitReviewRequired);
});
