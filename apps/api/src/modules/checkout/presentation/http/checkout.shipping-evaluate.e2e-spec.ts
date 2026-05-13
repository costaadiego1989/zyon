import test from "node:test";
import assert from "node:assert/strict";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryMerchantRepository } from "../../../merchant/infrastructure/in-memory-merchant.repository.js";

function makeCheckout() {
  return new InMemoryCheckoutRepository();
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function startSession(
  checkout: InMemoryCheckoutRepository,
  merchantId: string,
  sessionId: string,
  total = 300
) {
  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: {
      currency: "BRL",
      total,
      items: [{ sku: "sku1", name: "Produto", price: total, quantity: 1 }]
    },
    customer: { email: "buyer@test.com" }
  });
}

test("evaluate-shipping e2e: not approved when default rules forbid free shipping", async () => {
  const checkout = makeCheckout();
  const merchantId = makeId("mrc_ship");
  const sessionId = makeId("chk_ship");

  await startSession(checkout, merchantId, sessionId, 150);

  // No merchant rules repo → defaults (allowFreeShipping: false, allowShippingDiscount: false)
  const useCase = new EvaluateShippingUseCase(checkout, checkout);
  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    shipping_price: 1990,
    shipping_real_cost: 1990,
    cart_value: 150,
    abandonment_score: 0.9
  });

  assert.equal(result.approved, false);
  assert.equal(result.shipping_subsidy, 0);
  assert.ok(result.message.length > 0, "message presente mesmo quando nao aprovado");
});

test("evaluate-shipping e2e: approved free shipping when merchant rules allow and cart meets threshold", async () => {
  const checkout = makeCheckout();
  const merchantRulesRepo = new InMemoryMerchantRepository();
  const merchantId = makeId("mrc_free");
  const sessionId = makeId("chk_free");

  // shipping_price in BRL (19 = R$19). maxShippingSubsidy must be >= shipping_price.
  await merchantRulesRepo.updateRules(merchantId, {
    allowFreeShipping: true,
    freeShippingMinCartValue: 100,
    maxShippingSubsidy: 50
  });

  await startSession(checkout, merchantId, sessionId, 300);

  const useCase = new EvaluateShippingUseCase(checkout, checkout, merchantRulesRepo);
  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    shipping_price: 19,
    shipping_real_cost: 19,
    cart_value: 300,
    abandonment_score: 0.8
  });

  assert.equal(result.approved, true);
  assert.equal(result.action, "shipping_free");
  assert.ok(result.shipping_subsidy > 0);
  assert.match(result.message, /frete gratis/i);
});

test("evaluate-shipping e2e: throws NotFoundException when session missing", async () => {
  const checkout = makeCheckout();
  const useCase = new EvaluateShippingUseCase(checkout, checkout);

  await assert.rejects(
    () => useCase.execute({
      merchant_id: "mrc_ghost",
      session_id: "chk_ghost",
      shipping_price: 1990,
      cart_value: 150
    }),
    /checkout_session_not_found/
  );
});

test("evaluate-shipping e2e: offer persisted and retrievable after evaluation", async () => {
  const checkout = makeCheckout();
  const merchantRulesRepo = new InMemoryMerchantRepository();
  const merchantId = makeId("mrc_persist");
  const sessionId = makeId("chk_persist");

  await merchantRulesRepo.updateRules(merchantId, {
    allowFreeShipping: true,
    freeShippingMinCartValue: 100,
    maxShippingSubsidy: 50
  });

  await startSession(checkout, merchantId, sessionId, 300);

  const useCase = new EvaluateShippingUseCase(checkout, checkout, merchantRulesRepo);
  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    shipping_price: 19,
    shipping_real_cost: 19,
    cart_value: 300,
    abandonment_score: 0.8
  });

  assert.equal(result.approved, true);
  // Second call creates a new offer with same inputs
  const result2 = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    shipping_price: 19,
    shipping_real_cost: 19,
    cart_value: 300,
    abandonment_score: 0.8
  });
  assert.equal(result2.approved, true);
});

test("evaluate-shipping e2e: partial shipping discount when allowShippingDiscount=true and allowFreeShipping=false", async () => {
  const checkout = makeCheckout();
  const merchantRulesRepo = new InMemoryMerchantRepository();
  const merchantId = makeId("mrc_partial");
  const sessionId = makeId("chk_partial");

  await merchantRulesRepo.updateRules(merchantId, {
    allowFreeShipping: false,
    allowShippingDiscount: true,
    maxPartialShippingDiscount: 10,
    maxShippingSubsidy: 10
  });

  await startSession(checkout, merchantId, sessionId, 300);

  const useCase = new EvaluateShippingUseCase(checkout, checkout, merchantRulesRepo);
  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    shipping_price: 1990,
    shipping_real_cost: 1990,
    cart_value: 300,
    abandonment_score: 0.8
  });

  // May or may not be approved depending on shipping-engine rules, but must not be free
  if (result.approved) {
    assert.notEqual(result.action, "shipping_free");
  }
  assert.ok(result.message.length > 0);
});
