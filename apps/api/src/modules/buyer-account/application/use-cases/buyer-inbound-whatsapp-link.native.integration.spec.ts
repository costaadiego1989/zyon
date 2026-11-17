import "reflect-metadata";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { BuyerChannelIdentityService } from "../services/buyer-channel-identity.service.js";
import { BuyerInboundWhatsAppLinkUseCase } from "./buyer-inbound-whatsapp-link.use-case.js";
import { LinkBuyerWhatsAppUseCase } from "./link-buyer-whatsapp.use-case.js";
import { PrismaBuyerAccountRepository } from "../../infrastructure/prisma-buyer-account.repository.js";
import { PrismaWhatsAppSessionRepository } from "../../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-session.repository.js";
import { PrismaWhatsAppWebhookInbox } from "../../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";
import { HandleMetaConversationUseCase } from "../../../whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js";
import type { IncomingMessageInput } from "../../../whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js";
import type { WhatsAppConversationState } from "../../../whatsapp-channel/domain/ui/meta-ui.types.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => db.$disconnect());
const key = (token: string) => "link-inbound:" + createHash("sha256").update(token).digest("hex");

async function fixture(t: TestContext) {
  const merchantId = "qa_native_link_" + randomUUID(), buyerId = "qa_native_link_" + randomUUID();
  const phone = "55119" + randomInt(10000000, 99999999), conversationId = randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "QA inbound" } });
  await db.buyerAccount.create({ data: { globalUserId: buyerId, email: buyerId + "@example.test", passwordHash: "local-test-password-hash", displayName: "QA" } });
  const config = await db.whatsAppChannelConfig.create({ data: { merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE", whatsappNumber: "5511999999999" } });
  const identities = new BuyerChannelIdentityService(db), accounts = new PrismaBuyerAccountRepository(db);
  const links = new LinkBuyerWhatsAppUseCase(identities, {} as any, accounts, { execute: async () => assert.fail("inbound linking never sends an OTP") } as any);
  const service = new BuyerInboundWhatsAppLinkUseCase(identities, accounts, links);
  const challenge = await service.create(buyerId, phone, merchantId), deviceId = "META_CLOUD:" + config.id;
  const native = await db.whatsAppSession.create({ data: { merchantId, deviceId, buyerPhone: phone, status: "active", conversationState: {
    version: 1, conversationId, stage: "store", history: [], revision: "", page: 0, previousViews: [{ title: "Previous", body: "Previous", choices: [], media: [], blocks: [], quickReplies: [] }],
  } } });
  t.after(async () => {
    await db.$executeRaw`DELETE FROM buyer_verified_phones WHERE buyer_id=${buyerId}`;
    await db.buyerPhoneOtp.deleteMany({ where: { OR: [{ phone: key(challenge.token) }, { codeHash: key(challenge.token) }] } });
    await db.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
    await db.whatsAppSession.deleteMany({ where: { merchantId } });
    await db.buyerIdentity.deleteMany({ where: { merchantId } });
    await db.merchant.delete({ where: { id: merchantId } });
    await db.buyerAccount.delete({ where: { globalUserId: buyerId } });
  });
  const sessions = new PrismaWhatsAppSessionRepository(db), inbox = new PrismaWhatsAppWebhookInbox(db), sent: any[] = [];
  const handler = new HandleMetaConversationUseCase({ respondStore: async () => assert.fail("account challenge cannot reach store agent/RAG") } as any,
    sessions, inbox, { sendUi: async (message: any) => { sent.push(message); return { status: "sent", messageId: randomUUID() }; } } as any,
    undefined, undefined, undefined, service);
  async function message(body: string, interactiveId?: string) {
    const payload = { merchantId, deviceId, fromNumber: phone, body, provider: "META_CLOUD", messageType: interactiveId ? "interactive" : "text", timestamp: Date.now(), ...(interactiveId ? { interactiveId } : {}) };
    const row = await db.whatsAppWebhookInbox.create({ data: { merchantId, configId: config.id, deviceId, kind: "message", dedupKey: randomUUID(),
      eventId: randomUUID(), streamKey: merchantId + phone, payload, payloadHash: "qa", status: "processing", leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 120_000) } });
    const claim = { ...row, kind: "message" as const, payload, leaseToken: row.leaseToken! };
    const input: IncomingMessageInput = { ...payload, inboxClaim: claim };
    return { input, row };
  }
  const state = async () => (await sessions.findActiveByPhone(merchantId, phone, deviceId))!.conversationState!;
  async function run(input: IncomingMessageInput) {
    const current = (await sessions.findActiveByPhone(merchantId, phone, deviceId))!;
    await handler.execute(input, { whatsappSession: current, isNew: false, buyerData: { globalUserId: "native-guest", phone, phoneVerified: true } });
    return state();
  }
  async function prompt() {
    const initial = await message("Vincular minha conta " + challenge.token);
    const current = await run(initial.input);
    assert.equal((await identities.status(buyerId)).linked, false);
    assert.equal((await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(challenge.token) } })).consumedAt, null);
    const entries = Object.entries(current.selections!);
    assert.deepEqual(current.view!.choices.map(c => c.label), ["Confirmar vínculo", "Cancelar vínculo"]);
    assert.deepEqual(entries.map(([, a]) => a.kind === "message" ? a.message.split(" ")[0] : a.kind).sort(), ["cancelar_vinculo", "confirmar_vinculo"]);
    assert.match(current.view!.body, /q\*\*\*@example\.test/); assert.match(current.view!.body, /apenas se você iniciou/);
    assert.equal(current.view!.body.includes(buyerId), false);
    return { current, confirm: entries.find(([, a]) => a.kind === "message" && a.message.startsWith("confirmar_vinculo "))![0], cancel: entries.find(([, a]) => a.kind === "message" && a.message.startsWith("cancelar_vinculo "))![0] };
  }
  const unchanged = async () => {
    assert.equal(await db.checkoutSession.count({ where: { merchantId } }), 0);
    assert.equal(await db.paymentIntent.count({ where: { merchantId } }), 0);
    assert.equal(await db.completedOrder.count({ where: { merchantId } }), 0);
  };
  return { merchantId, buyerId, phone, conversationId, config, identities, accounts, service, links, challenge, native, sent, message, run, state, prompt, unchanged };
}

test("C2/C4 actual native handler prompts, persists explicit buttons and atomically binds the current authenticated sender once", async t => {
  const f = await fixture(t), p = await f.prompt(), confirmation = await f.message("Confirmar vínculo", p.confirm);
  const response = await f.run(confirmation.input);
  assert.match(response.view!.body, /WhatsApp confirmado/);
  assert.equal(await f.identities.verifiedAccount(f.phone), f.buyerId);
  const record = await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(f.challenge.token) } });
  assert.ok(record.consumedAt); assert.equal(record.attempts, 1); assert.equal(JSON.parse(record.codeHash).phase, "confirmed");
  assert.deepEqual(await f.service.status(f.buyerId, f.challenge.token), { status: "confirmed", linked: true, phone: "+55 (***) *****-" + f.phone.slice(-4) });
  const prior = structuredClone(record);
  const replay = await f.message("Confirmar vínculo", p.confirm);
  const result = await f.service.handle(replay.input, p.current);
  assert.match(result!.agentMessage, /Não foi possível/);
  assert.deepEqual(await db.buyerPhoneOtp.findUniqueOrThrow({ where: { id: record.id } }), prior);
  assert.equal(await f.identities.verifiedAccount(f.phone), f.buyerId); await f.unchanged();
});

test("C3 cancellation consumes the challenge without linking or granting consent", async t => {
  const f = await fixture(t), p = await f.prompt(), cancelled = await f.message("Cancelar vínculo", p.cancel);
  assert.match((await f.run(cancelled.input)).view!.body, /Solicitação cancelada/);
  assert.deepEqual(await f.service.status(f.buyerId, f.challenge.token), { status: "cancelled", linked: false, phone: null });
  assert.equal((await f.identities.status(f.buyerId)).linked, false); await f.unchanged();
});

for (const variant of ["plain_text", "missing_claim", "lease", "expired_lease", "processed", "payload", "sender", "genuine_wrong_phone", "merchant", "config", "conversation", "stale_selection", "expired", "cancelled"])
  test("C3 native confirmation rejects " + variant + " without consuming or binding", async t => {
    const f = await fixture(t), p = await f.prompt(), m = await f.message("Confirmar vínculo", p.confirm);
    const input: any = structuredClone(m.input), current: WhatsAppConversationState = structuredClone(p.current);
    if (variant === "plain_text") { delete input.interactiveId; input.body = "confirmar_vinculo " + f.challenge.token; }
    if (variant === "missing_claim") delete input.inboxClaim;
    if (variant === "lease") input.inboxClaim.leaseToken = randomUUID();
    if (variant === "expired_lease") await db.whatsAppWebhookInbox.update({ where: { id: m.row.id }, data: { leaseExpiresAt: new Date(0) } });
    if (variant === "processed") await db.whatsAppWebhookInbox.update({ where: { id: m.row.id }, data: { status: "processed" } });
    if (variant === "payload") input.body = "forged body";
    if (variant === "sender") input.fromNumber = "5511999999999";
    if (variant === "genuine_wrong_phone") {
      input.fromNumber = "5511999999999";
      const { inboxClaim: _claim, ...payload } = input;
      await db.whatsAppWebhookInbox.update({ where: { id: m.row.id }, data: { payload } });
      input.inboxClaim.payload = payload;
    }
    if (variant === "merchant") input.merchantId = "other-merchant";
    if (variant === "config") await db.whatsAppChannelConfig.update({ where: { id: f.config.id }, data: { enabled: false } });
    if (variant === "conversation") current.conversationId = randomUUID();
    if (variant === "stale_selection") await db.whatsAppSession.update({ where: { id: f.native.id }, data: { conversationState: { ...current, selections: {} } as any } });
    const where = { phone: key(f.challenge.token) };
    if (variant === "expired") await db.buyerPhoneOtp.update({ where, data: { expiresAt: new Date(0) } });
    if (variant === "cancelled") { const row = await db.buyerPhoneOtp.findUniqueOrThrow({ where }); await db.buyerPhoneOtp.update({ where, data: { consumedAt: new Date(), codeHash: JSON.stringify({ ...JSON.parse(row.codeHash), phase: "cancelled" }) } }); }
    const before = await db.buyerPhoneOtp.findUniqueOrThrow({ where });
    const response = await f.service.handle(input, current);
    assert.match(response!.agentMessage, /Não foi possível/);
    assert.equal(await f.identities.verifiedAccount(f.phone), null);
    assert.deepEqual(await db.buyerPhoneOtp.findUniqueOrThrow({ where }), before); await f.unchanged();
  });

test("C4 simultaneous confirmations commit one possession proof and one consumption", async t => {
  const f = await fixture(t), p = await f.prompt(), a = await f.message("Confirmar vínculo", p.confirm), b = await f.message("Confirmar vínculo", p.confirm);
  const results = await Promise.all([f.service.handle(a.input, p.current), f.service.handle(b.input, p.current)]);
  assert.equal(results.filter(r => /WhatsApp confirmado/.test(r!.agentMessage)).length, 1);
  assert.equal(results.filter(r => /Não foi possível/.test(r!.agentMessage)).length, 1);
  assert.equal(await f.identities.verifiedAccount(f.phone), f.buyerId);
  assert.equal((await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(f.challenge.token) } })).attempts, 1); await f.unchanged();
});

test("C4 conflicting owner and failed consumption roll back the entire identity transaction", async t => {
  const f = await fixture(t), p = await f.prompt(), m = await f.message("Confirmar vínculo", p.confirm);
  const originalBind = f.identities.bind.bind(f.identities);
  t.mock.method(f.identities, "bind", async (tx, buyer, phone, verification) => { await originalBind(tx, buyer, phone, verification); throw Error("owned rollback probe"); });
  const before = await db.buyerPhoneOtp.findUniqueOrThrow({ where: { phone: key(f.challenge.token) } });
  await assert.rejects(f.service.handle(m.input, p.current), /owned rollback probe/);
  assert.equal(await f.identities.verifiedAccount(f.phone), null);
  assert.deepEqual(await db.buyerPhoneOtp.findUniqueOrThrow({ where: { id: before.id } }), before);
  t.mock.restoreAll();
  await db.$executeRaw`INSERT INTO buyer_verified_phones(phone,buyer_id,verification_id) VALUES(${f.phone},${"foreign-qa-owner"},${randomUUID()})`;
  try {
    assert.match((await f.service.handle(m.input, p.current))!.agentMessage, /Não foi possível/);
    assert.equal(await f.identities.verifiedAccount(f.phone), "foreign-qa-owner");
    assert.deepEqual(await db.buyerPhoneOtp.findUniqueOrThrow({ where: { id: before.id } }), before);
  } finally { await db.$executeRaw`DELETE FROM buyer_verified_phones WHERE phone=${f.phone} AND buyer_id='foreign-qa-owner'`; }
  await f.unchanged();
});
