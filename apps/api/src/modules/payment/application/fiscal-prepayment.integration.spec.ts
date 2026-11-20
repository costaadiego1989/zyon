import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PaymentHttpController } from "../presentation/http/payment.controller.js";
import { GetPaymentIntentStatusUseCase } from "./get-payment-intent-status.use-case.js";
import { CreatePaymentIntentUseCase } from "./create-payment-intent.use-case.js";
import { CreateMarketplacePaymentService } from "./create-marketplace-payment.service.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../infrastructure/fake-payment-provider.js";
import { checkoutSession } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { checkoutScopeReader } from "../../checkout/__tests__/checkout-scope-reader.fixture.js";
import { FiscalBeforePaymentService } from "../../fiscal/application/fiscal-before-payment.service.js";
import { FiscalProfileService } from "../../fiscal/application/fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../../fiscal/infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalCheckoutReader } from "../../fiscal/infrastructure/prisma-fiscal-checkout.reader.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";
import type { CheckoutSession } from "@zyon/shared-types";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "../../../shared/persistence/tenant.middleware.js";
import type { PrismaClient } from "@prisma/client";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let current: CreatePaymentIntentUseCase;
before(async () => {
  fixture = await createFiscalFixture({ controllers: [PaymentHttpController], providers: [
    { provide: CreatePaymentIntentUseCase, useValue: { execute: (input: never) => current.execute(input) } },
    { provide: GetPaymentIntentStatusUseCase, useValue: {} },
  ] });
  await fixture.sql.query("CREATE TABLE synthetic_fiscal_charges (intent_id text PRIMARY KEY, merchant_id text, amount_cents int)");
}, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange() {
  const sale = await seedFiscalSale(fixture);
  const config = { currency: "BRL", supportedProductTypes: ["physical"], items: { sku_a: {
    productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { csosn: "102" },
  } } };
  await fixture.prisma.fiscalProfileVersion.update({ where: { id: sale.profile.id }, data: { itemRules: config, recipientRequirements: ["name", "taxId", "address.street"] } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  const checkout = new InMemoryCheckoutRepository();
  let session = checkoutSession({ merchantId: sale.merchantId, sessionId: sale.completedOrder.sessionId,
    customer: { fiscalRecipientMode: "other", fullName: "Buyer", cpf: "52998224725", asaasCustomerId: "synthetic_customer", email: "buyer@example.test",
      fiscalRecipient: {} }, cart: { currency: "BRL", total: 10, items: [{ sku: "sku_a", name: "Goods", price: 10, quantity: 1, productType: "physical" }] }, shipping: { customerPrice: 0 } });
  const save = async (customer: CheckoutSession["customer"]) => {
    session = { ...session, customer }; await checkout.saveSession(session);
    await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: session.merchantId, sessionId: session.sessionId } }, data: { cart: session.cart as never, customer: customer as never } });
  };
  await save(session.customer);
  const reader = checkoutScopeReader(checkout);
  const provider = new class extends FakePaymentProvider {
    async createPayment(input: CreateProviderPaymentInput) {
      await fixture.sql.query("INSERT INTO synthetic_fiscal_charges VALUES ($1,$2,$3)", [input.intentId, input.merchantId, input.amountCents]);
      return super.createPayment(input);
    }
  }();
  const payments = new InMemoryPaymentRepository(checkout);
  const tenants = new TenantContextService();
  const tenantPrisma = registerTenantMiddleware(fixture.prisma, tenants) as unknown as PrismaClient;
  const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(tenantPrisma, "homologation", tenants),
    new FiscalProfileService(new PrismaFiscalProfileRepository(tenantPrisma), { find: () => ({ operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional"], productTypes: ["physical"] }) }));
  const useCase = new CreatePaymentIntentUseCase(checkout, checkout, payments, provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reader, undefined, undefined, undefined, undefined, undefined, gate);
  current = useCase;
  const request = { merchant_id: session.merchantId, session_id: session.sessionId, idempotency_key: "fiscal_charge", method: "pix" as const };
  const chargeCount = async () => Number((await fixture.sql.query("SELECT count(*) FROM synthetic_fiscal_charges WHERE merchant_id=$1", [session.merchantId])).rows[0].count);
  const post = (method = "pix") => fetch(fixture.first.url + "/v1/payment/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, method }) });
  return { sale, checkout, session, save, gate, reader, provider, payments, useCase, request, chargeCount, post, tenants };
}
test("FISCAL-06 active fiscal checkout validates stored recipient before payment", async () => {
  const f = await arrange(); const response = await f.post();
  assert.equal(response.status, 400);
  const body = await response.json(); assert.equal(body.code, "fiscal_customer_data_required");
  assert.deepEqual(body.fields, ["name", "taxId", "address.street"]);
  assert.equal(await f.chargeCount(), 0); assert.equal((await f.payments.listBySessionId(f.session.merchantId, f.session.sessionId)).length, 0);
});
test("FISCAL-07 invalid data returns only correction fields and creates no PSP charge", async () => {
  const f = await arrange(); await f.save({ ...f.session.customer, fiscalRecipient: { name: "Buyer", taxId: "11111111111", address: { street: "Rua Um" } } });
  const response = await f.post("card"); const body = await response.json();
  assert.equal(response.status, 400); assert.deepEqual(body.fields, ["taxId"]); assert.equal(await f.chargeCount(), 0);
  assert.equal(JSON.stringify(body).includes("11111111111"), false);
});
test("FISCAL-08 correcting fiscal fields resumes payment with original cart quantity and money", async () => {
  const f = await arrange(); const original = structuredClone(f.session.cart); await f.post();
  await f.save({ ...f.session.customer, fiscalRecipient: { name: "Buyer", taxId: "52998224725", address: { street: "Rua Um" } } });
  const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 201); assert.equal(body.status, "requires_action");
  assert.equal(body.amountCents, 1099); assert.equal(await f.chargeCount(), 1);
  assert.deepEqual((await f.checkout.getSession(f.session.merchantId, f.session.sessionId))!.cart, original);
});
test("every Pix card and crypto branch refuses incomplete fiscal data before PSP writes", async () => {
  const f = await arrange();
  for (const method of ["pix", "card", "crypto"]) assert.equal((await f.post(method)).status, 400);
  assert.equal(await f.chargeCount(), 0);
});
test("marketplace delegation cannot bypass the common fiscal prepayment gate", async () => {
  const f = await arrange(); let delegated = false;
  f.reader.crossStoreLineItem.findFirst = (async () => ({ id: "persisted_marketplace" })) as never;
  const useCase = new CreatePaymentIntentUseCase(f.checkout, f.checkout, f.payments, f.provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.reader, { executePublic: async () => { delegated = true; } } as never, undefined, undefined, undefined, undefined, f.gate);
  await assert.rejects(useCase.execute(f.request, { marketplaceSurface: "embed" }), /fiscal_customer_data_required/);
  assert.equal(delegated, false); assert.equal(await f.chargeCount(), 0);
});
test("direct marketplace internal and public entrypoints also enforce fiscal data before preparation", async () => {
  const f = await arrange(); let prepared = false;
  const useCase = new CreateMarketplacePaymentService(f.checkout, f.payments, f.provider, { execute: async () => { prepared = true; } } as never,
    {} as never, {} as never, f.gate);
  await assert.rejects(useCase.execute(f.request), /fiscal_customer_data_required/);
  await assert.rejects(useCase.executePublic(f.request), /fiscal_customer_data_required/);
  assert.equal(prepared, false); assert.equal(await f.chargeCount(), 0);
});
test("a retry that could resume PSP creation still validates fiscal data before writing", async () => {
  const f = await arrange(); const intent = PaymentIntentEntity.create({ merchantId: f.session.merchantId, sessionId: f.session.sessionId,
    idempotencyKey: f.request.idempotency_key, amountCents: 1099, currency: "BRL", method: "pix" });
  await f.payments.saveIntent({ intent });
  const original = intent.snapshot();
  await assert.rejects(f.useCase.execute(f.request), /fiscal_customer_data_required/);
  assert.equal(await f.chargeCount(), 0); assert.deepEqual((await f.payments.getByIdempotency(f.session.merchantId, f.session.sessionId, f.request.idempotency_key))!.snapshot(), original);
});
test("fiscal recipient company keeps its alphanumeric CNPJ alongside the personal buyer CPF", async () => {
  const f = await arrange(); await f.save({ ...f.session.customer, fiscalRecipient: { name: "Empresa", taxId: "12ABC34501DE35", address: { street: "Rua Um" } } });
  assert.equal((await f.post()).status, 201);
  const stored = (await f.checkout.getSession(f.session.merchantId, f.session.sessionId))!;
  assert.equal(stored.customer?.cpf, "52998224725"); assert.equal(stored.customer?.fiscalRecipient?.taxId, "12ABC34501DE35");
  assert.equal(await f.chargeCount(), 1);
});
test("inactive fiscal configuration leaves the existing commercial payment path available", async () => {
  const f = await arrange();
  await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { isActive: false } });
  assert.equal((await f.post()).status, 201); assert.equal(await f.chargeCount(), 1);
});
test("digital-only carts are outside the NF-e recipient gate", async () => {
  const f = await arrange(); f.session.cart.items[0].productType = "digital";
  await f.save(f.session.customer);
  assert.equal((await f.post()).status, 201); assert.equal(await f.chargeCount(), 1);
});
test("FISCAL-24 FI-D16 does not collect another store's fiscal data for an unsupported checkout", async () => {
  const f = await arrange(); const seller = await seedFiscalSale(fixture);
  await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { isActive: false } });
  await fixture.prisma.fiscalConnection.update({ where: { id: seller.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  await fixture.prisma.fiscalProfileVersion.update({ where: { id: seller.profile.id }, data: { itemRules: (await fixture.prisma.fiscalProfileVersion.findUniqueOrThrow({ where: { id: f.sale.profile.id } })).itemRules as never } });
  const record = await fixture.prisma.crossStoreLineItem.create({ data: { hostMerchantId: f.session.merchantId,
    sellerMerchantId: seller.merchantId, checkoutSessionId: f.session.sessionId, federatedProductId: "synthetic_product",
    sourceVariantId: "sku_a", quantity: 1, unitPriceCents: 1000, commissionRateBps: 0, commissionCents: 0, sellerNetCents: 1000 } });
  f.session.cart.items[0].marketplace = { lineItemId: record.id, sourceMerchantId: seller.merchantId } as never;
  await f.save(f.session.customer);
  const original = structuredClone(f.session.cart);
  assert.deepEqual(await f.tenants.run({ merchantId: f.session.merchantId, userId: "buyer", role: "buyer" }, () => f.gate.requirements(f.session)), []);
  await f.tenants.run({ merchantId: f.session.merchantId, userId: "buyer", role: "buyer" }, () => f.gate.assertBeforePayment(f.session));
  assert.deepEqual(f.session.cart, original);
  assert.equal(await f.chargeCount(), 0);
});
test("FISCAL-24 an untrusted cart marker cannot opt an own-store buyer out of fiscal validation", async () => {
  const f = await arrange();
  for (const sourceMerchantId of ["foreign", f.session.merchantId]) {
    f.session.cart.items[0].marketplace = { lineItemId: "invented_fiscal_opt_out", sourceMerchantId } as never;
    await f.save(f.session.customer);
    await assert.rejects(f.gate.assertBeforePayment(f.session), /fiscal_checkout_scope_invalid/);
    assert.equal(await f.chargeCount(), 0);
    assert.equal((await f.payments.listBySessionId(f.session.merchantId, f.session.sessionId)).length, 0);
  }
});
test("missing tax setup still requires base buyer data before any charge", async () => {
  const f = await arrange();
  await fixture.prisma.fiscalIntent.delete({ where: { id: f.sale.intent.id } });
  await fixture.prisma.fiscalProfileVersion.delete({ where: { id: f.sale.profile.id } });
  const response = await f.post(); const body = await response.json();
  assert.equal(response.status, 400); assert.equal(body.code, "fiscal_customer_data_required");
  assert.deepEqual(body.fields, ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode"]);
  assert.equal(await f.chargeCount(), 0);
});
test("an unconfirmed draft never displaces the effective confirmed profile in checkout", async () => {
  const f = await arrange();
  await fixture.prisma.fiscalProfileVersion.create({ data: { merchantId: f.sale.merchantId, environment: f.sale.environment,
    provider: "focus", operation: "sale", version: 2, issuerRegime: "unconfigured", itemRules: {}, recipientRequirements: [], sourceContractVersion: "unconfigured" } });
  await f.save({ ...f.session.customer, fiscalRecipient: { name: "Buyer", taxId: "52998224725", address: { street: "Rua Um" } } });
  assert.equal((await f.post()).status, 201); assert.equal(await f.chargeCount(), 1);
});
