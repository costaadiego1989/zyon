import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalRecipientPreparationService } from "./fiscal-recipient-preparation.service.js";
import { FiscalRecipientUpdateService } from "./fiscal-recipient-update.service.js";
import { FiscalBeforePaymentService } from "./fiscal-before-payment.service.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalRecipientRepository } from "../infrastructure/prisma-fiscal-recipient.repository.js";
import { PrismaFiscalCheckoutReader } from "../infrastructure/prisma-fiscal-checkout.reader.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { FiscalCheckoutController } from "../presentation/fiscal-checkout.controller.js";
import { BuyerJwtService } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { ResolveEmbedBuyerService } from "../../embed/application/resolve-embed-buyer.service.js";
import { PrismaBuyerAccountRepository } from "../../buyer-account/infrastructure/prisma-buyer-account.repository.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";
import { CheckoutBootstrapService } from "../../checkout/application/services/checkout-bootstrap.service.js";
import { PrismaCheckoutRepository } from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { FakePaymentProvider } from "../../payment/infrastructure/fake-payment-provider.js";
import { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../payment/application/get-payment-intent-status.use-case.js";
import { PaymentHttpController } from "../../payment/presentation/http/payment.controller.js";
import { checkoutScopeReader } from "../../checkout/__tests__/checkout-scope-reader.fixture.js";
import { unverifiedCustomerHints } from "../../checkout/application/services/checkout-input-policy.js";
import { PrismaFiscalOrderParticipant } from "../infrastructure/prisma-fiscal-order.participant.js";
import { FiscalRecipientCollectionService } from "./fiscal-recipient-collection.service.js";
import { PrismaFiscalRecipientCollectionRepository } from "../infrastructure/prisma-fiscal-recipient-collection.repository.js";
import { Prisma } from "@prisma/client";
import { CheckoutCustomerService } from "../../checkout/application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../checkout/application/services/checkout-shipping.service.js";
import { OtpService } from "../../checkout/application/services/otp.service.js";
import { ChatContextService } from "../../checkout/application/services/chat-context.service.js";
import { ChatResponseBuilder } from "../../checkout/application/services/chat-response.builder.js";
import { InterventionRuleTextBuilder } from "../../checkout/application/services/intervention-rule-text.builder.js";
import { SendChatMessageUseCase } from "../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CheckoutWhatsAppConversationAdapter } from "../../whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { SafeAuthorizedOffer } from "../../checkout/domain/types/safe-authorized-offer.js";
import { createFiscalConversationHarness, createFiscalOtpEmailFixture } from "../../../../tests/fiscal-conversation-harness.js";
import { FISCAL_SIGNED_PAYMENT_FIXTURE, FiscalSignedPaymentFixtureController, postFiscalSignedPayment,
  selectCurrentFiscalFixtureShipping, type FiscalSignedPaymentState } from "../../../../tests/fiscal-signed-payment.fixture.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let updater: FiscalRecipientUpdateService; let payer: CreatePaymentIntentUseCase;
const jwt = new BuyerJwtService("fiscal-minimal-buyer-secret-at-least-32");
const tokens = new EmbedTokenService({ value: Buffer.from("fiscal-minimal-embed-secret-at-least-32") });
const signedState: FiscalSignedPaymentState = {};
before(async () => { fixture = await createFiscalFixture({ controllers: [FiscalCheckoutController, PaymentHttpController, FiscalSignedPaymentFixtureController], providers: [
  { provide: FISCAL_SIGNED_PAYMENT_FIXTURE, useValue: signedState },
  { provide: FiscalRecipientUpdateService, useValue: { update: (...args: Parameters<FiscalRecipientUpdateService["update"]>) => updater.update(...args),
    prepare: (...args: Parameters<FiscalRecipientUpdateService["prepare"]>) => updater.prepare(...args) } },
  { provide: CreatePaymentIntentUseCase, useValue: { execute: (...args: Parameters<CreatePaymentIntentUseCase["execute"]>) => payer.execute(...args) } },
  { provide: GetPaymentIntentStatusUseCase, useValue: {} }, { provide: BuyerJwtService, useValue: jwt }, { provide: EmbedTokenService, useValue: tokens }, EmbedAuthGuard,
] }); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
const address = { zip: "01001000", street: "Rua Um", number: "12", complement: "Casa", neighborhood: "Centro", city: "Sao Paulo", state: "SP" };
async function arrange(options: { missingCpf?: boolean; fromAccount?: boolean } = {}) {
  const sale = await seedFiscalSale(fixture); const now = Math.floor(Date.now() / 1000); const buyerId = "buyer_" + sale.intent.id;
  const email = buyerId + "@example.test";
  await fixture.prisma.buyerAccount.create({ data: { globalUserId: buyerId, email, displayName: "Comprador Cadastrado", cpf: "52998224725", phone: "31999999999", address, asaasCustomerId: "synthetic_customer" } });
  const accounts = new PrismaBuyerAccountRepository(fixture.prisma); const resolver = new ResolveEmbedBuyerService(jwt, accounts);
  const buyerToken = jwt.sign({ globalUserId: buyerId, email, merchantId: sale.merchantId });
  const trusted = await resolver.resolve(sale.merchantId, buyerToken);
  const token = tokens.sign({ typ: "aacp_embed_v1", merchantId: sale.merchantId, nonce: sale.orderId, issuedAtUnix: now, expiresAtUnix: now + 3600,
    allowedOrigin: "http://localhost:15174", scopes: ["checkout:track", "payment:intents:create"] });
  const sessionId = embedCheckoutSessionId(tokens.verify(token)); const cart = { currency: "BRL" as const, total: 10, currentDiscount: 0, items: [{ sku: "sku_a", name: "Camiseta", price: 10, quantity: 1, productType: "physical" as const }] };
  const repository = new PrismaCheckoutRepository(fixture.prisma);
  const bootstrap = new CheckoutBootstrapService(repository as never, repository as never);
  await bootstrap.bootstrap({ merchant_id: sale.merchantId, session_id: sessionId, cart, customer: trusted!.customer,
    shipping: { customerPrice: 0, method: "Entrega confirmada", destinationZip: address.zip } }, buyerId, true,
    { trustedBuyer: trusted, requireBuyerProof: true });
  if (options.missingCpf) await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: sale.merchantId, sessionId } }, data: { customer: { ...trusted!.customer, cpf: "", address_verified: true } } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  const store = new PrismaFiscalRecipientRepository(fixture.prisma); let lookupCalls = 0;
  const postal = { lookup: async () => { lookupCalls++; return { postalCode: "01001000", street: "Rua Um", neighborhood: "Centro", city: "Sao Paulo", state: "SP", cityCode: "3550308", countryCode: "1058" }; } };
  const preparation = new FiscalRecipientPreparationService(store, postal);
  const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(fixture.prisma, "homologation", new TenantContextService()),
    new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => undefined }), preparation);
  updater = new FiscalRecipientUpdateService(store, gate, postal, preparation);
  const checkout = new InMemoryCheckoutRepository(); checkout.getSession = store.getSession.bind(store);
  const observedBeforeCharge: { recipient: unknown; cpf: string | undefined; cart: unknown }[] = [];
  let charges = 0; const provider = new class extends FakePaymentProvider { async createPayment(input: Parameters<FakePaymentProvider["createPayment"]>[0]) {
    const stored = await store.getSession(sale.merchantId, sessionId);
    observedBeforeCharge.push({ recipient: structuredClone(stored?.customer?.fiscalRecipient), cpf: stored?.customer?.cpf, cart: structuredClone(stored?.cart) });
    charges++; return super.createPayment(input);
  } }();
  payer = new CreatePaymentIntentUseCase(checkout, checkout, new InMemoryPaymentRepository(checkout), provider, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, checkoutScopeReader(checkout), undefined, undefined, undefined, undefined, undefined, gate);
  signedState.sessions = store; signedState.payment = payer;
  const post = (path: string, body: unknown) => fetch(fixture.first.url + "/v1/" + path, { method: "POST", headers: { "content-type": "application/json", "x-aacp-embed-token": token, origin: "http://localhost:15174" }, body: JSON.stringify({ session_id: sessionId, ...body as object }) });
  const pay = () => post("payment/intents", { merchant_id: sale.merchantId, idempotency_key: "buyer_reuse", method: "pix", global_user_id: "public_other_buyer", customer: { cpf: "11111111111" } });
  const signedPay = async () => {
    const response = await postFiscalSignedPayment(fixture.first.url, token, { session_id: sessionId, idempotency_key: "buyer_explicit_pix", method: "pix" });
    if (response.status === 201) {
      const body = await response.clone().json();
      assert.equal(body.merchantId, sale.merchantId); assert.equal(body.sessionId, sessionId); assert.equal(body.method, "pix");
      assert.equal(body.status, "requires_action"); assert.equal(body.currency, "BRL"); assert.equal(body.amountCents, 1099);
      assert.equal(body.amountBreakdown.itemsSubtotalCents, 1000); assert.equal(body.amountBreakdown.discountCents, 0);
      assert.equal(body.amountBreakdown.shippingCents, 0); assert.equal(body.amountBreakdown.platformFeeCents, 99);
      assert.equal(body.amountBreakdown.totalCents, 1099); assert.equal(body.buyerFacing.qrCodeCopyPaste, "fake_br_code");
    }
    return response;
  };
  return { sale, sessionId, buyerId, email, token, resolver, buyerToken, store, gate, postal, post, pay, signedPay, cart, observedBeforeCharge, charges: () => charges, lookupCalls: () => lookupCalls,
    session: () => store.getSession(sale.merchantId, sessionId) };
}
test("FISCAL-70 authenticated buyer data reaches first payment and normalized persisted recipient without recollection", async () => {
  const f = await arrange({ fromAccount: true }); const beforeCart = (await f.session())!.cart;
  const response = await f.pay(); assert.equal(response.status, 201); assert.equal(f.charges(), 1);
  const stored = (await f.session())!; assert.deepEqual(stored.cart, beforeCart);
  assert.deepEqual(stored.customer!.fiscalRecipient, { name: "Comprador Cadastrado", taxId: "52998224725", email: f.email, phone: "31999999999", address: {
    street: "Rua Um", number: "12", complement: "Casa", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" } });
  assert.equal(stored.customer!.cpf, "52998224725"); assert.equal(f.lookupCalls(), 1);
  assert.deepEqual(f.observedBeforeCharge, [{ recipient: stored.customer!.fiscalRecipient, cpf: "52998224725", cart: beforeCart }]);
  const prepared = await f.post("embed/customer/fiscal/prepare", {}); assert.equal(prepared.status, 201); const data = await prepared.json(); assert.deepEqual(data.fields, []); assert.equal(data.mode, "buyer");
  const externalOrderId = f.sale.orderId + "_normalized"; const completedAt = new Date("2026-11-14T15:00:00Z");
  const lines = [{ lineId: "line_a", sku: "sku_a", name: "Camiseta", quantity: 1, unitPriceCents: 1000, productType: "physical" as const }];
  await fixture.prisma.$transaction(async tx => {
    await tx.completedOrder.create({ data: { merchantId: f.sale.merchantId, sessionId: f.sessionId, externalOrderId, orderTotal: 10, currency: "BRL", completedAt, lineItemsJson: lines } });
    await new PrismaFiscalOrderParticipant(tx, "homologation", new TenantContextService(), { find: () => null }).record({ order: {
      merchantId: f.sale.merchantId, sessionId: f.sessionId, externalOrderId, orderTotal: 10, currency: "BRL", completedAt: completedAt.toISOString(), lineItems: lines,
    } as never, session: (await f.session())! });
  });
  const snapshot = await fixture.prisma.fiscalSaleSnapshot.findFirstOrThrow({ where: { merchantId: f.sale.merchantId, orderId: externalOrderId } });
  assert.deepEqual(snapshot.recipient, stored.customer!.fiscalRecipient); assert.equal(snapshot.buyerGlobalUserId, f.buyerId); assert.equal(snapshot.completedAt.toISOString(), completedAt.toISOString());
});
test("only missing personal CPF is requested and a saved correction does not charge", async () => {
  const f = await arrange({ missingCpf: true }); const response = await f.post("embed/customer/fiscal/prepare", {}); const data = await response.json();
  assert.deepEqual(data.fields, ["taxId"]); assert.equal(f.charges(), 0);
  const saved = await f.post("embed/customer/fiscal", { recipient: { taxId: "52998224725" } }); assert.equal(saved.status, 201);
  assert.equal((await f.session())!.customer!.cpf, "52998224725"); assert.equal(f.charges(), 0);
  assert.equal((await f.pay()).status, 201); assert.equal(f.charges(), 1);
});
test("other company recipient is explicit and never borrows personal name or CPF", async () => {
  const f = await arrange(); const selected = await f.post("embed/customer/fiscal/prepare", { mode: "other" });
  const data = await selected.json(); assert.equal(selected.status, 201); assert.ok(data.fields.includes("name")); assert.ok(data.fields.includes("taxId"));
  assert.deepEqual(data.recipient, {}); assert.equal((await f.pay()).status, 400); assert.equal(f.charges(), 0);
  const saved = await f.post("embed/customer/fiscal", { recipient: { name: "Empresa Compradora", taxId: "12ABC34501DE35", address: { ...address, zip: undefined, postalCode: address.zip, cityCode: "3550308" } } });
  assert.equal(saved.status, 201); const stored = (await f.session())!; assert.equal(stored.customer!.cpf, "52998224725"); assert.equal(stored.customer!.fiscalRecipient!.taxId, "12ABC34501DE35"); assert.equal(f.charges(), 0);
});
test("public global account ID and email hints cannot read or replace authenticated fiscal identity", async () => {
  const f = await arrange(); const other = await seedFiscalSale(fixture);
  await assert.rejects(f.resolver.resolve(other.merchantId, f.buyerToken), /merchant_mismatch/);
  const response = await f.post("embed/customer/fiscal/prepare", { global_user_id: "public_other_buyer", email: "other@example.test" });
  assert.equal(response.status, 400); assert.equal(f.charges(), 0); assert.equal((await f.session())!.globalUserId, f.buyerId);
  assert.deepEqual(unverifiedCustomerHints({ ...{ fullName: "Own Name" }, email_verified: true, fiscalRecipient: { name: "foreign secret" } }), { fullName: "Own Name" });
});
test("fiscal contact corrections never promote a new email or phone to verified personal identity", async () => {
  const f = await arrange(); const original = (await f.session())!.customer!;
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.sessionId } },
    data: { customer: { ...original, email: "", phone: "", email_verified: false, phone_verified: false, recognized_buyer: false } } });
  const saved = await f.post("embed/customer/fiscal", { recipient: { email: "nota@example.test", phone: "31988887777" } });
  assert.equal(saved.status, 201); const stored = (await f.session())!;
  assert.equal(stored.customer!.email, ""); assert.equal(stored.customer!.phone, ""); assert.equal(stored.customer!.email_verified, false);
  assert.equal(stored.customer!.phone_verified, false); assert.equal(stored.customer!.recognized_buyer, false);
  assert.equal(stored.customer!.fiscalRecipient!.email, "nota@example.test"); assert.equal(stored.globalUserId, f.buyerId); assert.equal(f.charges(), 0);
});
test("WhatsApp buyer collection reuses a complete recipient and asks only a missing CPF", async () => {
  const complete = await arrange();
  let collection = new FiscalRecipientCollectionService(new PrismaFiscalRecipientCollectionRepository(fixture.prisma), complete.gate, complete.postal);
  assert.equal(await collection.handle({ merchantId: complete.sale.merchantId, sessionId: complete.sessionId, userMessage: "Pix", buyerId: complete.buyerId }), undefined);
  const f = await arrange({ missingCpf: true });
  const canonical = createFiscalConversationHarness(fixture.prisma, f.gate, f.postal, payer);
  const adapter = new CheckoutWhatsAppConversationAdapter(canonical.chat, canonical.sessions);
  const say = (message: string, requestId: string) => adapter.respond({ merchantId: f.sale.merchantId, checkoutSessionId: f.sessionId, message, requestId });
  const first = await say("Pix", "first"); assert.match(first.agentMessage, /CPF/); assert.doesNotMatch(first.agentMessage, /nome|razão social|CEP/i);
  await say("52998224725", "cpf");
  assert.equal((await f.post("embed/customer/fiscal/prepare", {})).status, 201);
  assert.equal((await f.session())!.customer!.cpf, "52998224725"); assert.equal((await f.session())!.customer!.fiscalRecipient!.address!.cityCode, "3550308");
  await selectCurrentFiscalFixtureShipping({ session: f.session, say: message => say(message, "shipping_" + message) });
  assert.equal(f.charges(), 0); const charged = await f.signedPay(); assert.equal(charged.status, 201); assert.equal(f.charges(), 1);
  const firstIntent = await charged.json(), replay = await f.signedPay(); assert.equal(replay.status, 201);
  assert.equal((await replay.json()).id, firstIntent.id); assert.equal(f.charges(), 1);
});
test("WhatsApp company invoice starts only after an explicit other-recipient request", async () => {
  const f = await arrange(); const collection = new FiscalRecipientCollectionService(new PrismaFiscalRecipientCollectionRepository(fixture.prisma), f.gate, f.postal);
  const response = await collection.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, buyerId: f.buyerId, userMessage: "Quero a nota fiscal para outra empresa", messageId: "choose_company" });
  assert.match(response!.message, /nome|razão social/i); const stored = (await f.session())!;
  assert.equal(stored.customer!.fiscalRecipientMode, "other"); assert.deepEqual(stored.customer!.fiscalRecipient, {});
  assert.equal(stored.customer!.cpf, "52998224725"); assert.equal(f.charges(), 0);
  const next = await collection.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, buyerId: f.buyerId, userMessage: "Base", messageId: "company_name" });
  assert.match(next!.message, /CPF|CNPJ/); const draft = await fixture.prisma.checkoutSession.findUniqueOrThrow({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.sessionId } } });
  assert.equal((draft.customer as unknown as { fiscalCollection: { draft: { name: string } } }).fiscalCollection.draft.name, "Base"); assert.equal(f.charges(), 0);
});
test("public technical address codes cannot replace the server-resolved municipality or country", async () => {
  const f = await arrange(); await f.post("embed/customer/fiscal/prepare", {});
  const response = await f.post("embed/customer/fiscal", { recipient: { address: { cityCode: "0000000", countryCode: "9999" } } });
  assert.equal(response.status, 201); const stored = (await f.session())!;
  assert.equal(stored.customer!.fiscalRecipient!.address!.cityCode, "3550308"); assert.equal(stored.customer!.fiscalRecipient!.address!.countryCode, "1058");
  assert.equal(stored.customer!.cpf, "52998224725"); assert.equal(f.charges(), 0);
});
test("saving a missing CPF in the form lets the existing guided conversation resume payment", async () => {
  const f = await arrange({ missingCpf: true }); const collection = new FiscalRecipientCollectionService(new PrismaFiscalRecipientCollectionRepository(fixture.prisma), f.gate, f.postal);
  await collection.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, buyerId: f.buyerId, userMessage: "Pix", messageId: "first_pix" });
  assert.equal((await f.post("embed/customer/fiscal", { recipient: { taxId: "52998224725" } })).status, 201);
  assert.equal(await collection.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, buyerId: f.buyerId, userMessage: "Pix", messageId: "new_pix" }), undefined);
  assert.equal(f.charges(), 0); assert.equal((await f.pay()).status, 201); assert.equal(f.charges(), 1);
});

test("WhatsApp new buyer finishes canonical registration and shipping once before fiscal reuse and Pix", async () => {
  const f = await arrange();
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: f.sale.merchantId, sessionId: f.sessionId } },
    data: { customer: { asaasCustomerId: "synthetic_customer" }, shipping: Prisma.DbNull, shippingOptions: [] } });
  const sessions = new PrismaCheckoutRepository(fixture.prisma);
  await updater.prepare({ merchantId: f.sale.merchantId, sessionId: f.sessionId, mode: "buyer" });
  const otpEmails = createFiscalOtpEmailFixture();
  const customer = new CheckoutCustomerService(sessions, undefined, new OtpService(), undefined, undefined, otpEmails.sender);
  const shipping = new CheckoutShippingService(sessions, customer, { execute: async () => ({ id: "local_quote", quote_key: "local_quote_key",
    destination_zip: "01001000", expires_at: new Date(Date.now() + 3600000).toISOString(), results: [{ price: 0, label: "Entrega confirmada", source: "own_delivery", eta_days: 1 }] }) } as never,
    { toFetch: () => async () => Response.json({ logradouro: "Rua Um", bairro: "Centro", localidade: "Sao Paulo", uf: "SP", ibge: "3550308" }) } as never,
    undefined, fixture.prisma);
  const collection = new FiscalRecipientCollectionService(new PrismaFiscalRecipientCollectionRepository(fixture.prisma), f.gate, f.postal);
  let paymentError: unknown;
  const payment = { execute: async (input: Parameters<CreatePaymentIntentUseCase["execute"]>[0]) => {
    try { return await payer.execute(input); } catch (error) { paymentError = error; throw error; }
  } } as CreatePaymentIntentUseCase;
  signedState.payment = payment;
  const chat = new SendChatMessageUseCase(sessions, { reply: async () => ({ message: "Continuar", objection: "unknown" }) } as never,
    customer, shipping, { authorizeOffer: async () => SafeAuthorizedOffer.noOffer(f.sale.merchantId, f.sessionId) } as never,
    new ChatContextService(sessions, new InterventionRuleTextBuilder()), new ChatResponseBuilder(sessions, undefined, payment),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, collection, f.gate);
  const adapter = new CheckoutWhatsAppConversationAdapter(chat, sessions);
  let index = 0; const replies: string[] = [];
  const say = async (message: string) => { const reply = await adapter.respond({ merchantId: f.sale.merchantId, checkoutSessionId: f.sessionId, message, requestId: "canonical_" + index++ }); replies.push(reply.agentMessage); return reply; };
  await say("Pix");
  assert.equal((await f.session())!.customer!.fiscalCollection, undefined);
  await say("31999999999");
  await say("newbuyer@example.test");
  const challenge = (await f.session())!;
  assert.equal(otpEmails.accepted.length, 1);
  assert.equal(otpEmails.accepted[0].to, challenge.customer!.email);
  assert.equal(otpEmails.accepted[0].to, "newbuyer@example.test");
  assert.equal(otpEmails.accepted[0].requireDelivery, true);
  assert.ok(challenge.customer!.otp_code);
  assert.ok(otpEmails.accepted[0].html.includes(challenge.customer!.otp_code!));
  await say((await f.session())!.customer!.otp_code!);
  await say("Meu nome e Comprador Novo"); await say("52998224725");
  await say("01001000"); await say("Sim"); await say("12"); await say("Nao tenho complemento");
  await selectCurrentFiscalFixtureShipping({ session: f.session, say });
  const ready = (await f.session())!;
  assert.equal(ready.customer!.cpf, "52998224725"); assert.equal(ready.customer!.address!.number, "12"); assert.ok(ready.shipping);
  assert.equal(ready.customer!.fiscalCollection, undefined); assert.equal(f.charges(), 0);
  await say("Pix"); assert.equal(f.charges(), 0);
  const paid = await f.signedPay(); assert.equal(paid.status, 201); assert.equal(paymentError, undefined);
  const paymentBody = await paid.json(); assert.equal(paymentBody.buyerFacing.qrCodeCopyPaste, "fake_br_code"); assert.equal(f.charges(), 1);
  const stored = (await f.session())!;
  assert.equal(stored.customer!.fiscalRecipient!.taxId, "52998224725"); assert.equal(stored.customer!.fiscalRecipient!.address!.cityCode, "3550308");
  assert.deepEqual(stored.customer!.address, ready.customer!.address); assert.deepEqual(stored.cart, f.cart);
  assert.equal(replies.some(reply => /destinat.rio da nota|endere.o da nota|dados fiscais/i.test(reply)), false);
});
