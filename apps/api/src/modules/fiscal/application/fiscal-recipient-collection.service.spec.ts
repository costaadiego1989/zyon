import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { FiscalRecipientCollectionService } from "./fiscal-recipient-collection.service.js";
import { PrismaFiscalRecipientCollectionRepository } from "../infrastructure/prisma-fiscal-recipient-collection.repository.js";
import { PrismaFiscalRecipientRepository } from "../infrastructure/prisma-fiscal-recipient.repository.js";
import { FiscalBeforePaymentService } from "./fiscal-before-payment.service.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalCheckoutReader } from "../infrastructure/prisma-fiscal-checkout.reader.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { SendChatMessageUseCase } from "../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CheckoutWhatsAppConversationAdapter } from "../../whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
import { ViaCepFiscalAddressLookup } from "../infrastructure/viacep-fiscal-address.lookup.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { fixture = await createFiscalFixture(); }, { timeout: 120_000 });
after(async () => { await fixture?.close(); });
async function arrange(lookup = true) {
  const sale = await seedFiscalSale(fixture); const sessionId = sale.completedOrder.sessionId;
  const cart = { currency: "BRL", total: 10, items: [{ sku: "sku_a", name: "Camiseta", price: 10, quantity: 1, productType: "physical" }] };
  await fixture.prisma.checkoutSession.update({ where: { merchantId_sessionId: { merchantId: sale.merchantId, sessionId } }, data: { cart,
    customer: { fiscalRecipientMode: "other", fullName: "Comprador", cpf: "52998224725", email: "buyer@example.test", email_verified: true, fiscalRecipient: {} } } });
  await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
  const sessions = new PrismaFiscalRecipientRepository(fixture.prisma);
  const repository = new PrismaFiscalRecipientCollectionRepository(fixture.prisma);
  const gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(fixture.prisma, "homologation", new TenantContextService()),
    new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => undefined }));
  const postal = { lookup: async () => lookup ? { postalCode: "01001000", street: "Rua Um", neighborhood: "Centro", city: "Sao Paulo", state: "SP", cityCode: "3550308", countryCode: "1058" } : null };
  const service = new FiscalRecipientCollectionService(repository, gate, postal);
  const chat = new SendChatMessageUseCase(sessions as never, {} as never, {} as never, {} as never, {} as never,
    { loadContext: async () => ({ session: await sessions.getSession(sale.merchantId, sessionId) }) } as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, service);
  const adapter = new CheckoutWhatsAppConversationAdapter(chat, sessions as never);
  const buyerId = fixture.tag + "_buyer";
  const raw = (message: string, messageId?: string) => service.handle({ merchantId: sale.merchantId, sessionId, userMessage: message, buyerId, messageId });
  const say = (message: string, requestId?: string) => adapter.respond({ merchantId: sale.merchantId, checkoutSessionId: sessionId, message, requestId });
  const current = () => sessions.getSession(sale.merchantId, sessionId);
  const complete = async () => { for (const [index, message] of ["Quero pagar com Pix", "Empresa Compradora", "12abc34501de35", "01001000", "Confirmar endereço da nota", "12", "Confirmar dados fiscais"].entries()) await say(message, "flow_" + index); };
  return { sale, sessionId, cart, buyerId, service, repository, gate, raw, say, current, complete };
}
test("WhatsApp actual chat collects only supplied confirmed fiscal recipient before payment", async () => {
  const f = await arrange(); const first = await f.say("Quero pagar com Pix", "start"); assert.match(first.agentMessage, /nome|razão social/i);
  for (const [index, value] of ["Empresa Compradora", "12abc34501de35", "01001000", "Confirmar endereço da nota", "12"].entries()) await f.say(value, "value_" + index);
  const draft = await f.current(); assert.deepEqual(draft!.customer!.fiscalRecipient, {});
  const done = await f.say("Confirmar dados fiscais", "confirm"); assert.match(done.agentMessage, /salvos.*forma de pagamento/i);
  const stored = await f.current(); assert.deepEqual(stored!.customer!.fiscalRecipient, { name: "Empresa Compradora", taxId: "12ABC34501DE35", address: {
    postalCode: "01001000", street: "Rua Um", neighborhood: "Centro", city: "Sao Paulo", state: "SP", cityCode: "3550308", countryCode: "1058", number: "12" } });
  assert.equal(stored!.customer!.cpf, "52998224725"); assert.deepEqual(stored!.cart, f.cart);
  assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
  await f.gate.assertBeforePayment(stored!); assert.equal(await f.raw("Pix", "next_payment_action"), undefined);
});
test("WhatsApp invalid fiscal identifier remains requested until buyer corrects it", async () => {
  const f = await arrange(); await f.say("Pix"); await f.say("Empresa Compradora");
  assert.match((await f.say("11111111111")).agentMessage, /CPF|CNPJ/);
  assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
  assert.match((await f.say("12ABC34501DE35")).agentMessage, /CEP/);
});
test("WhatsApp repeated provider message recovers its response without assigning the value to another field", async () => {
  const f = await arrange(); await f.say("Pix", "first"); const first = await f.say("Empresa Compradora", "message_name");
  const repeat = await f.say("Empresa Compradora", "message_name"); assert.deepEqual(repeat, first);
  assert.match(repeat.agentMessage, /CPF|CNPJ/);
  await f.complete(); const original = await f.current();
  const done = await f.say("Confirmar dados fiscais", "flow_6"); assert.match(done.agentMessage, /salvos/);
  assert.deepEqual((await f.current())!.customer!.fiscalRecipient, original!.customer!.fiscalRecipient);
  assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
test("fiscal chat refuses another buyer before requesting or persisting recipient data", async () => {
  const f = await arrange(); await assert.rejects(f.service.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId,
    userMessage: "Pix", buyerId: "other_buyer" }), /ownership/);
  assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
});
test("fiscal chat refuses an unbound visitor or another merchant session", async () => {
  const f = await arrange();
  await assert.rejects(f.service.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, userMessage: "Pix" }), /ownership/);
  await assert.rejects(f.service.handle({ merchantId: "other_merchant", sessionId: f.sessionId, userMessage: "Pix", buyerId: f.buyerId }), /ownership/);
  assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
});
test("inactive fiscal chat does not interrupt the existing commercial conversation", async () => {
  const f = await arrange(); await fixture.prisma.fiscalConnection.update({ where: { id: f.sale.connection.id }, data: { isActive: false } });
  assert.equal(await f.raw("Pix"), undefined); assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
});
test("missing tax profile still guides buyer data and leaves fiscal transmission pending", async () => {
  const f = await arrange(); await fixture.prisma.fiscalIntent.delete({ where: { id: f.sale.intent.id } });
  await fixture.prisma.fiscalProfileVersion.delete({ where: { id: f.sale.profile.id } }); await f.complete();
  const stored = await f.current(); assert.equal(stored!.customer!.fiscalRecipient!.taxId, "12ABC34501DE35");
  await f.gate.assertBeforePayment(stored!); assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
test("WhatsApp CEP lookup failure asks for retry without asking for an IBGE code or inventing an address", async () => {
  const f = await arrange(false); for (const value of ["Pix", "Empresa Compradora", "12ABC34501DE35"]) await f.say(value);
  const response = await f.say("01001000"); assert.match(response.agentMessage, /CEP.*novamente|novamente.*CEP/i);
  assert.doesNotMatch(response.agentMessage, /IBGE|3550308|Rua Um/); assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
});
test("WhatsApp address lookup is displayed for confirmation and a corrected CEP cannot reuse old municipality", async () => {
  const f = await arrange(); for (const value of ["Pix", "Empresa Compradora", "12ABC34501DE35"]) await f.say(value);
  const response = await f.say("01001000"); assert.match(response.agentMessage, /Rua Um.*Sao Paulo.*SP/s); assert.ok(response.quickReplies.includes("Confirmar endereço da nota"));
  assert.match((await f.say("Corrigir CEP")).agentMessage, /CEP/); assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {});
});
test("fiscal chat persistence failure cannot report recipient saved or create a payment", async () => {
  const f = await arrange(); const failing = new FiscalRecipientCollectionService({ read: f.repository.read.bind(f.repository), save: async () => { throw new Error("synthetic_collection_write_failure"); } }, f.gate, { lookup: async () => null });
  await assert.rejects(failing.handle({ merchantId: f.sale.merchantId, sessionId: f.sessionId, buyerId: f.buyerId, userMessage: "Pix" }), /synthetic_collection_write_failure/);
  assert.deepEqual((await f.current())!.customer!.fiscalRecipient, {}); assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
test("domestic fiscal CEP lookup supplies the documented Brazil country code without buyer technical input", async () => {
  const lookup = new ViaCepFiscalAddressLookup((async () => Response.json({ logradouro: "Rua Um", bairro: "Centro", localidade: "Sao Paulo", uf: "SP", ibge: "3550308" })) as typeof fetch);
  assert.deepEqual(await lookup.lookup("01001000"), { postalCode: "01001000", street: "Rua Um", neighborhood: "Centro", city: "Sao Paulo", state: "SP", cityCode: "3550308", countryCode: "1058" });
});
test("after fiscal confirmation a new payment command can continue even without a provider message ID", async () => {
  const f = await arrange();
  for (const value of ["Pix", "Empresa Compradora", "12ABC34501DE35", "01001000", "Confirmar endereço da nota", "12", "Confirmar dados fiscais"]) await f.say(value);
  assert.equal(await f.raw("Pix"), undefined);
  assert.equal(await fixture.prisma.paymentIntent.count({ where: { merchantId: f.sale.merchantId } }), 0);
});
