import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PrismaRecoveryTemplateLifecycleRepository } from "./prisma-recovery-template-lifecycle.repository.js";
import { RECOVERY_TEMPLATE_DEFAULTS } from "../../domain/recovery-template-content.js";
import { RecoveryTemplateLifecycleUseCase } from "../../application/use-cases/recovery-template-lifecycle.use-case.js";
import type { WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

// Explicit-only integration suite; prepare-lifecycle-db.mjs generates this isolated client.
// The URL is intentionally fixed to a disposable local database, never DATABASE_URL.
test("recovery template lifecycle on disposable PostgreSQL", async (t) => {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const { PrismaClient: TestClient } = require(path.join(process.cwd(), ".audit/recovery-lifecycle-prisma/client/index.js"));
  const db = new TestClient({ datasources: { db: { url: "postgresql://recovery_test:recovery_test_local@127.0.0.1:55439/recovery_lifecycle" } } });
  const repo = new PrismaRecoveryTemplateLifecycleRepository(db as PrismaClient);
  const merchants: string[] = [];
  const merchant = async () => { const id = `lifecycle-test-${randomUUID()}`; merchants.push(id); await repo.ensure(id); return id; };
  const edit = (revision: number, body = "Retome aqui {{link}}") => ({ email: { ...RECOVERY_TEMPLATE_DEFAULTS.email }, whatsapp: { body, revision } });
  const set = (merchantId: string, data: Record<string, unknown>) => db.postSaleMessageTemplate.update({
    where: { merchantId_type_channel: { merchantId, type: "cart_recovery", channel: "whatsapp" } }, data,
  });
  try {
    await t.test("migration defaults and seeding preserve tenant content", async () => {
      const id = await merchant();
      const second = await merchant();
      const first = await repo.read(id);
      assert.equal(first.whatsapp.metaRevision, 1);
      assert.equal(first.whatsapp.metaStatus, "draft");
      assert.ok(first.whatsapp.metaNextCheckAt instanceof Date);
      await repo.save(id, edit(1));
      await Promise.all([repo.ensure(id), repo.ensure(id)]);
      assert.equal((await repo.read(id)).whatsapp.body, "Retome aqui {{link}}");
      assert.equal((await repo.read(second)).whatsapp.body, RECOVERY_TEMPLATE_DEFAULTS.whatsapp.body);
      assert.equal(await db.postSaleMessageTemplate.count({ where: { merchantId: id } }), 2);
    });
    await t.test("WhatsApp edit atomically invalidates SID/approval and prepares submitted variables", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "approved", twilioContentSid: "HX-old", metaLastCheckedAt: new Date() });
      await repo.save(id, edit(1, "Oi {{buyerName}}, retome {{link}}"));
      const row = (await repo.read(id)).whatsapp;
      assert.equal(row.metaRevision, 2);
      assert.equal(row.metaStatus, "draft");
      assert.equal(row.twilioContentSid, null);
      assert.equal(row.metaLastCheckedAt, null);
      assert.equal(row.metaTemplateBody, "Oi {{1}}, retome {{2}}");
      assert.deepEqual(row.metaVariableMap, { "1": "buyerName", "2": "link" });
      assert.equal(row.metaCategory, "MARKETING");
    });
    await t.test("email-only edits preserve WhatsApp approval but advance form version", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "approved", twilioContentSid: "HX-current" });
      await repo.save(id, { email: { subject: "Novo assunto", body: "Seu link: {{link}}" }, whatsapp: { body: RECOVERY_TEMPLATE_DEFAULTS.whatsapp.body, revision: 1 } });
      const row = await repo.read(id);
      assert.equal(row.whatsapp.metaRevision, 2);
      assert.equal(row.whatsapp.metaStatus, "approved");
      assert.equal(row.whatsapp.twilioContentSid, "HX-current");
      assert.equal(row.email.subject, "Novo assunto");
    });
    await t.test("concurrent edits have one winner and losing transaction cannot alter email", async () => {
      const id = await merchant();
      const a = { ...edit(1, "Texto A {{link}}"), email: { subject: "A", body: "A {{link}}" } };
      const b = { ...edit(1, "Texto B {{link}}"), email: { subject: "B", body: "B {{link}}" } };
      const results = await Promise.allSettled([repo.save(id, a), repo.save(id, b)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const state = await repo.read(id);
      assert.equal(state.email.subject, state.whatsapp.body.includes("Texto A") ? "A" : "B");
      assert.equal(state.whatsapp.metaRevision, 2);
    });
    await t.test("two database claims authorize only one content create", async () => {
      const id = await merchant();
      const one = (await repo.read(id)).whatsapp;
      const two = (await repo.read(id)).whatsapp;
      const results = await Promise.all([repo.claim(one, new Date(), true), repo.claim(two, new Date(), true)]);
      assert.equal(results.filter(Boolean).length, 1);
      await assert.rejects(repo.save(id, edit(1)), /template_submission_in_progress/);
    });
    await t.test("approval for an edited revision cannot restore its old SID or notify", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "submitted", twilioContentSid: "HX-old" });
      const old = (await repo.read(id)).whatsapp;
      assert.equal(await repo.claim(old, new Date(), false), true);
      await repo.save(id, edit(1));
      await repo.complete(old, { status: "approved", checkedAt: new Date(), nextCheckAt: new Date() }, false);
      assert.equal((await repo.read(id)).whatsapp.metaStatus, "draft");
      assert.equal((await repo.read(id)).whatsapp.twilioContentSid, null);
      assert.equal(await db.merchantNotification.count({ where: { merchantId: id } }), 0);
    });
    await t.test("expired monitor claim cannot overwrite a newer claim", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "submitted", twilioContentSid: "HX-current" });
      const first = (await repo.read(id)).whatsapp;
      await repo.claim(first, new Date(0), false);
      const next = (await repo.read(id)).whatsapp;
      await repo.claim(next, new Date(), false);
      await repo.complete(first, { status: "approved", nextCheckAt: new Date() }, false);
      assert.equal((await repo.read(id)).whatsapp.metaStatus, "submitted");
      await repo.complete(next, { status: "rejected", nextCheckAt: new Date() }, false);
      assert.equal((await repo.read(id)).whatsapp.metaStatus, "rejected");
    });
    await t.test("status and notification persist once in the same transaction", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "submitted", twilioContentSid: "HX-current" });
      const row = (await repo.read(id)).whatsapp;
      await repo.claim(row, new Date(), false);
      await Promise.all([repo.complete(row, { status: "approved", checkedAt: new Date(), nextCheckAt: new Date() }, false), repo.complete(row, { status: "approved", checkedAt: new Date(), nextCheckAt: new Date() }, false)]);
      const notices = await db.merchantNotification.findMany({ where: { merchantId: id } });
      assert.equal(notices.length, 1);
      assert.equal(notices[0].metadata.emailStatus, "pending");
      assert.equal(notices[0].metadata.status, "approved");
      assert.equal((await repo.read(id)).whatsapp.metaStatus, "approved");
    });
    await t.test("crash while submitting is held after restart, never recreated", async () => {
      const id = await merchant();
      await set(id, { metaStatus: "submitting", metaNextCheckAt: new Date(0) });
      let sent = 0;
      const lifecycle = new RecoveryTemplateLifecycleUseCase(repo, { createAndSubmit: async () => { sent++; throw new Error("must not submit"); }, syncStatus: async () => { throw new Error("must not sync"); } }, {} as WhatsAppConfigRepository);
      await lifecycle.processDue();
      const row = (await repo.read(id)).whatsapp;
      assert.equal(row.metaStatus, "submission_unknown");
      assert.equal(row.metaNextCheckAt, null);
      assert.equal(sent, 0);
    });
  } finally {
    await db.postSaleMessageTemplate.deleteMany({ where: { merchantId: { in: merchants } } });
    await db.merchantNotification.deleteMany({ where: { merchantId: { in: merchants } } });
    await db.$disconnect();
  }
});
