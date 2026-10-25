import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PrismaRecoveryTemplateLifecycleRepository } from "./prisma-recovery-template-lifecycle.repository.js";
import { PrismaScheduledMessageRepository } from "../../../post-sale/infrastructure/repositories/prisma-scheduled-message.repository.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
import { salesDefaults } from "../../domain/sales-template-content.js";

// Opt-in local database test; never uses the application's DATABASE_URL.
test("sales template versions and concurrent dispatch on disposable PostgreSQL", async t => {
  const require = createRequire(import.meta.url);
  const { PrismaClient: TestClient } = require(process.env.SALES_TEST_CLIENT || "SALES_TEST_CLIENT_must_point_to_an_isolated_generated_client");
  const db = new TestClient({ datasources: { db: { url: "postgresql://sales_test:sales_local_test@127.0.0.1:55443/sales_templates" } } });
  const merchantId = `sales-db-${randomUUID()}`;
  const repo = new PrismaRecoveryTemplateLifecycleRepository(db as PrismaClient);
  const messages = new PrismaScheduledMessageRepository(db as PrismaClient);
  try {
    await t.test("every native scenario is idempotent and has one authoritative positional body", async () => {
      for (const type of WHATSAPP_TEMPLATE_TYPES) {
        await repo.ensure(merchantId, type);
        await repo.ensure(merchantId, type);
        const pair = await repo.read(merchantId, type);
        assert.equal(pair.whatsapp.metaStatus, "draft");
        assert.ok(pair.whatsapp.metaTemplateBody);
        assert.deepEqual(pair.whatsapp.metaApprovedVersions, []);
      }
      assert.equal(await db.postSaleMessageTemplate.count({ where: { merchantId } }), WHATSAPP_TEMPLATE_TYPES.length * 2);
    });
    await t.test("editing archives approval, rollback preserves history and rejects stale forms", async () => {
      const type = "win_back";
      const where = { merchantId_type_channel: { merchantId, type, channel: "whatsapp" } };
      await db.postSaleMessageTemplate.update({ where, data: { metaStatus: "approved", twilioContentSid: "approved_v1", metaWabaId: "123456789", metaLastCheckedAt: new Date() } });
      const original = (await repo.read(merchantId, type)).whatsapp;
      await repo.save(merchantId, { email: salesDefaults(type).email, whatsapp: { body: "Olá {{buyerName}}, veja as novidades da {{storeName}}.", revision: 1 } }, type);
      let current = (await repo.read(merchantId, type)).whatsapp;
      assert.equal(current.metaStatus, "draft");
      assert.equal(current.twilioContentSid, null);
      assert.equal(current.metaApprovedVersions?.length, 1);
      await db.postSaleMessageTemplate.update({ where, data: { metaStatus: "approved", twilioContentSid: "approved_v2", metaWabaId: "123456789", metaLastCheckedAt: new Date() } });
      current = (await repo.read(merchantId, type)).whatsapp;
      await repo.restore(current, current.metaApprovedVersions![0], new Date());
      const restored = (await repo.read(merchantId, type)).whatsapp;
      assert.equal(restored.metaRevision, 3);
      assert.equal(restored.body, original.body);
      assert.equal(restored.twilioContentSid, "approved_v1");
      assert.equal(restored.metaApprovedVersions?.length, 2);
      await assert.rejects(repo.restore(current, current.metaApprovedVersions![0], new Date()), /template_revision_conflict/);
    });
    await t.test("concurrent schedule creation and claiming produce one delivery candidate", async () => {
      const input = { merchantId, buyerId: "buyer", orderId: "order-1", type: "follow_up" as const, channel: "whatsapp" as const, sendAt: new Date(0), buyerEmail: "buyer@example.invalid" };
      const created = await Promise.all([messages.create(input), messages.create(input)]);
      assert.equal(created[0].id, created[1].id);
      const claims = await Promise.all([messages.findPendingDue(20), messages.findPendingDue(20)]);
      assert.equal(claims.flat().filter(m => m.id === created[0].id).length, 1);
      await messages.update(created[0].id, { status: "sent", channel: "email", providerMessageId: "email-accepted", sentAt: new Date() });
      const sent = await db.postSaleScheduledMessage.findUnique({ where: { id: created[0].id } });
      assert.equal(sent.channel, "email");
      assert.equal(sent.providerMessageId, "email-accepted");
    });
    await t.test("expired processing is held as unknown and never dispatched again", async () => {
      const msg = await messages.create({ merchantId, buyerId: "buyer", orderId: "order-2", type: "review_request", channel: "whatsapp", sendAt: new Date(0) });
      await db.postSaleScheduledMessage.update({ where: { id: msg.id }, data: { status: "processing", processingAt: new Date(0) } });
      assert.equal((await messages.findPendingDue(20)).some(m => m.id === msg.id), false);
      const held = await db.postSaleScheduledMessage.findUnique({ where: { id: msg.id } });
      assert.equal(held.status, "unknown");
      assert.equal(held.failureReason, "processing_lease_expired");
    });
    await t.test("reorder dedup preserves distinct products in one order", async () => {
      const input = { merchantId, buyerId: "buyer", orderId: "order-3", type: "reorder" as const, channel: "whatsapp" as const, sendAt: new Date() };
      const one = await messages.create({ ...input, metadata: { sku: "SKU-A" } });
      const duplicate = await messages.create({ ...input, metadata: { sku: "SKU-A" } });
      const two = await messages.create({ ...input, metadata: { sku: "SKU-B" } });
      assert.equal(one.id, duplicate.id);
      assert.notEqual(one.id, two.id);
    });
  } finally {
    await db.postSaleScheduledMessage.deleteMany({ where: { merchantId } });
    await db.postSaleMessageTemplate.deleteMany({ where: { merchantId } });
    await db.merchantNotification.deleteMany({ where: { merchantId } });
    await db.$disconnect();
  }
});
