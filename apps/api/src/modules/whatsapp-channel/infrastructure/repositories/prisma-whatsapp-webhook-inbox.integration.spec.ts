import "reflect-metadata";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ConflictException } from "@nestjs/common";
import { PrismaWhatsAppWebhookInbox } from "./prisma-whatsapp-webhook-inbox.repository.js";
import { AcceptBubbleWhatsWebhookUseCase } from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { WhatsAppWebhookWorker } from "../../application/services/whatsapp-webhook-worker.service.js";
import { HandleIncomingMessageUseCase } from "../../application/use-cases/handle-incoming-message.use-case.js";
import { SendWhatsAppResponseUseCase } from "../../application/use-cases/send-whatsapp-response.use-case.js";
import type { WhatsAppInboxEvent } from "../../domain/ports/whatsapp-webhook-inbox.port.js";

const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;

describe("BubbleWhats durable inbox (PostgreSQL)", { skip: !clientPath || !databaseUrl }, () => {
  let prisma: any;
  let repository: PrismaWhatsAppWebhookInbox;
  let accept: AcceptBubbleWhatsWebhookUseCase;
  const merchantId = `audit_wa_${randomUUID()}`;
  const otherMerchantId = `audit_wa_${randomUUID()}`;
  const config = {
    id: `config_${randomUUID()}`, merchantId, deviceId: `device_${randomUUID()}`, enabled: true,
    provider: "BUBBLEWHATS", webhookSecret: "test-whatsapp-integration-secret", credentials: {},
    status: "ACTIVE", createdAt: new Date(), updatedAt: new Date(),
  };
  const message = (id = "event-1", fromNumber = "5511999999999") => ({
    id, deviceID: config.deviceId, fromNumber, body: "oi", isGroup: false,
    timestamp: 1_750_000_000, messageType: "text",
  });
  const rows = () => prisma.whatsAppWebhookInbox.findMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } }, orderBy: { createdAt: "asc" } });

  before(async () => {
    const parsed = new URL(databaseUrl!);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/ready_prod_test");
    const { PrismaClient } = createRequire(import.meta.url)(clientPath!);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    repository = new PrismaWhatsAppWebhookInbox(prisma);
    accept = new AcceptBubbleWhatsWebhookUseCase({ findByDeviceId: async () => config } as any, repository);
  });
  beforeEach(async () => {
    await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
  });
  after(async () => {
    if (!prisma) return;
    await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
    await prisma.$disconnect();
  });

  it("40 concurrent provider deliveries persist one event and 20 workers claim it once", async () => {
    await Promise.all(Array.from({ length: 40 }, () => accept.message(config.webhookSecret, message())));
    assert.equal((await rows()).length, 1);
    const claims = (await Promise.all(Array.from({ length: 20 }, () => repository.claimNext()))).filter(Boolean);
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.attempts, 1);
    assert.equal(await repository.complete(claims[0]!), true);
    await accept.message(config.webhookSecret, message());
    assert.equal((await rows())[0].status, "processed");
    assert.equal(await repository.claimNext(), null);
  });

  it("rejects a changed payload and atomically rolls back other inserts in a colliding batch", async () => {
    await accept.message(config.webhookSecret, message());
    await assert.rejects(accept.message(config.webhookSecret, { ...message(), body: "different" }), ConflictException);
    const stored = (await rows())[0];
    const event = {
      dedupKey: stored.dedupKey, eventId: stored.eventId, kind: stored.kind,
      merchantId, configId: stored.configId, deviceId: stored.deviceId, streamKey: stored.streamKey,
      payload: stored.payload, payloadHash: stored.payloadHash,
    } as WhatsAppInboxEvent;
    await assert.rejects(repository.accept([
      { ...event, dedupKey: `000_${randomUUID()}`, eventId: "new-before-conflict" },
      { ...event, payloadHash: "changed" },
    ]), ConflictException);
    assert.equal((await rows()).length, 1);
    assert.equal((await rows())[0].payload.body, "oi");
  });

  it("uses config and merchant in dedup identity and deduplicates status transitions across batch permutations", async () => {
    await accept.message(config.webhookSecret, message());
    const other = new AcceptBubbleWhatsWebhookUseCase({ findByDeviceId: async () => ({ ...config, id: "other-config", merchantId: otherMerchantId }) } as any, repository);
    await other.message(config.webhookSecret, message());
    const status = (id: string, value: number) => ({ key: { id, remoteJid: "buyer@s.whatsapp.net", fromMe: true }, update: { status: value } });
    const messages = [status("message-1", 3), status("message-1", 4)];
    await accept.status(config.webhookSecret, { deviceID: config.deviceId, messages });
    await accept.status(config.webhookSecret, { deviceID: config.deviceId, messages: [...messages].reverse() });
    assert.equal((await rows()).length, 4);
    assert.equal((await rows()).filter((row: any) => row.kind === "status").length, 2);
  });

  it("reclaims an expired lease and fences every write from the stale worker", async () => {
    await accept.message(config.webhookSecret, message());
    const first = (await repository.claimNext())!;
    assert.equal(await repository.renew(first), true);
    await prisma.whatsAppWebhookInbox.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(0) } });
    const restarted = new PrismaWhatsAppWebhookInbox(prisma);
    const second = (await restarted.claimNext())!;
    assert.equal(second.id, first.id);
    assert.notEqual(second.leaseToken, first.leaseToken);
    assert.equal(second.attempts, 2);
    assert.equal(await repository.renew(first), false);
    assert.equal(await repository.complete(first), false);
    assert.equal(await repository.fail(first, "stale failure"), false);
    assert.equal(await restarted.complete(second), true);
  });

  it("blocks later messages of the same buyer while another buyer can progress", async () => {
    await accept.message(config.webhookSecret, message("first"));
    await accept.message(config.webhookSecret, message("second"));
    await accept.message(config.webhookSecret, message("other", "5511888888888"));
    const all = await rows();
    for (const row of all) {
      const offset = row.eventId === "first" ? 1 : row.eventId === "second" ? 2 : 3;
      await prisma.whatsAppWebhookInbox.update({ where: { id: row.id }, data: { createdAt: new Date(offset * 1000) } });
    }
    const first = (await repository.claimNext())!;
    assert.equal(first.eventId, "first");
    const other = (await repository.claimNext())!;
    assert.equal(other.eventId, "other");
    assert.equal(await repository.claimNext(), null);
    await repository.complete(first);
    assert.equal((await repository.claimNext())!.eventId, "second");
    await repository.complete(other);
  });

  it("persists retry backoff and dead-letters the final failure and final-attempt crash", async () => {
    await accept.message(config.webhookSecret, message());
    for (let attempt = 1; attempt <= 10; attempt++) {
      const current = (await repository.claimNext())!;
      assert.ok(current);
      assert.equal(current.attempts, attempt);
      assert.equal(await repository.fail(current, "provider_unavailable"), true);
      assert.equal(await repository.claimNext(), null);
      if (attempt < 10) await prisma.whatsAppWebhookInbox.update({ where: { id: current.id }, data: { availableAt: new Date(0) } });
    }
    assert.equal((await rows())[0].status, "dead");
    await accept.message(config.webhookSecret, message());
    assert.equal((await rows())[0].status, "dead");
    await accept.message(config.webhookSecret, message("crash"));
    const crashed = (await repository.claimNext())!;
    await prisma.whatsAppWebhookInbox.update({ where: { id: crashed.id }, data: { attempts: 10, leaseExpiresAt: new Date(0) } });
    assert.equal(await repository.claimNext(), null);
    assert.equal((await rows()).find((row: any) => row.id === crashed.id).lastError, "lease_expired_attempts_exhausted");
  });

  it("a real incoming/send pipeline failure survives worker restart and succeeds on retry", async () => {
    await accept.message(config.webhookSecret, message());
    let sends = 0;
    const incoming = new HandleIncomingMessageUseCase({} as any, {
      execute: async () => ({ whatsappSession: { id: "session-1", checkoutSessionId: "checkout-1", currentOptions: [], previousOptions: [], currentPage: 0 } }),
    } as any, new SendWhatsAppResponseUseCase({ sendText: async () => ({ status: ++sends === 1 ? "failed" : "sent", messageId: "provider-reference" }) }),
    { updateMenuState: async () => {} } as any);
    const worker = () => new WhatsAppWebhookWorker(new PrismaWhatsAppWebhookInbox(prisma), { findByDeviceId: async () => config } as any, incoming, {} as any);
    await worker().drain();
    let stored = (await rows())[0];
    assert.equal(stored.status, "pending");
    assert.equal(stored.attempts, 1);
    assert.equal(stored.lastError, "whatsapp_inbox_processing_failed");
    await prisma.whatsAppWebhookInbox.update({ where: { id: stored.id }, data: { availableAt: new Date(0) } });
    await worker().drain();
    stored = (await rows())[0];
    assert.equal(stored.status, "processed");
    assert.equal(stored.attempts, 2);
    assert.equal(sends, 2);
  });

  it("preserves accepted events while disabled and resumes after configuration restoration", async () => {
    await accept.message(config.webhookSecret, message());
    let enabled = false;
    let messages = 0;
    const worker = new WhatsAppWebhookWorker(repository, { findByDeviceId: async () => ({ ...config, enabled }) } as any,
      { execute: async () => { messages++; } } as any, {} as any);
    await worker.drain();
    const stored = (await rows())[0];
    assert.equal(stored.status, "pending");
    assert.equal(messages, 0);
    enabled = true;
    await prisma.whatsAppWebhookInbox.update({ where: { id: stored.id }, data: { availableAt: new Date(0) } });
    await worker.drain();
    assert.equal((await rows())[0].status, "processed");
    assert.equal(messages, 1);
  });

  it("applies the actual additive migration in a separate schema with unique and status constraints", async () => {
    const { Client } = createRequire(import.meta.url)("pg");
    const client = new Client({ connectionString: databaseUrl });
    const schema = `wa_migration_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(readFileSync(new URL("../../../../../prisma/migrations/20260905230000_whatsapp_webhook_inbox/migration.sql", import.meta.url), "utf8"));
      const sql = `INSERT INTO whatsapp_webhook_inbox (id,dedup_key,event_id,kind,merchant_id,config_id,device_id,stream_key,payload,payload_hash) VALUES ($1,'key','event','message','merchant','config','device','stream','{}','hash')`;
      await client.query(sql, ["one"]);
      await assert.rejects(client.query(sql, ["two"]), (error: any) => error.code === "23505");
      await assert.rejects(client.query("UPDATE whatsapp_webhook_inbox SET status='invalid'"), (error: any) => error.code === "23514");
      assert.equal((await client.query("SELECT status,attempts FROM whatsapp_webhook_inbox")).rows[0].status, "pending");
    } finally {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
});
