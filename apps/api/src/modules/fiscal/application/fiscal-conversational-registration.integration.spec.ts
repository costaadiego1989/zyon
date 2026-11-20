import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { createFiscalConversationHarness } from "../../../../tests/fiscal-conversation-harness.js";
import { FiscalBeforePaymentService } from "./fiscal-before-payment.service.js";
import { FiscalRecipientPreparationService } from "./fiscal-recipient-preparation.service.js";
import { FiscalRecipientUpdateService } from "./fiscal-recipient-update.service.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import { PrismaFiscalCheckoutReader } from "../infrastructure/prisma-fiscal-checkout.reader.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalRecipientRepository } from "../infrastructure/prisma-fiscal-recipient.repository.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { deriveChatStage } from "../../checkout/domain/services/customer-extraction.service.js";
import type { CustomerHints } from "@zyon/shared-types";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../embed/domain/embed-checkout-session.js";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { FISCAL_SIGNED_PAYMENT_FIXTURE, FiscalSignedPaymentFixtureController, postFiscalSignedPayment,
  selectCurrentFiscalFixtureShipping, type FiscalSignedPaymentState } from "../../../../tests/fiscal-signed-payment.fixture.js";
let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
const tokens = new EmbedTokenService({ value: Buffer.from("fiscal-canonical-signed-fixture-secret-32") });
const signedState: FiscalSignedPaymentState = {};
before(async () => { fixture = await createFiscalFixture({ controllers: [FiscalSignedPaymentFixtureController], providers: [
  { provide: FISCAL_SIGNED_PAYMENT_FIXTURE, useValue: signedState }, { provide: EmbedTokenService, useValue: tokens }, EmbedAuthGuard,
] }); }, { timeout: 120000 });
after(async () => { await fixture?.close(); });
const complete: CustomerHints = { fullName: "Comprador Completo", email: "buyer@example.test", email_verified: true, cpf: "52998224725", phone: "31999999999", address_verified: true,
  address: { zip: "01001000", street: "Rua Um", number: "12", complement: "", neighborhood: "Centro", city: "Sao Paulo", state: "SP" } };
async function arrange(customer: CustomerHints = complete) {
  const sale = await seedFiscalSale(fixture); const now = Math.floor(Date.now() / 1000);
  const claims = { typ: "aacp_embed_v1" as const, merchantId: sale.merchantId, nonce: sale.orderId,
    issuedAtUnix: now, expiresAtUnix: now + 3600, allowedOrigin: "http://localhost:15174" };
  const token = tokens.sign({ ...claims, scopes: ["checkout:track", "payment:intents:create"] });
  const sessionId = embedCheckoutSessionId(tokens.verify(token));
  const cart = { currency: "BRL", total: 100, currentDiscount: 0, items: [{ sku: "sku_a", name: "Camiseta", price: 50, quantity: 2, productType: "physical" }] };
  await fixture.prisma.checkoutSession.create({ data: { merchantId: sale.merchantId, sessionId, globalUserId: "trusted_buyer", conversationId: sessionId, customer: customer as never, cart, shipping: { customerPrice: 0, method: "free" }, createdAt: new Date(), updatedAt: new Date() } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  const store = new PrismaFiscalRecipientRepository(fixture.prisma); const postal = { lookup: async () => ({ street: "Rua Um", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" }) };
  const preparation = new FiscalRecipientPreparationService(store, postal); const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(fixture.prisma, "homologation", new TenantContextService()), new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => undefined }), preparation);
  const prepare = new FiscalRecipientUpdateService(store, gate, postal, preparation); await prepare.prepare({ merchantId: sale.merchantId, sessionId });
  let charges = 0; let paymentError: unknown;
  const payment = { execute: async (input: { method: string }) => {
    try {
    const session = await harness.sessions.getSession(sale.merchantId, sessionId); assert.notEqual(deriveChatStage(session!), "data_collection"); await gate.assertBeforePayment(session!);
    const stored = await store.getSession(sale.merchantId, sessionId); assert.equal(stored!.customer!.cpf, "52998224725"); assert.equal(stored!.customer!.fiscalRecipient!.taxId, "52998224725"); assert.deepEqual(stored!.cart, cart);
    charges++; return { id: "synthetic_" + charges, merchantId: sale.merchantId, sessionId, status: "requires_action", method: input.method, amountCents: 10000, currency: "BRL", buyerFacing: { qrCodeCopyPaste: "synthetic_no_value" } };
    } catch (error) { paymentError = error; throw error; }
  } };
  const harness = createFiscalConversationHarness(fixture.prisma, gate, postal, payment as never);
  signedState.sessions = harness.sessions; signedState.payment = payment as never;
  const session = () => harness.sessions.getSession(sale.merchantId, sessionId);
  const say = (text: string) => harness.chat.execute({ merchant_id: sale.merchantId, session_id: sessionId, user_message: text }, { checkoutSessionBound: true });
  const selectShipping = () => selectCurrentFiscalFixtureShipping({ session, say });
  const postPayment = (overrides: { session_id?: string } = {}, access = token) => postFiscalSignedPayment(fixture.first.url, access,
    { session_id: sessionId, idempotency_key: "canonical_explicit_pix", method: "pix", ...overrides });
  const pay = async () => { const response = await postPayment(); assert.equal(response.status, 201); const body = await response.json();
    assert.equal(body.merchantId, sale.merchantId); assert.equal(body.sessionId, sessionId); assert.equal(body.amountCents, 10000);
    assert.equal(body.currency, "BRL"); assert.equal(body.method, "pix"); assert.equal(body.status, "requires_action");
    assert.equal(body.buyerFacing.qrCodeCopyPaste, "synthetic_no_value"); return body; };
  return { ...harness, sale, say, session, selectShipping, postPayment, pay,
    noPaymentToken: tokens.sign({ ...claims, scopes: ["checkout:track"] }),
    charges: () => charges, paymentError: () => paymentError, cart };
}
test("FISCAL-76 canonical guest conversation persists email OTP name CPF phone before one synthetic payment", async () => { const f = await arrange({}); const replies: string[] = []; const say = async (text: string) => { const result = await f.say(text); replies.push(result.message); return result; };
  await say("Quero continuar"); await say("31999999999"); await say("newbuyer@example.test"); assert.notEqual((await f.session())!.customer!.email_verified, true); await say("000000"); assert.notEqual((await f.session())!.customer!.email_verified, true);
  await say((await f.session())!.customer!.otp_code!); await say("Meu nome e Comprador Novo"); await say("52998224725");
  await say("01001000"); await say("Sim"); await say("12"); await say("Nao tenho complemento"); await f.selectShipping(); assert.equal(f.charges(), 0);
  const beforePayment = (await f.session())!; assert.equal(beforePayment.customer!.email_verified, true); assert.equal(beforePayment.customer!.cpf, "52998224725"); assert.equal(beforePayment.customer!.fiscalCollection, undefined);
  await say("Pix"); assert.equal(f.charges(), 0); await f.pay(); assert.equal(f.charges(), 1); assert.deepEqual((await f.session())!.cart, f.cart); assert.equal(replies.some(text => /dados fiscais|destinat.rio da nota|endere.o da nota/i.test(text)), false);
});
test("missing personal CPF uses canonical extraction without a fiscal draft or second confirmation", async () => { const f = await arrange({ ...complete, cpf: undefined }); const first = await f.say("Pix"); assert.match(first.message, /CPF/); assert.equal((await f.session())!.customer!.fiscalCollection, undefined); await f.say("52998224725"); assert.equal((await f.session())!.customer!.cpf, "52998224725"); assert.equal((await f.session())!.customer!.fiscalCollection, undefined); assert.equal(f.charges(), 0); await f.selectShipping(); await f.say("Pix"); assert.equal(f.charges(), 0); await f.pay(); assert.equal(f.charges(), 1); });
test("invalid existing buyer CPF can be corrected through the same canonical conversation", async () => { const f = await arrange({ ...complete, cpf: "11111111111" }); await f.say("Quero continuar"); assert.equal(deriveChatStage((await f.session())!), "data_collection"); await f.say("12345678900"); assert.equal((await f.session())!.customer!.cpf, "11111111111"); assert.equal(f.charges(), 0); await f.say("52998224725"); assert.equal((await f.session())!.customer!.cpf, "52998224725"); await f.selectShipping(); await f.say("Pix"); assert.equal(f.charges(), 0); await f.pay(); assert.equal(f.charges(), 1); });
test("complete authenticated session reaches payment without reasking identity or fiscal confirmation", async () => { const f = await arrange(); const reply = await f.say("Pix"); assert.equal(f.paymentError(), undefined); assert.equal(reply.stage, "payment"); assert.equal(f.charges(), 0);
  assert.equal((await f.postPayment({ session_id: "foreign_session" })).status, 401);
  assert.equal((await f.postPayment({}, f.noPaymentToken)).status, 403); assert.equal(f.charges(), 0);
  await f.pay(); assert.equal(f.charges(), 1); assert.equal((await f.session())!.customer!.fiscalCollection, undefined); assert.equal((await f.session())!.customer!.cpf, complete.cpf); });
test("unverified email cannot become registered because other fields are present", async () => { const f = await arrange({ ...complete, email_verified: false }); await f.say("Quero continuar"); await f.say("Pix"); assert.equal(f.charges(), 0); assert.notEqual((await f.session())!.customer!.email_verified, true); assert.equal(deriveChatStage((await f.session())!), "data_collection"); });
test("normal address number gap is collected in shipping instead of a fiscal form", async () => {
  for (const complement of ["", "Casa"]) {
    const f = await arrange({ ...complete, address: { ...complete.address, number: "", complement } });
    await f.say("Quero continuar"); const addressReply = await f.say("12"); assert.equal(addressReply.stage, "shipping");
    const reply = await f.selectShipping(); assert.ok(reply); const stored = (await f.session())!;
    assert.equal(stored.customer!.address!.number, "12"); assert.equal(stored.customer!.address!.complement, complement);
    assert.equal(stored.customer!.fiscalCollection, undefined); assert.equal(reply.stage, "payment"); assert.doesNotMatch(reply.message, /tem complemento/i); assert.equal(f.charges(), 0);
  }
});
test("canonical buyer collection preserves a valid existing personal CPF against another typed identifier", async () => { const f = await arrange(); await f.customer.processCustomerInput((await f.session())!, "11144477735", "Qual seu CPF?", "Loja"); assert.equal((await f.session())!.customer!.cpf, "52998224725"); assert.equal(f.charges(), 0); });
