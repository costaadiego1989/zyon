import "reflect-metadata";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaBuyerAccountRepository } from "../../../buyer-account/infrastructure/prisma-buyer-account.repository.js";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => db.$disconnect());
const address = { zip: "01310100", street: "Avenida Paulista", number: "1578", complement: "Apto 42",
  neighborhood: "Bela Vista", city: "São Paulo", state: "SP" };

async function fixture(t: TestContext) {
  const merchantId = "qa_returning_" + randomUUID(), buyerId = "qa_returning_" + randomUUID(), decoyId = "qa_returning_" + randomUUID();
  const phone = "55119" + randomInt(10000000, 99999999), conversationId = randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "QA returning buyer" } });
  await db.buyerAccount.create({ data: { globalUserId: buyerId, email: buyerId + "@example.test", passwordHash: "local-test-password-hash",
    displayName: "Compradora Vinculada", cpf: "52998224725", phone: null, address: { ...address, street: "Endereço antigo" } } });
  await db.buyerAccount.create({ data: { globalUserId: decoyId, email: decoyId + "@example.test", passwordHash: "local-test-password-hash",
    displayName: "Perfil com telefone editável", phone } });
  await db.buyerAddress.create({ data: { globalUserId: buyerId, label: "Casa", isDefault: true, ...address } });
  await db.buyerVerifiedPhone.create({ data: { phone, buyerId, verificationId: randomUUID() } });
  const config = await db.whatsAppChannelConfig.create({ data: { merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE", whatsappNumber: "5511999999999" } });
  const deviceId = "META_CLOUD:" + config.id;
  const native = await db.whatsAppSession.create({ data: { merchantId, deviceId, buyerPhone: phone, status: "active",
    conversationState: { version: 1, conversationId, stage: "store", history: [], revision: "", page: 0, previousViews: [] } } });
  const inbox = await db.whatsAppWebhookInbox.create({ data: { merchantId, configId: config.id, deviceId, kind: "message", dedupKey: randomUUID(),
    eventId: randomUUID(), streamKey: merchantId + phone, payload: { provider: "META_CLOUD", fromNumber: phone, body: "Finalizar compra" },
    payloadHash: "qa-returning", status: "processing", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000) } });
  t.after(async () => {
    await db.buyerVerifiedPhone.deleteMany({ where: { buyerId: { in: [buyerId, decoyId] } } });
    await db.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
    await db.whatsAppSession.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
    await db.buyerAccount.deleteMany({ where: { globalUserId: { in: [buyerId, decoyId] } } });
  });
  const accounts = new PrismaBuyerAccountRepository(db);
  let privateReads = 0;
  const findById = accounts.findByGlobalUserId.bind(accounts), findByPhones = accounts.findRegisteredByPhones.bind(accounts);
  accounts.findByGlobalUserId = async id => { privateReads++; return findById(id); };
  accounts.findRegisteredByPhones = async (phones, hint) => { privateReads++; return findByPhones(phones, hint); };
  const service = new WhatsAppCheckoutIdentityService(accounts, db);
  const input = { merchantId, conversationId, phone, verifiedSender: { inboxId: inbox.id, leaseToken: inbox.leaseToken!, deviceId, fromNumber: phone } };
  return { service, input, buyerId, decoyId, phone, native, inbox, config, privateReads: () => privateReads };
}

test("C1 persisted channel link selects the registered profile without a profile phone and above a different editable phone match", async t => {
  const f = await fixture(t), before = await db.buyerAccount.findUniqueOrThrow({ where: { globalUserId: f.buyerId } });
  const result = await f.service.recognize(f.input);
  assert.equal(result.status, "recognized"); if (result.status !== "recognized") assert.fail("linked account not recognized");
  assert.equal(result.buyer.globalUserId, f.buyerId);
  assert.equal(result.buyer.customer.fullName, "Compradora Vinculada"); assert.equal(result.buyer.customer.email, before.email);
  assert.equal(result.buyer.customer.cpf, "52998224725"); assert.equal(result.buyer.customer.phone, f.phone);
  assert.equal(result.buyer.customer.phone_verified, true); assert.equal(result.buyer.customer.email_verified, false);
  assert.deepEqual(result.buyer.customer.address, address); assert.equal(result.buyer.customer.address_verified, false);
  assert.deepEqual(await db.buyerAccount.findUniqueOrThrow({ where: { globalUserId: f.buyerId } }), before);
  assert.equal(await db.paymentIntent.count({ where: { merchantId: f.input.merchantId } }), 0);
});

test("C1 an email hint never overrides the owner of a verified channel link", async t => {
  const f = await fixture(t), other = await db.buyerAccount.findUniqueOrThrow({ where: { globalUserId: f.decoyId } });
  const result = await f.service.recognize({ ...f.input, emailHint: other.email });
  assert.equal(result.status, "recognized"); if (result.status === "recognized") assert.equal(result.buyer.globalUserId, f.buyerId);
});

for (const variant of ["expired lease", "wrong tenant", "wrong conversation", "wrong sender", "inactive channel", "no message proof"])
  test("C2 linked profile cannot be read with " + variant, async t => {
    const f = await fixture(t);
    if (variant === "expired lease") await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { leaseExpiresAt: new Date(0) } });
    if (variant === "wrong tenant") f.input.merchantId = "foreign_merchant";
    if (variant === "wrong conversation") f.input.conversationId = "foreign_cart";
    if (variant === "wrong sender") await db.whatsAppWebhookInbox.update({ where: { id: f.inbox.id }, data: { payload: { provider: "META_CLOUD", fromNumber: "5511990000000" } } });
    if (variant === "inactive channel") await db.whatsAppChannelConfig.update({ where: { id: f.config.id }, data: { enabled: false } });
    const result = await f.service.recognize(variant === "no message proof" ? { ...f.input, verifiedSender: undefined } : f.input);
    assert.deepEqual(result, { status: "unrecognized" }); assert.equal(f.privateReads(), 0);
  });

test("C2 conflicting verified owners of equivalent Brazilian phone forms stay ambiguous even with an email hint", async t => {
  const f = await fixture(t), alternate = f.phone.slice(0, 4) + f.phone.slice(5);
  await db.buyerVerifiedPhone.create({ data: { phone: alternate, buyerId: f.decoyId, verificationId: randomUUID() } });
  const result = await f.service.recognize({ ...f.input, emailHint: f.buyerId + "@example.test" });
  assert.equal(result.status, "ambiguous"); assert.equal("buyer" in result, false); assert.equal(f.privateReads(), 0);
});

test("C2 a deleted linked account cannot fall back to a different profile or temporary account", async t => {
  const f = await fixture(t);
  await db.buyerAccount.delete({ where: { globalUserId: f.buyerId } });
  const result = await f.service.recognize(f.input);
  assert.equal(result.status, "unrecognized"); assert.equal("buyer" in result, false);
});
