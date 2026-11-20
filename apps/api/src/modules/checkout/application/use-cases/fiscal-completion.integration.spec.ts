import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../../tests/fiscal-schema-seed.js";
import { CheckoutController } from "../../presentation/http/checkout.controller.js";
import { CompleteOrderUseCase } from "./complete-order.use-case.js";
import { PrismaCheckoutRepository } from "../../infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaPaymentApprovalReader } from "../../infrastructure/adapters/prisma-payment-approval.reader.js";
import { PrismaFiscalOrderParticipant } from "../../../fiscal/infrastructure/prisma-fiscal-order.participant.js";
import { readFiscalSnapshotEnvelope } from "../../../fiscal/domain/fiscal-sale-snapshot.port.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { registerTenantMiddleware } from "../../../../shared/persistence/tenant.middleware.js";
import { checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import type { CheckoutSession } from "@zyon/shared-types";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../../payment/application/get-payment-intent-status.use-case.js";
import { PaymentHttpController } from "../../../payment/presentation/http/payment.controller.js";
import { InMemoryPaymentRepository } from "../../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../../payment/infrastructure/fake-payment-provider.js";
import { FiscalBeforePaymentService } from "../../../fiscal/application/fiscal-before-payment.service.js";
import { FiscalProfileService } from "../../../fiscal/application/fiscal-profile.service.js";
import { PrismaFiscalCheckoutReader } from "../../../fiscal/infrastructure/prisma-fiscal-checkout.reader.js";
import { PrismaFiscalProfileRepository } from "../../../fiscal/infrastructure/prisma-fiscal-profile.repository.js";
import type { CreateProviderPaymentInput } from "../../../payment/domain/ports/payment-provider.port.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let current: CompleteOrderUseCase;
let currentPayment: CreatePaymentIntentUseCase;
before(async () => {
  const dependencies: unknown[] = [...Reflect.getMetadata("design:paramtypes", CheckoutController), JwtService, AuthCookieService, CreatePaymentIntentUseCase, GetPaymentIntentStatusUseCase];
  fixture = await createFiscalFixture({ controllers: [CheckoutController, PaymentHttpController], providers: dependencies.filter(Boolean).map(provide => ({ provide: provide as never,
    useValue: provide === CompleteOrderUseCase ? { execute: (input: never) => current.execute(input) }
      : provide === CreatePaymentIntentUseCase ? { execute: (input: never) => currentPayment.execute(input) } : {} })) });
  await fixture.sql.query("CREATE TABLE synthetic_fiscal_checkout_charges (intent_id text PRIMARY KEY, merchant_id text, amount_cents int)");
}, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
const configuration = (sku = "sku_a") => ({ currency: "BRL", supportedProductTypes: ["physical"], items: { [sku]: {
  productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { csosn: "102" },
} } });
async function arrange(withFiscal = false) {
  const sale = await seedFiscalSale(fixture);
  await fixture.prisma.fiscalIntent.delete({ where: { id: sale.intent.id } });
  await fixture.prisma.fiscalSaleSnapshot.delete({ where: { id: sale.snapshot.id } });
  await fixture.prisma.completedOrder.delete({ where: { id: sale.completedOrder.id } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01"), stockOwner: "provider" } });
  await fixture.prisma.fiscalProfileVersion.update({ where: { id: sale.profile.id }, data: { itemRules: configuration() } });
  const tenants = new TenantContextService();
  const db = registerTenantMiddleware(fixture.prisma, tenants) as unknown as PrismaClient;
  const support = { find: () => ({ operations: ["sale"], currencies: ["BRL"], issuerRegimes: ["simples_nacional"], productTypes: ["physical"] }) };
  const repo = new PrismaCheckoutRepository(db, false, undefined, undefined, tx => new PrismaFiscalOrderParticipant(tx, "homologation", tenants, support));
  const session = checkoutSession({ merchantId: sale.merchantId, sessionId: sale.completedOrder.sessionId,
    customer: { fullName: "Original Buyer", cpf: "52998224725", email: "original@example.test", phone: "5511999999999", fiscalRecipient: { name: "Original Recipient", taxId: "12ABC34501DE35" } },
    cart: { currency: "BRL", total: 10, items: [{ sku: "sku_a", price: 10, name: "Original goods", quantity: 1, productType: "physical" }] }, shipping: { customerPrice: 0 } });
  await repo.saveSession(session);
  const fiscal = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(db, "homologation", tenants),
    new FiscalProfileService(new PrismaFiscalProfileRepository(db), support));
  const useCase = new CompleteOrderUseCase(repo, repo, repo, undefined, undefined, undefined, undefined, repo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new PrismaPaymentApprovalReader(db), undefined, undefined, withFiscal ? fiscal : undefined, db);
  current = useCase;
  const request = { merchant_id: sale.merchantId, session_id: session.sessionId, external_order_id: sale.orderId, order_total: 10, currency: "BRL" as const };
  const approve = async (amountCents = 1000) => fixture.prisma.paymentIntent.create({ data: { id: sale.merchantId + "_approval",
    merchantId: sale.merchantId, sessionId: session.sessionId, idempotencyKey: "approved_sale", amountCents,
    currency: request.currency, method: "pix", status: "approved", providerPaymentId: sale.orderId, approvedAmountCents: amountCents } });
  const paid = async () => tenants.run({ merchantId: sale.merchantId, userId: "payment-worker", role: "system" }, () => useCase.executePaymentApproval(request, sale.merchantId + "_approval"));
  const intents = () => fixture.prisma.fiscalIntent.findMany({ where: { orderId: sale.orderId } });
  const snapshots = () => fixture.prisma.fiscalSaleSnapshot.findMany({ where: { orderMerchantId: sale.merchantId, orderId: sale.orderId } });
  const outboxCount = (eventType: string) => fixture.prisma.outboxMessage.count({ where: { merchantId: sale.merchantId, eventType } });
  return { sale, db, tenants, repo, session, useCase, request, approve, paid, intents, snapshots, outboxCount };
}
test("FISCAL-10 paid completion commits commercial order snapshot intent event and fiscal outbox together", async () => {
  const f = await arrange(); await f.approve(); assert.equal((await f.paid()).idempotent, false);
  const [intent] = await f.intents(); const [snapshot] = await f.snapshots();
  assert.equal(intent.state, "queued"); assert.equal(intent.snapshotId, snapshot.id); assert.equal(snapshot.paymentProofRef, f.sale.merchantId + "_approval");
  assert.equal(snapshot.totalCents, 1000); assert.equal((snapshot.recipient as { taxId: string }).taxId, "12ABC34501DE35");
  assert.equal(await f.outboxCount("fiscal.intent.queued"), 1); assert.equal(await f.outboxCount("order.completed"), 1);
  assert.equal(await fixture.prisma.fiscalEvent.count({ where: { intentId: intent.id, action: "created" } }), 1);
});
test("FISCAL-11 forged payment fields on the original public HTTP route only create awaiting_payment", async () => {
  const f = await arrange();
  const response = await fetch(fixture.first.url + "/v1/checkout/orders/complete", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...f.request, payment_intent_id: "forged", status: "approved", approved: true }) });
  assert.equal(response.status, 201); assert.equal((await f.intents())[0].state, "awaiting_payment");
  assert.equal((await f.snapshots())[0].paymentProofRef, null); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("late trusted approval after cart edit reuses original sale time money recipient policy and one stock event", async () => {
  const f = await arrange(); await f.useCase.execute(f.request); const original = (await f.snapshots())[0];
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.session.sessionId } },
    data: { cart: { ...f.session.cart, total: 999, items: [{ ...f.session.cart.items[0], price: 999, quantity: 5 }] }, customer: { fullName: "Changed", cpf: "11111111111" } } });
  await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { stockOwner: "zyon", emailOwner: "provider" } });
  await f.approve(); assert.equal((await f.paid()).idempotent, true);
  const snapshot = (await f.snapshots())[0]; const envelope = readFiscalSnapshotEnvelope(snapshot.items);
  assert.equal(snapshot.id, original.id); assert.equal(snapshot.contentHash, original.contentHash);
  assert.equal(snapshot.completedAt.toISOString(), original.completedAt.toISOString()); assert.equal(snapshot.totalCents, 1000);
  assert.equal(envelope.commercialLines[0].quantity, 1); assert.equal(envelope.commercialLines[0].unitPriceCents, 1000);
  assert.equal((snapshot.recipient as { name: string }).name, "Original Recipient");
  assert.deepEqual(envelope.policy, { stockOwner: "provider", emailOwner: "zyon", whatsappOwner: "zyon" });
  assert.deepEqual(envelope.buyerContacts, { name: "Original Buyer", email: "original@example.test", phone: "5511999999999" });
  assert.equal((await f.intents())[0].state, "queued"); assert.equal(await f.outboxCount("order.completed"), 1); assert.equal(await f.outboxCount("fiscal.intent.queued"), 1);
});
test("FISCAL-12 sale before activation remains ineligible on a later approval", async () => {
  const f = await arrange(); await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { activatedAt: new Date("2099-01-01") } });
  await f.useCase.execute(f.request); await f.approve(); await f.paid();
  assert.equal((await f.intents())[0].state, "not_eligible_before_activation"); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("FISCAL-13 a cancelled public sale suppresses fiscal submission when payment arrives", async () => {
  const f = await arrange(); await f.useCase.execute(f.request);
  await fixture.prisma.completedOrder.updateMany({ where: { merchantId: f.sale.merchantId, externalOrderId: f.sale.orderId }, data: { status: "cancelled", cancelledAt: new Date() } });
  await f.approve(); await f.paid(); assert.equal((await f.intents())[0].state, "suppressed"); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("FISCAL-28 concurrent repeated approvals keep one intent reference and commercial event", async () => {
  const f = await arrange(); await f.approve(); await Promise.all([f.paid(), f.paid()]);
  const intents = await f.intents(); assert.equal(intents.length, 1); assert.equal(intents[0].state, "queued");
  assert.equal((await f.snapshots()).length, 1); assert.equal(await f.outboxCount("order.completed"), 1); assert.equal(await f.outboxCount("fiscal.intent.queued"), 1);
});
test("FISCAL-64 failure persisting fiscal intent rolls back the original order snapshot event and both outboxes", async () => {
  const f = await arrange(); await f.approve();
  await fixture.sql.query("CREATE FUNCTION fiscal_test_intent_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_intent_failure'; END $$; CREATE TRIGGER fiscal_test_intent_failure BEFORE INSERT ON fiscal_intents FOR EACH ROW EXECUTE FUNCTION fiscal_test_intent_failure()");
  try { await assert.rejects(f.paid(), /injected_intent_failure/); }
  finally { await fixture.sql.query("DROP TRIGGER fiscal_test_intent_failure ON fiscal_intents; DROP FUNCTION fiscal_test_intent_failure()"); }
  assert.equal((await f.intents()).length, 0); assert.equal((await f.snapshots()).length, 0); assert.equal(await f.outboxCount("order.completed"), 0); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
  assert.equal(await fixture.prisma.completedOrder.count({ where: { merchantId: f.sale.merchantId } }), 0);
  assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: f.sale.merchantId + "_approval" } })).status, "approved");
});
test("a later commercial outbox failure rolls back already recorded fiscal work", async () => {
  const f = await arrange(); await f.approve();
  await fixture.sql.query("CREATE FUNCTION fiscal_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='order.completed' THEN RAISE EXCEPTION 'injected_outbox_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fiscal_test_outbox_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fiscal_test_outbox_failure()");
  try { await assert.rejects(f.paid(), /injected_outbox_failure/); }
  finally { await fixture.sql.query("DROP TRIGGER fiscal_test_outbox_failure ON outbox_messages; DROP FUNCTION fiscal_test_outbox_failure()"); }
  assert.equal((await f.intents()).length, 0); assert.equal((await f.snapshots()).length, 0); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("missing tax configuration creates an unconfirmed draft and action_required without losing the paid sale", async () => {
  const f = await arrange(); await fixture.prisma.fiscalProfileVersion.delete({ where: { id: f.sale.profile.id } });
  await f.approve(); await f.paid(); const [intent] = await f.intents();
  assert.equal(intent.state, "action_required"); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
  assert.equal(intent.lastErrorCode, "fiscal_profile_unconfirmed");
  const profile = await fixture.prisma.fiscalProfileVersion.findUniqueOrThrow({ where: { id: intent.profileVersionId } });
  assert.equal(profile.confirmedAt, null); assert.equal(profile.confirmedBy, null); assert.deepEqual(profile.itemRules, {});
  const snapshot = (await f.snapshots())[0]; assert.equal(snapshot.totalCents, 1000); assert.equal(readFiscalSnapshotEnvelope(snapshot.items).pendingLines.length, 1);
});
test("FISCAL-24 FI-D16 an already-paid cross-store order commits commerce without fiscal takeover", async () => {
  const f = await arrange(true); const other = await seedFiscalSale(fixture);
  await fixture.prisma.fiscalConnection.update({ where: { id: other.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  await fixture.prisma.fiscalProfileVersion.update({ where: { id: other.profile.id }, data: { itemRules: configuration("sku_b") } });
  const line = await fixture.prisma.crossStoreLineItem.create({ data: { hostMerchantId: f.sale.merchantId, sellerMerchantId: other.merchantId, checkoutSessionId: f.session.sessionId,
    federatedProductId: "synthetic_product", sourceVariantId: "sku_b", quantity: 1, unitPriceCents: 1000, commissionRateBps: 0, commissionCents: 0, sellerNetCents: 1000 } });
  f.session.cart.items.push({ sku: "sku_b", name: "Other goods", price: 10, quantity: 1, productType: "physical", marketplace: { lineItemId: line.id, sourceMerchantId: other.merchantId } as never });
  f.session.cart.total = 20; f.request.order_total = 20;
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.session.sessionId } }, data: { cart: f.session.cart as never } });
  await f.approve(2000); await f.paid(); const intents = await f.intents();
  assert.deepEqual(intents, []); assert.deepEqual(await f.snapshots(), []);
  assert.equal(await f.outboxCount("order.completed"), 1);
  const order = await fixture.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, externalOrderId: f.sale.orderId } });
  assert.equal(order.orderTotal.toNumber(), 20); assert.equal((order.lineItemsJson as any[]).length, 2);
  assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: f.sale.merchantId + "_approval" } })).status, "approved");
  const event = await fixture.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, eventType: "order.completed" } });
  assert.equal((event.payload as any).fiscal_stock_ownership, undefined); assert.equal((event.payload as any).order_total, 20);
  assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("FISCAL-24 a persisted foreign line without cart markers excludes only new fiscal work", async () => {
  const f = await arrange(true); const other = await seedFiscalSale(fixture);
  await fixture.prisma.crossStoreLineItem.create({ data: { hostMerchantId: f.sale.merchantId, sellerMerchantId: other.merchantId, checkoutSessionId: f.session.sessionId,
    federatedProductId: "hidden_foreign", sourceVariantId: "sku_a", quantity: 1, unitPriceCents: 1000, commissionRateBps: 0, commissionCents: 0, sellerNetCents: 1000 } });
  await f.approve(); await f.paid();
  assert.deepEqual(await f.snapshots(), []); assert.deepEqual(await f.intents(), []);
  assert.equal((await fixture.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, externalOrderId: f.sale.orderId } })).orderTotal.toNumber(), 10);
  const event = await fixture.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, eventType: "order.completed" } });
  assert.equal((event.payload as any).fiscal_stock_ownership, undefined); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
});
test("FISCAL-24 late approval cannot promote an immutable foreign historical snapshot", async () => {
  const f = await arrange();
  await f.useCase.execute(f.request);
  const legacy = await seedFiscalSale(fixture, { orderMerchantId: f.sale.merchantId, orderId: f.sale.orderId, issuance: true });
  await fixture.prisma.fiscalIntent.update({ where: { id: legacy.intent.id }, data: { state: "awaiting_payment" } });
  const original = await fixture.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: legacy.snapshot.id } });
  await f.approve(); await f.paid();
  assert.equal((await fixture.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: legacy.intent.id } })).state, "awaiting_payment");
  assert.deepEqual(await fixture.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: legacy.snapshot.id } }), original);
  assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
  assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: f.sale.merchantId + "_approval" } })).status, "approved");
  assert.equal(await fixture.prisma.completedOrder.count({ where: { merchantId: f.sale.merchantId, externalOrderId: f.sale.orderId } }), 1);
});
test("stock and delivery ownership is present in the original committed order event before inventory consumption", async () => {
  const f = await arrange(); await f.approve(); await f.paid();
  const event = await fixture.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, eventType: "order.completed" } });
  const policy = (event.payload as { fiscal_stock_ownership: { version: number; sellers: { merchantId: string; stockOwner: string; skus: string[] }[] } }).fiscal_stock_ownership;
  assert.equal(policy.version, 1); assert.equal(policy.sellers[0].merchantId, f.sale.merchantId); assert.equal(policy.sellers[0].stockOwner, "provider");
  assert.deepEqual(policy.sellers[0].skus, ["sku_a"]);
  assert.equal((await f.snapshots())[0].completedAt.toISOString(), (event.payload as { purchased_at: string }).purchased_at);
});
test("a global client cannot masquerade as the transaction participant", async () => {
  const f = await arrange();
  assert.throws(() => new PrismaFiscalOrderParticipant(f.db, "homologation", f.tenants, { find: () => null }), /fiscal_order_transaction_required/);
});
test("failed late approval remains recoverable with its original awaiting intent and snapshot", async () => {
  const f = await arrange(); await f.useCase.execute(f.request); const original = (await f.snapshots())[0]; await f.approve();
  await fixture.sql.query("CREATE FUNCTION fiscal_test_late_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='fiscal.intent.queued' THEN RAISE EXCEPTION 'injected_late_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fiscal_test_late_failure BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fiscal_test_late_failure()");
  try { await assert.rejects(f.paid(), /injected_late_failure/); }
  finally { await fixture.sql.query("DROP TRIGGER fiscal_test_late_failure ON outbox_messages; DROP FUNCTION fiscal_test_late_failure()"); }
  assert.equal((await f.intents())[0].state, "awaiting_payment"); assert.equal((await f.snapshots())[0].paymentProofRef, null);
  assert.equal((await f.snapshots())[0].contentHash, original.contentHash); assert.equal(await f.outboxCount("order.completed"), 1);
  await f.paid(); assert.equal((await f.intents())[0].state, "queued"); assert.equal(await f.outboxCount("fiscal.intent.queued"), 1);
});
test("FISCAL-20 HTTP permits payment with complete buyer data and missing tax setup then persists paid fiscal action_required", async () => {
  const f = await arrange();
  await fixture.prisma.fiscalProfileVersion.delete({ where: { id: f.sale.profile.id } });
  const customer = { ...f.session.customer, asaasCustomerId: "synthetic_customer", fiscalRecipient: { name: "Original Recipient", taxId: "12ABC34501DE35",
    address: { street: "Rua Um", number: "10", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } } };
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.session.sessionId } }, data: { customer } });
  const support = { find: () => null };
  const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(f.db, "homologation", f.tenants),
    new FiscalProfileService(new PrismaFiscalProfileRepository(f.db), support));
  const provider = new class extends FakePaymentProvider {
    async createPayment(input: CreateProviderPaymentInput) {
      await fixture.sql.query("INSERT INTO synthetic_fiscal_checkout_charges VALUES ($1,$2,$3)", [input.intentId, input.merchantId, input.amountCents]);
      return super.createPayment(input);
    }
  }();
  currentPayment = new CreatePaymentIntentUseCase(f.repo, { getProfile: async () => ({}) } as never, new InMemoryPaymentRepository(f.repo), provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.db, undefined, undefined, undefined, undefined, undefined, gate);
  const response = await fetch(fixture.first.url + "/v1/payment/intents", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchant_id: f.sale.merchantId, session_id: f.session.sessionId, idempotency_key: "unconfigured_tax_sale", method: "pix" }) });
  assert.equal(response.status, 201); const body = await response.json(); assert.equal(body.amountCents, 1099);
  assert.equal(Number((await fixture.sql.query("SELECT count(*) FROM synthetic_fiscal_checkout_charges WHERE merchant_id=$1", [f.sale.merchantId])).rows[0].count), 1);
  await fixture.prisma.paymentIntent.create({ data: { id: body.id, merchantId: f.sale.merchantId, sessionId: f.session.sessionId,
    idempotencyKey: "unconfigured_tax_sale", amountCents: body.amountCents, approvedAmountCents: body.amountCents, currency: "BRL",
    method: "pix", status: "approved", providerPaymentId: body.providerPaymentId, amountBreakdown: body.amountBreakdown } });
  await f.useCase.executePaymentApproval({ ...f.request, external_order_id: body.providerPaymentId }, body.id);
  const intent = await fixture.prisma.fiscalIntent.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, orderId: body.providerPaymentId } });
  assert.equal(intent.state, "action_required"); assert.equal(intent.lastErrorCode, "fiscal_profile_unconfirmed");
  assert.equal(intent.writeStartedAt, null); assert.equal(intent.remoteInvoiceId, null);
  assert.equal(await f.outboxCount("fiscal.intent.queued"), 0); assert.equal(await fixture.prisma.fiscalDocument.count({ where: { merchantId: f.sale.merchantId } }), 0);
  const snapshot = await fixture.prisma.fiscalSaleSnapshot.findUniqueOrThrow({ where: { id: intent.snapshotId } });
  assert.equal(snapshot.totalCents, 1000); assert.equal(snapshot.paymentProofRef, body.id);
  assert.equal(readFiscalSnapshotEnvelope(snapshot.items).commercialLines[0].unitPriceCents, 1000);
  assert.deepEqual((await fixture.prisma.fiscalProfileVersion.findUniqueOrThrow({ where: { id: intent.profileVersionId } })).itemRules, {});
});


test("FISCAL-24 canonical paid funding excludes fiscal capture even when every store ID matches", async () => {
  const f = await arrange(true);
  const customer = { ...f.session.customer, email_verified: true, fiscalRecipient: { name: "Original Recipient", taxId: "12ABC34501DE35",
    address: { street: "Rua Um", number: "10", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } } };
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.session.sessionId } }, data: { customer } });
  const payment = await f.approve();
  const instructions = { version: 1, merchantId: f.sale.merchantId, sessionId: f.session.sessionId };
  const { createHash } = await import("node:crypto");
  await fixture.prisma.marketplaceFundingPlan.create({ data: { paymentIntentId: payment.id, hostMerchantId: f.sale.merchantId,
    checkoutSessionId: f.session.sessionId, provider: "stripe", environment: "test", accountFingerprint: f.sale.merchantId + "_funding",
    providerPaymentId: payment.providerPaymentId, amountCents: payment.amountCents, instructions,
    instructionsHash: createHash("sha256").update(JSON.stringify(instructions)).digest("hex") } });
  await f.paid();
  assert.deepEqual(await f.snapshots(), []); assert.deepEqual(await f.intents(), []);
  const order = await fixture.prisma.completedOrder.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, externalOrderId: f.sale.orderId } });
  assert.equal(order.orderTotal.toNumber(), 10); assert.equal((order.lineItemsJson as any[]).length, 1);
  assert.equal((await fixture.prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status, "approved");
  assert.equal(await f.outboxCount("order.completed"), 1); assert.equal(await f.outboxCount("fiscal.intent.queued"), 0);
  const event = await fixture.prisma.outboxMessage.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, eventType: "order.completed" } });
  assert.equal((event.payload as any).fiscal_stock_ownership, undefined);
  assert.equal((await fixture.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: f.sale.connection.id } })).stockOwner, "provider");
  assert.equal((await fixture.prisma.marketplaceFundingPlan.findUniqueOrThrow({ where: { paymentIntentId: payment.id } })).amountCents, 1000);
});
