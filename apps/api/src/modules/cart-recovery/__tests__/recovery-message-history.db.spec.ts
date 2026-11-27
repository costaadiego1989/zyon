import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { RecoveryMessageJournal } from "../infrastructure/recovery-message-journal.js";
import { RecoveryAttemptDetailsService } from "../application/recovery-attempt-details.service.js";
import { SendWhatsAppMessageUseCase } from "../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { HandleStatusUpdateUseCase } from "../../whatsapp-channel/application/use-cases/handle-status-update.use-case.js";

test("recovery history on isolated local PostgreSQL", async t => {
  const db = new PrismaClient({ datasources: { db: { url: "postgresql://recovery_history:recovery_history_local@127.0.0.1:15449/recovery_history" } } });
  const merchantId = `history-${randomUUID()}`, foreign = `foreign-${randomUUID()}`, buyerId = `buyer-${randomUUID()}`;
  const id = `rec_history_${randomUUID()}`, correlationId = id;
  const snapshot = { name: "Ana Original", email: "original@example.test", phone: "+5511999991111", recipient: "+5511999991111", body: "Olá, Ana! Carrinho https://example.test/cart", subject: null, template: "recovery_v1" };
  const journal = new RecoveryMessageJournal(db), service = new RecoveryAttemptDetailsService(db);
  try {
    await db.merchant.createMany({ data: [{ id: merchantId, name: "History test" }, { id: foreign, name: "Other test" }] });
    await db.buyerAccount.create({ data: { globalUserId: buyerId, email: "current-" + buyerId + "@example.test", displayName: "Ana Atual", phone: "+5511888882222" } });
    await db.recoveryAttempt.createMany({ data: Array.from({ length: 16 }, (_, i) => ({ id: i === 0 ? id : `${id}-${i}`, merchantId, sessionId: `session-${id}-${i}`, globalUserId: buyerId, abandonmentReason: "hesitation", abandonmentScore: .8, strategyJson: { type: "personalized_cross_sell" }, channel: "whatsapp_template", status: "sent", sentAt: new Date(), createdAt: new Date(Date.now() - i * 1000) })) });
    await t.test("snapshots are encrypted before dispatch and retain the send-time contacts", async () => {
      const messageId = await journal.prepare(merchantId, correlationId, "whatsapp_template", snapshot, "config-a");
      const stored = await db.$queryRaw<Array<{ snapshot: string }>>(Prisma.sql`SELECT snapshot FROM recovery_messages WHERE id = ${messageId}`);
      assert.ok(stored[0].snapshot.startsWith("pii_v1:")); assert.ok(!stored[0].snapshot.includes("example.test"));
      await journal.complete(messageId, { status: "sent", messageId: "wamid.history" });
      const page = await service.list(merchantId, { limit: "10", offset: "0" });
      assert.equal(page.total, 16); assert.equal(page.data.length, 10);
      assert.deepEqual(page.data[0].customer, { name: snapshot.name, email: snapshot.email, phone: snapshot.phone });
      assert.equal(page.data[0].contact_source, "send_snapshot");
      assert.equal(page.data[1].customer.name, "Ana Atual"); assert.equal(page.data[1].contact_source, "current_profile");
      assert.equal((await service.list(merchantId, { limit: "10", offset: "10" })).data.length, 6);
      assert.equal((await service.list(foreign)).total, 0);
      await assert.rejects(service.detail(foreign, id), /recovery_attempt_not_found/);
      assert.equal((await service.list(merchantId, { channel: "email" })).total, 0);
    });
    await t.test("authenticated receipt needs the sending merchant, config, correlation and provider ID", async () => {
      const input = { merchantId, configId: "config-a", messageId: "wamid.history", status: "read", correlationId, timestamp: String(Math.floor(Date.now() / 1000)) };
      for (const change of [{ merchantId: foreign }, { configId: "foreign-config" }, { messageId: "wamid.foreign" }]) await journal.receipt({ ...input, ...change });
      assert.equal((await journal.list(merchantId, [id]))[0].status, "accepted");
      await new HandleStatusUpdateUseCase(db).receiveMetaReceipt(input);
      assert.equal((await service.detail(merchantId, id)).messages[0].status, "read");
      await journal.receipt({ ...input, status: "sent" }); await journal.receipt({ ...input, status: "failed", errorCode: 131049 });
      const message = (await journal.list(merchantId, [id]))[0]; assert.equal(message.status, "read"); assert.ok(message.read_at);
    });
    await t.test("receipt before the transport result survives completion and profile changes", async () => {
      const cid = `${id}-fast`;
      const record = await journal.prepare(merchantId, cid, "whatsapp_template", snapshot, "config-a");
      await journal.receipt({ merchantId, configId: "config-a", messageId: "wamid.fast", correlationId: cid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)) });
      await journal.complete(record, { status: "sent", messageId: "wamid.fast" });
      assert.equal((await journal.list(merchantId, [cid]))[0].status, "delivered");
      await journal.receipt({ merchantId, configId: "config-a", messageId: "wamid.fast", correlationId: cid, status: "read", timestamp: "999999999999" });
      assert.equal((await journal.list(merchantId, [cid]))[0].read_at, null);
    });
    await t.test("actual email sender journals rendered content and never fabricates delivery or opening", async () => {
      const cid = `${id}-email`, calls: any[] = [];
      const template = { merchantId, type: "cart_recovery", channel: "email", isActive: true, body: "Olá {{buyerName}}, seu link {{link}}", subject: "Retome sua compra" };
      const router = new SendWhatsAppMessageUseCase({ findByMerchantAndType: async () => template } as any, undefined, undefined,
        { send: async (message: any) => { calls.push(message); return { status: "sent", messageId: "email.history" }; } } as any, undefined, db);
      const result = await router.execute({ merchantId, correlationId: cid, type: "cart_recovery", fallbackEmail: "original@example.test", variables: { buyerName: "Ana", link: "https://example.test/cart" }, freeformText: "Original body" });
      assert.equal(result.status, "sent"); assert.equal(calls.length, 1);
      const message = (await journal.list(merchantId, [cid]))[0];
      assert.equal(message.body, "Olá Ana, seu link https://example.test/cart"); assert.equal(message.recipient, "original@example.test");
      assert.equal(message.status, "accepted"); assert.equal(message.delivered_at, null); assert.equal(message.read_at, null);
    });
    await t.test("WhatsApp follow-up binds the exact template and stores a receipt during dispatch", async () => {
      const follow = await db.recoveryFollowUp.create({ data: { merchantId, attemptId: id, sessionId: `session-${id}-0`, step: 1, dueAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } });
      const template = { id: "tpl", merchantId, type: "cart_recovery", channel: "whatsapp", isActive: true, metaStatus: "approved",
        twilioContentSid: "cart_v1", metaLanguage: "pt_BR", metaWabaId: "123456789", metaCategory: "MARKETING", metaRevision: 2,
        metaTemplateBody: "Olá {{1}}, retome {{2}}", metaVariableMap: { "1": "buyerName", "2": "link" } };
      const config = { id: "config-a", merchantId, enabled: true, status: "ACTIVE", provider: "META_CLOUD", credentials: { accessToken: "fixture", wabaId: "123456789", phoneNumberId: "987654321" } };
      let calls = 0;
      const router = new SendWhatsAppMessageUseCase({ findByMerchantAndType: async () => template } as any, { sendTemplate: async (input: any) => {
        calls++; assert.equal(input.expectedConnection.configId, config.id); assert.equal(input.expectedTemplate.revision, 2);
        await new HandleStatusUpdateUseCase(db).receiveMetaReceipt({ merchantId, configId: config.id, correlationId: input.correlationId, messageId: "wamid.follow", status: "read", timestamp: String(Math.floor(Date.now() / 1000)) });
        return { status: "sent", messageId: "wamid.follow" };
      } } as any, undefined, undefined, { findByMerchantId: async () => config } as any, db);
      await router.execute({ merchantId, correlationId: follow.id, type: "cart_recovery", toPhone: "11999991111", fallbackEmail: "ana@example.test", variables: { buyerName: "Ana", link: "https://example.test/cart" } });
      const detail = await service.detail(merchantId, id), message = detail.messages.find(m => m.correlation_id === follow.id)!;
      assert.equal(calls, 1); assert.equal(message.body, "Olá Ana, retome https://example.test/cart");
      assert.equal(message.recipient, "+5511999991111"); assert.equal(message.status, "read"); assert.ok(message.read_at);
      assert.equal(detail.follow_ups[0].id, follow.id);
    });
  } finally {
    await db.$executeRaw(Prisma.sql`DELETE FROM recovery_messages WHERE merchant_id IN (${merchantId}, ${foreign})`);
    await db.recoveryAttempt.deleteMany({ where: { merchantId: { in: [merchantId, foreign] } } });
    await db.buyerAccount.deleteMany({ where: { globalUserId: buyerId } }); await db.merchant.deleteMany({ where: { id: { in: [merchantId, foreign] } } }); await db.$disconnect();
  }
});
