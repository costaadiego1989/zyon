import "reflect-metadata";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaOutboxRepository } from "../src/shared/messaging/infrastructure/prisma-outbox.repository.js";
import { OutboxDispatcher, OUTBOX_DISPATCHER_OPTIONS } from "../src/shared/messaging/outbox-dispatcher.service.js";
import { OUTBOX_REPOSITORY } from "../src/shared/messaging/ports/outbox.repository.port.js";
import { DOMAIN_EVENT_BUS } from "../src/shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { PrismaLifecycle } from "../src/shared/persistence/persistence.module.js";
import { createCheckoutEventEnvelope } from "../src/modules/checkout/domain/events/checkout-domain-event.js";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
const clientPath = process.env.READY_PROD_TEST_PRISMA_CLIENT;
const EVENT_TYPE = "payment.status.changed";

describe("leased outbox and shutdown (PostgreSQL)", { skip: !databaseUrl || !clientPath }, () => {
  let prisma: any;
  let admin: any;
  let PrismaClient: any;
  let scopedUrl: string;
  let repo: PrismaOutboxRepository;
  const schema = `outbox_test_${randomUUID().replaceAll("-", "")}`;
  const envelope = () => createCheckoutEventEnvelope({ eventType: EVENT_TYPE,
    merchantId: `outbox_merchant_${randomUUID()}`, payload: { payment_intent_id: "pi-fixture", status: "approved" } });
  const snapshot = (eventId: string) => prisma.outboxMessage.findUniqueOrThrow({ where: { eventId } });

  before(async () => {
    const parsed = new URL(databaseUrl!);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/ready_prod_test");
    const { Client } = createRequire(import.meta.url)("pg");
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}".outbox_messages (LIKE public.outbox_messages INCLUDING ALL)`);
    await admin.query(`CREATE TABLE "${schema}".outbox_handler_executions (LIKE public.outbox_handler_executions INCLUDING ALL)`);
    await admin.query(`CREATE TABLE "${schema}".business_effects (event_id TEXT PRIMARY KEY, units INTEGER NOT NULL)`);
    parsed.searchParams.set("schema", schema);
    scopedUrl = parsed.toString();
    ({ PrismaClient } = createRequire(import.meta.url)(clientPath!));
    prisma = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
    assert.equal((await prisma.$queryRawUnsafe("SELECT current_schema() AS schema"))[0].schema, schema,
      "raw claim queries must run in the exclusive test schema");
    repo = new PrismaOutboxRepository(prisma);
  });
  beforeEach(async () => {
    await prisma.outboxHandlerExecution.deleteMany();
    await prisma.outboxMessage.deleteMany();
    await admin.query(`DELETE FROM "${schema}".business_effects`);
  });
  after(async () => {
    await prisma?.$disconnect();
    if (admin) {
      assert.match(schema, /^outbox_test_[a-f0-9]{32}$/);
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("sixteen replicas split forty events without overlapping claims or inspection side effects", async () => {
    const events = Array.from({ length: 40 }, envelope);
    await Promise.all(events.map((event) => repo.appendOutbox(event)));
    assert.equal((await repo.listPending()).length, 40);
    assert.equal((await repo.listPending()).length, 40);
    const claims = (await Promise.all(Array.from({ length: 16 }, () => new PrismaOutboxRepository(prisma).claimBatch(4)))).flat();
    assert.equal(claims.length, 40);
    assert.equal(new Set(claims.map((claim) => claim.envelope.event_id)).size, 40);
    assert.ok(claims.every((claim) => claim.attempts === 1 && Boolean(claim.leaseToken)));
    assert.equal((await repo.getBacklog()).processing, 40);
    await Promise.all(claims.map((claim) => repo.completeClaim(claim)));
    assert.equal((await repo.claimBatch()).length, 0);
  });

  it("reclaims expired leases and fences stale renew/failure/handler/ack/release writes", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    const old = (await repo.claimBatch())[0];
    assert.equal(await repo.renewClaim(old), true);
    await prisma.outboxMessage.update({ where: { eventId: event.event_id }, data: { leaseExpiresAt: new Date(0) } });
    const current = (await new PrismaOutboxRepository(prisma).claimBatch())[0];
    assert.notEqual(old.leaseToken, current.leaseToken);
    assert.equal(current.attempts, 2);
    assert.equal(await repo.renewClaim(old), false);
    assert.equal(await repo.completeHandler(old, "stale.handler"), false);
    assert.equal(await repo.completeClaim(old), false);
    assert.equal(await repo.releaseUnstartedClaim(old), false);
    assert.equal(await repo.failClaim(old, "stale", new Date(0)), null);
    assert.equal(await repo.completeHandler(current, "current.handler"), true);
    assert.equal(await repo.completeClaim(current), true);
    assert.equal(await repo.isHandlerProcessed(event.event_id, "stale.handler"), false);
    assert.equal(await repo.isHandlerProcessed(event.event_id, "current.handler"), true);
  });

  it("concurrent failure writes apply once and preserve acquisition attempt counts and retry delay", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    const claim = (await repo.claimBatch())[0];
    const results = await Promise.all(Array.from({ length: 20 }, () => repo.failClaim(claim, "provider_unavailable", new Date(Date.now() + 60_000))));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await snapshot(event.event_id)).attempts, 1);
    assert.equal((await repo.claimBatch()).length, 0);
    await assert.rejects(repo.markDelivered(event.event_id), /outbox_claim_required/);
    await assert.rejects(repo.markHandlerProcessed(event.event_id, "unfenced"), /outbox_claim_required/);
  });

  it("partial handler success survives restart and errors persist only a sanitized code", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    const bus = new InMemoryDomainEventBus();
    let completedCalls = 0;
    let failingCalls = 0;
    bus.subscribe(EVENT_TYPE, async (received) => {
      completedCalls++;
      assert.equal(received.eventId, event.event_id);
      assert.equal(received.correlationId, event.correlation_id);
      assert.equal(received.schemaVersion, event.schema_version);
    }, "handler.succeeds.v1");
    bus.subscribe(EVENT_TYPE, async () => {
      if (++failingCalls === 1) throw new Error("provider echoed secret=do-not-store buyer@example.invalid");
    }, "handler.flaky.v1");
    await new OutboxDispatcher(repo, bus).dispatch();
    assert.equal((await snapshot(event.event_id)).status, "pending");
    assert.equal((await snapshot(event.event_id)).lastError, "outbox_handler_failed");
    await prisma.outboxMessage.update({ where: { eventId: event.event_id }, data: { nextAttemptAt: new Date(0) } });
    await new OutboxDispatcher(new PrismaOutboxRepository(prisma), bus).dispatch();
    assert.equal((await snapshot(event.event_id)).status, "delivered");
    assert.equal(completedCalls, 1);
    assert.equal(failingCalls, 2);
  });

  it("crash after an effect reruns the handler and a consumer business key prevents duplicate mutation", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    let calls = 0;
    const effect = async () => {
      calls++;
      await prisma.$executeRawUnsafe("INSERT INTO business_effects(event_id,units) VALUES ($1,1) ON CONFLICT (event_id) DO NOTHING", event.event_id);
    };
    const abandoned = (await repo.claimBatch())[0];
    await effect(); // Process disappears after the side effect and before marker/ack.
    await prisma.outboxMessage.update({ where: { eventId: event.event_id }, data: { leaseExpiresAt: new Date(0) } });
    const bus = new InMemoryDomainEventBus();
    bus.subscribe(EVENT_TYPE, effect, "business.effect.v1");
    await new OutboxDispatcher(new PrismaOutboxRepository(prisma), bus).dispatch();
    assert.equal(calls, 2, "outbox must not claim external exactly-once delivery");
    assert.equal((await prisma.$queryRawUnsafe("SELECT SUM(units)::integer AS units FROM business_effects"))[0].units, 1);
    assert.equal(await repo.completeClaim(abandoned), false);
    assert.equal(await repo.isProcessed(event.event_id), true);
  });

  it("final-attempt crashes become dead without infinite leasing and preserve backlog diagnostics", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = (await repo.claimBatch())[0];
      assert.equal(claim.attempts, attempt);
      await prisma.outboxMessage.update({ where: { eventId: event.event_id }, data: { leaseExpiresAt: new Date(0) } });
    }
    assert.equal((await repo.claimBatch()).length, 0);
    assert.equal((await snapshot(event.event_id)).status, "dead");
    assert.equal((await repo.getBacklog()).dead, 1);
    await repo.appendOutbox(event);
    assert.equal((await repo.claimBatch()).length, 0, "duplicate append cannot revive a dead delivery");
    await assert.rejects(repo.claimBatch(51), /outbox_batch_size_invalid/);
    await assert.rejects(repo.claimBatch(0), /outbox_batch_size_invalid/);
  });

  it("transaction rollback and metadata round-trip preserve non-checkout producers", async () => {
    const event = { ...envelope(), producer: "inventory", schema_version: 2 } as any;
    await assert.rejects(repo.saveWithOutbox(async (tx) => { await tx.appendOutbox(event); throw new Error("abort"); }), /abort/);
    assert.equal((await repo.listPending()).length, 0);
    await repo.saveWithOutbox(async (tx) => { await tx.appendOutbox(event); });
    const claim = (await repo.claimBatch())[0];
    assert.equal(claim.envelope.producer, "inventory");
    assert.equal(claim.envelope.schema_version, 2);
    assert.equal(await repo.releaseUnstartedClaim(claim), true);
    assert.equal((await repo.claimBatch())[0].attempts, 1);
  });

  it("Nest shutdown drains a real PostgreSQL handler before PrismaLifecycle disconnect", async () => {
    const event = envelope();
    await repo.appendOutbox(event);
    const shutdownClient = new PrismaClient({ datasources: { db: { url: scopedUrl } } });
    const disconnect = shutdownClient.$disconnect.bind(shutdownClient);
    const order: string[] = [];
    shutdownClient.$disconnect = async () => { order.push("disconnect"); await disconnect(); };
    const bus = new InMemoryDomainEventBus();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    bus.subscribe(EVENT_TYPE, async () => { order.push("handler-start"); entered(); await gate; order.push("handler-end"); }, "nest.shutdown.v1");
    class TestModule {}
    Module({ providers: [
      { provide: PrismaLifecycle, useValue: new PrismaLifecycle(shutdownClient) },
      { provide: OUTBOX_REPOSITORY, useValue: new PrismaOutboxRepository(shutdownClient) },
      { provide: DOMAIN_EVENT_BUS, useValue: bus },
      { provide: OUTBOX_DISPATCHER_OPTIONS, useValue: { concurrency: 1, drainTimeoutMs: 1_000 } },
      OutboxDispatcher,
    ] })(TestModule);
    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });
    try {
      const run = app.get(OutboxDispatcher).dispatch();
      await started;
      let closed = false;
      const close = app.close().then(() => { closed = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(closed, false);
      assert.deepEqual(order, ["handler-start"]);
      release();
      await Promise.all([run, close]);
      assert.deepEqual(order, ["handler-start", "handler-end", "disconnect"]);
      assert.equal((await snapshot(event.event_id)).status, "delivered");
    } finally {
      release();
      await app.close();
      await disconnect();
    }
  });

  it("the actual additive lease migration preserves historical pending and delivered rows", async () => {
    const migrationSchema = `outbox_migration_${randomUUID().replaceAll("-", "")}`;
    try {
      await admin.query(`CREATE SCHEMA "${migrationSchema}"`);
      await admin.query(`SET search_path TO "${migrationSchema}"`);
      await admin.query("CREATE TABLE outbox_messages(event_id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT NOW())");
      await admin.query("INSERT INTO outbox_messages(event_id,status) VALUES ('legacy-pending','pending'),('legacy-delivered','delivered')");
      await admin.query(readFileSync(new URL("../prisma/migrations/20260906011000_outbox_leases/migration.sql", import.meta.url), "utf8"));
      const rows = (await admin.query("SELECT event_id,status,lease_token,lease_expires_at FROM outbox_messages ORDER BY event_id")).rows;
      assert.deepEqual(rows, [
        { event_id: "legacy-delivered", status: "delivered", lease_token: null, lease_expires_at: null },
        { event_id: "legacy-pending", status: "pending", lease_token: null, lease_expires_at: null },
      ]);
    } finally {
      await admin.query("SET search_path TO public");
      await admin.query(`DROP SCHEMA IF EXISTS "${migrationSchema}" CASCADE`);
    }
  });
});
