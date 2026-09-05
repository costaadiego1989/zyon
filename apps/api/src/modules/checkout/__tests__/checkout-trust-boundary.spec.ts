import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutCartAuthorityService } from "../application/services/checkout-cart-authority.service.js";
import { StartCheckoutUseCase } from "../application/use-cases/start-checkout.use-case.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { BuyerRecognitionService } from "../application/services/buyer-recognition.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";
import { checkoutSession } from "./checkout-test-fixtures.js";
import type { Cart } from "@zyon/shared-types";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";

const submittedCart = (): Cart => ({
  currency: "USD", total: 0.01, currentDiscount: 9999,
  items: [{ sku: "sku-1", quantity: 2, name: "Forged name", price: 0.01, cost: 0, weightGrams: 1 }],
});

function catalogAuthority(overrides: { available?: number; ambiguous?: boolean; promotion?: boolean } = {}) {
  const row = {
    id: "variant-1", productId: "product-1", sku: "sku-1", isActive: true,
    product: { merchantId: "merchant-1", name: "Authoritative item", type: "physical", categoryId: "category-1", isActive: true },
    price: { basePriceInCents: 12990, costInCents: 8000, currency: "BRL" },
    stock: [{ quantity: overrides.available ?? 10, reserved: 0 }], media: [], weightGrams: 800,
  };
  const prisma = {
    productVariant: { async findMany(query: any) {
      assert.equal(query.where.isActive, true);
      assert.equal(query.where.product.isActive, true);
      if (query.where.product.merchantId !== row.product.merchantId || !query.where.sku.in.includes(row.sku)) return [];
      return overrides.ambiguous ? [row, { ...row, id: "variant-2" }] : [row];
    } },
    productPromotion: { async findMany(query: any) {
      assert.equal(query.where.merchantId, "merchant-1");
      assert.equal(query.where.isActive, true);
      assert.ok(query.where.startsAt.lte instanceof Date);
      assert.ok(query.where.endsAt.gt instanceof Date);
      return overrides.promotion ? [{ variantId: "variant-1", discountType: "percent", discountValue: 10 }] : [];
    } },
  };
  return new CheckoutCartAuthorityService(prisma as never, {} as never);
}

function starter(repo: InMemoryCheckoutRepository, authority = catalogAuthority(), customer?: CheckoutCustomerService) {
  return new StartCheckoutUseCase(
    repo, repo, repo, undefined, undefined, undefined, undefined, customer,
    { platformFeeBrl: 1.99 }, undefined, undefined, undefined, undefined, undefined, undefined, authority,
  );
}

function buyerServices(repo: InMemoryCheckoutRepository) {
  let lookups = 0;
  const account = new BuyerAccount({
    globalUserId: "victim-buyer", email: "victim@example.com", passwordHash: "hash",
    displayName: "Private Buyer", phone: "11987654321", cpf: "12345678900",
    address: { zip: "01001000", street: "Private street", number: "10", city: "Sao Paulo", state: "SP", complement: "" },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const recognition = new BuyerRecognitionService(repo, {
    async findByEmail() { lookups += 1; return account; },
  } as never);
  const sentCodes: string[] = [];
  const service = new CheckoutCustomerService(repo, {
    notifyCaptured() {},
    sendOtpCode(input: { otpCode: string }) { sentCodes.push(input.otpCode); },
  } as never, new OtpService(), recognition);
  return { service, recognition, sentCodes, lookups: () => lookups };
}

test("start reprices native SKUs and strips forged totals, freight and identity assertions", async () => {
  const repo = new InMemoryCheckoutRepository();
  const buyers = buyerServices(repo);
  const result = await starter(repo, catalogAuthority(), buyers.service).execute({
    merchant_id: "merchant-1", session_id: "session-1", cart: submittedCart(),
    customer: {
      email: "victim@example.com", email_verified: true, phone_verified: true, address_verified: true,
      externalCustomerId: "victim-buyer", asaasCustomerId: "provider-victim", otp_code: "123456",
      recognized_buyer: true, isReturning: true,
    },
    shipping: { customerPrice: -100, realCost: 0, region: "SP" },
  });
  const session = repo.getSession("merchant-1", result.session_id)!;
  assert.equal(session.cart.total, 259.8);
  assert.equal(session.cart.currency, "BRL");
  assert.equal(session.cart.items[0]!.price, 129.9);
  assert.equal(session.cart.items[0]!.name, "Authoritative item");
  assert.equal(session.cart.items[0]!.weightGrams, 800);
  assert.equal(session.cart.currentDiscount, undefined);
  assert.equal(session.shipping, undefined);
  assert.deepEqual(session.customer, { email: "victim@example.com" });
  assert.notEqual(session.globalUserId, "victim-buyer");
  assert.equal(buyers.lookups(), 0);
  const second = await starter(repo).execute({ merchant_id: "merchant-1", cart: submittedCart(), customer: { email: "victim@example.com" } });
  assert.notEqual(result.global_user_id, second.global_user_id);
});

test("unknown, other-tenant, ambiguous and unavailable SKUs fail closed before session persistence", async () => {
  for (const [merchantId, cart, authority] of [
    ["merchant-1", { ...submittedCart(), items: [{ sku: "unknown", quantity: 1 }] }, catalogAuthority()],
    ["merchant-other", submittedCart(), catalogAuthority()],
    ["merchant-1", submittedCart(), catalogAuthority({ ambiguous: true })],
    ["merchant-1", submittedCart(), catalogAuthority({ available: 1 })],
    ["merchant-1", { ...submittedCart(), items: [{ sku: "sku-1", quantity: -1 }] }, catalogAuthority()],
  ] as const) {
    const repo = new InMemoryCheckoutRepository();
    await assert.rejects(starter(repo, authority).execute({ merchant_id: merchantId, session_id: "attempt", cart: cart as Cart }));
    assert.equal(repo.getSession(merchantId, "attempt"), undefined);
  }
});

test("active catalog promotion is applied in cents independently of caller discount", async () => {
  const cart = await catalogAuthority({ promotion: true }).resolve("merchant-1", submittedCart());
  assert.equal(cart.items[0]!.price, 116.91);
  assert.equal(cart.total, 233.82);
  assert.equal(cart.currentDiscount, undefined);
});

test("stripped browser freight cannot turn a physical checkout into a free-shipping payment", async () => {
  const repo = new InMemoryCheckoutRepository();
  const started = await starter(repo).execute({
    merchant_id: "merchant-1", cart: submittedCart(), shipping: { customerPrice: 0, realCost: 0, region: "SP" },
  });
  let providerCalled = false;
  const payment = new CreatePaymentIntentUseCase(repo, {} as never, {} as never, {
    async createPayment() { providerCalled = true; throw new Error("must_not_charge"); },
  } as never);
  await assert.rejects(payment.execute({ merchant_id: "merchant-1", session_id: started.session_id, idempotency_key: "attempt", method: "pix" }), /shipping_method_required_before_payment/);
  assert.equal(providerCalled, false);
});

test("commerce cart comes from provider and rejects unmodeled total differences", async () => {
  let total = 4200;
  const authority = new CheckoutCartAuthorityService({} as never, {
    async execute(input: any) {
      assert.deepEqual(input, { merchantId: "merchant-1", commerceCartRef: "trusted-ref" });
      return { trustedCart: { commerceCartRef: "trusted-ref", currency: "BRL", totalCents: total, lines: [{ sku: "provider-sku", title: "Provider item", quantity: 2, unitPriceCents: 2100 }] } };
    },
  } as never);
  const cart = await authority.resolve("merchant-1", { ...submittedCart(), commerceCartRef: "trusted-ref" });
  assert.equal(cart.total, 42);
  assert.equal(cart.items[0]!.sku, "provider-sku");
  assert.equal(cart.currentDiscount, undefined);
  total = 1;
  await assert.rejects(authority.resolve("merchant-1", { ...submittedCart(), commerceCartRef: "trusted-ref" }), /checkout_commerce_total_breakdown_required/);
});

test("existing email remains opaque through hint and chat; only current OTP hydrates identity", async () => {
  const repo = new InMemoryCheckoutRepository();
  const buyers = buyerServices(repo);
  const anonymous = checkoutSession({ merchantId: "merchant-1", sessionId: "session-otp", globalUserId: "anonymous", customer: {} });
  const hinted = { ...anonymous, customer: { email: "victim@example.com" } };
  assert.deepEqual(await buyers.service.hydrateReturningBuyerFromEmailHint(hinted), hinted);
  assert.deepEqual((await buyers.recognition.recognizeVerifiedBuyer(hinted, (s, patch) => ({ ...s, customer: { ...s.customer, ...patch } }))).session, hinted);
  let current = await buyers.service.processCustomerInput(anonymous, "victim@example.com", undefined, "Merchant");
  assert.equal(current.customer?.email_verified, undefined);
  assert.equal(current.customer?.fullName, undefined);
  assert.equal(current.globalUserId, "anonymous");
  assert.equal(buyers.lookups(), 0);
  assert.equal(buyers.sentCodes.length, 1);
  const otp = buyers.sentCodes[0]!;
  const wrong = otp === "111111" ? "222222" : "111111";
  await assert.rejects(buyers.service.processCustomerInput(current, wrong, undefined, "Merchant"));
  current = await buyers.service.processCustomerInput(current, otp, undefined, "Merchant");
  assert.equal(current.customer?.email_verified, true);
  assert.equal(current.customer?.otp_code, "");
  assert.equal(current.globalUserId, "victim-buyer");
  assert.equal(current.customer?.fullName, "Private Buyer");
  assert.equal(current.customer?.address?.street, "Private street");
});

test("verified buyer never adopts identity or address planted in an unverified prior session", async () => {
  const repo = new InMemoryCheckoutRepository();
  repo.saveSession(checkoutSession({ sessionId: "planted", globalUserId: "attacker-known-global", customer: {
    email: "victim@example.com", fullName: "Attacker supplied", address: { street: "Attacker supplied", zip: "01001000", city: "Sao Paulo", state: "SP", number: "1", complement: "" },
  } }));
  const verified = checkoutSession({ sessionId: "verified", globalUserId: "current-buyer", customer: { email: "victim@example.com", email_verified: true } });
  const recognition = new BuyerRecognitionService(repo);
  const result = await recognition.recognizeVerifiedBuyer(verified, (session, patch) => ({ ...session, customer: { ...session.customer, ...patch } }));
  assert.equal(result.globalUserId, undefined);
  assert.equal(result.session.globalUserId, "current-buyer");
  assert.equal(result.session.customer?.address, undefined);
  assert.equal(result.session.customer?.fullName, undefined);
});
