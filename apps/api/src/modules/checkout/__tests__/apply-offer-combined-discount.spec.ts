import assert from "node:assert/strict";
import test from "node:test";
import type { AuthorizedOffer, Cart } from "@zyon/shared-types";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import { ApplyOfferUseCase } from "../application/use-cases/apply-offer.use-case.js";
import type { AcceptCheckoutOfferUseCase } from "../application/use-cases/accept-checkout-offer.use-case.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { authorizedOffer, checkoutSession, merchantRules } from "./checkout-test-fixtures.js";

const request = { merchant_id: "mrc_1", session_id: "chk_1", offer_id: "off_1" };
const contextualCart = (promotion = 1500, existing = 0): Cart => ({ currency: "BRL", total: (10000 - promotion) / 100,
  currentDiscount: existing, items: [{ sku: "SKU", name: "Server quotation", quantity: 1, price: (10000 - promotion) / 100, originalPrice: 100, cost: 20 }],
  discountBudget: { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: promotion } });

async function fixture(options: { cart?: Cart; offer?: Partial<AuthorizedOffer>; policy?: unknown; existingPolicy?: unknown; noPolicy?: boolean; failPolicy?: boolean } = {}) {
  const repository = new InMemoryCheckoutRepository();
  await repository.saveSession(checkoutSession({ cart: options.cart ?? contextualCart() }));
  await repository.saveOffer(authorizedOffer({ type: "discount_fixed", value: 5, ...options.offer }));
  const effects = { provider: 0, accept: 0, save: 0, append: 0, policy: 0 };
  const originalSave = repository.saveSession.bind(repository), originalAppend = repository.appendChatTurn.bind(repository);
  repository.saveSession = async (...args) => { effects.save++; return originalSave(...args); };
  repository.appendChatTurn = (...args) => { effects.append++; return originalAppend(...args); };
  const commerce = { async apply() { effects.provider++; return { success: true }; } };
  const accept = { async execute() { effects.accept++; return {}; } } as unknown as AcceptCheckoutOfferUseCase;
  const merchant = { async getProfile(id: string) { assert.equal(id, "mrc_1"); return undefined; },
    async getRules(id: string) { assert.equal(id, "mrc_1"); effects.policy++;
      if (options.failPolicy) throw new Error("private_db_failure");
      return Object.hasOwn(options, "policy") ? options.policy : merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 38 });
    } } as unknown as MerchantRepository;
  if (Object.hasOwn(options, "existingPolicy")) Object.assign(merchant, { async getExistingRules(id: string) {
    assert.equal(id, "mrc_1"); return options.existingPolicy;
  } });
  const useCase = new ApplyOfferUseCase(repository, repository, commerce, accept, options.noPolicy ? undefined : merchant);
  return { useCase, repository, effects };
}
const noEffects = (effects: Awaited<ReturnType<typeof fixture>>["effects"]) => {
  assert.deepEqual({ provider: effects.provider, accept: effects.accept, save: effects.save, append: effects.append }, { provider: 0, accept: 0, save: 0, append: 0 });
};

test("offer contextual target within original combined ceiling authorizes and applies exactly once", async () => {
  const f = await fixture(), response = await f.useCase.execute(request);
  assert.equal(response.success, true); assert.equal(response.experience?.totals.discount, 5);
  assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 5);
  // appendChatTurn persists through the same repository in this explicit double.
  assert.deepEqual(f.effects, { provider: 1, accept: 1, save: 2, append: 1, policy: 1 });
  assert.deepEqual(response.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
});

test("partial allowance cannot silently reduce an already approved provider offer", async () => {
  const f = await fixture({ offer: { value: 10 } }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_requires_requote");
  assert.deepEqual(response.commercialNotices?.map(notice => notice.code), ["benefit_conditions_not_met"]);
  noEffects(f.effects); assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 0);
});

test("already reached original company cap refuses additional offer with truthful typed maximum notice", async () => {
  const f = await fixture({ cart: contextualCart(2000), offer: { value: 1 } }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_limit_reached");
  assert.deepEqual(response.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]); noEffects(f.effects);
});

test("offer targets replace previous cart targets rather than summing again", async () => {
  const f = await fixture({ cart: contextualCart(1000, 5), offer: { value: 3 } }), response = await f.useCase.execute(request);
  assert.equal(response.success, true); assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 5);
  assert.equal(f.effects.provider, 1);
});

test("contextual percent follows existing effective-subtotal offer value then enforces original total ceiling", async () => {
  const f = await fixture({ cart: contextualCart(1000), offer: { type: "discount_percent", value: 10 } }), response = await f.useCase.execute(request);
  assert.equal(response.success, true); assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 9);
});

for (const [label, patch] of [
  ["inconsistent original", { originalSubtotalCents: 11000 }],
  ["wrong version", { version: 2 }],
  ["extra context field", { forged: true }],
  ["invalid promotion money", { promotionDiscountCents: 0.1 }],
] as const) test(`invalid server provenance requires review before side effects: ${label}`, async () => {
  const cart = contextualCart(); cart.discountBudget = { ...cart.discountBudget!, ...patch } as Cart["discountBudget"];
  const f = await fixture({ cart }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_review_required"); noEffects(f.effects);
});

test("existing above-limit benefit is never silently revoked or replaced", async () => {
  const f = await fixture({ cart: contextualCart(1500, 10) }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_review_required"); noEffects(f.effects);
  assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 10);
});

for (const [label, options] of [
  ["missing port", { noPolicy: true }], ["lookup failure", { failPolicy: true }], ["missing row", { policy: null }],
  ["bad policy", { policy: merchantRules({ maxDiscountPercent: NaN }) }],
  ["foreign policy", { policy: { ...merchantRules(), merchantId: "foreign" } }],
] as const) test(`missing or invalid company policy fails closed: ${label}`, async () => {
  const f = await fixture(options), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_policy_unavailable");
  assert.ok(!JSON.stringify(response).includes("private_db_failure")); noEffects(f.effects);
});

for (const cost of [undefined, 99]) test(`promotion and offer share the ceiling regardless of cost (${cost})`, async () => {
  const cart = contextualCart(); cart.items[0].cost = cost;
  const f = await fixture({ cart }), response = await f.useCase.execute(request);
  assert.equal(response.success, true); assert.equal(response.experience?.totals.discount, 5);
  assert.deepEqual(response.commercialNotices?.map(notice => notice.code), ["discount_limit_reached"]);
  assert.deepEqual(f.effects, { provider: 1, accept: 1, save: 2, append: 1, policy: 1 });
});

test("configured zero is unavailable, not a fabricated maximum-reached discount", async () => {
  const f = await fixture({ cart: contextualCart(0), policy: merchantRules({ maxDiscountPercent: 0 }) }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_disabled_by_merchant");
  assert.deepEqual(response.commercialNotices?.map(notice => notice.code), ["discount_unavailable"]); noEffects(f.effects);
});

for (const value of [-1, NaN, Infinity, 0.001]) test(`malformed fixed amount cannot reach provider (${value})`, async () => {
  const f = await fixture({ offer: { value } }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); noEffects(f.effects);
});

test("non-BRL contextual incentives cannot reach provider", async () => {
  const cart = contextualCart(); cart.currency = "USD";
  const f = await fixture({ cart }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); noEffects(f.effects);
});

test("shipping benefit does not spend merchandise headroom but cannot bypass invalid contextual cart", async () => {
  const valid = await fixture({ cart: contextualCart(2000), offer: { type: "shipping_free", value: 0 } });
  assert.equal((await valid.useCase.execute(request)).success, true); assert.equal(valid.effects.provider, 1);
  const invalid = await fixture({ cart: contextualCart(2000, 1), offer: { type: "shipping_free", value: 0 } });
  assert.equal((await invalid.useCase.execute(request)).success, false); noEffects(invalid.effects);
});

test("tenant/session/expiry gates precede policy and commerce", async () => {
  for (const offer of [{ merchantId: "foreign" }, { sessionId: "other" }, { expiresAt: "2020-01-01" }]) {
    const f = await fixture({ offer }); assert.equal((await f.useCase.execute(request)).success, false);
    noEffects(f.effects); assert.equal(f.effects.policy, 0);
  }
});

test("legacy carts without budget retain original offer acceptance compatibility", async () => {
  const cart = contextualCart(0); delete cart.discountBudget; delete cart.items[0].originalPrice;
  const f = await fixture({ cart, noPolicy: true }), response = await f.useCase.execute(request);
  assert.equal(response.success, true); assert.equal(f.effects.provider, 1); assert.equal(f.effects.accept, 1);
  assert.equal(response.commercialNotices, undefined);
});

test("contextual offer does not create default merchant rules when readonly row is missing", async () => {
  const f = await fixture({ existingPolicy: undefined }), response = await f.useCase.execute(request);
  assert.equal(response.success, false); assert.equal(response.reason, "discount_policy_unavailable");
  assert.equal(f.effects.policy, 0); noEffects(f.effects);
});

test("contextual offer prefers existing readonly policy and does not call the default-producing method", async () => {
  const f = await fixture({ existingPolicy: merchantRules({ maxDiscountPercent: 20, minimumMarginPercent: 38 }), failPolicy: true });
  assert.equal((await f.useCase.execute(request)).success, true); assert.equal(f.effects.policy, 0); assert.equal(f.effects.provider, 1);
});

test("request identity is detached before the first asynchronous repository read", async () => {
  const f = await fixture(), submitted = { ...request }, pending = f.useCase.execute(submitted);
  submitted.merchant_id = "foreign"; submitted.session_id = "different"; submitted.offer_id = "other";
  const response = await pending; assert.equal(response.success, true); assert.equal(f.effects.provider, 1);
  assert.equal((await f.repository.getSession("mrc_1", "chk_1"))?.cart.currentDiscount, 5);
});

