import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { PrismaInformationalEventRedriveAdapter } from "./infrastructure/prisma-informational-event-redrive.adapter.js";
import { RedriveInformationalEventUseCase } from "./redrive-informational-event.use-case.js";
import { INFORMATIONAL_EVENT_REDRIVE, INFORMATIONAL_EVENT_AUDIT_HANDLERS } from "./ports/informational-event-redrive.port.js";
import { MessagingModule } from "./messaging.module.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";
import { ShippingQuoteCreatedAuditHandler } from "../../modules/shipping/infrastructure/event-handlers/shipping-quote-created-audit.handler.js";
import { ShipmentCreatedAuditHandler } from "../../modules/fulfillment/infrastructure/event-handlers/shipment-created-audit.handler.js";
import type { InformationalEventRedriveInput } from "./ports/informational-event-redrive.port.js";

function fixture(type: InformationalEventRedriveInput["expectedEventType"] = "shipping.quote.created") {
  const input: InformationalEventRedriveInput = { merchantId: "merchant", eventId: "original-event", expectedEventType: type,
    actorId: "release-operator", purpose: "Recover informational audit after missing consumer fix" };
  const row: any = { eventId: input.eventId, eventType: type, schemaVersion: 1, merchantId: input.merchantId,
    producer: type === "shipment.created" ? "fulfillment" : "shipping", occurredAt: new Date("2026-10-30T21:03:39Z"),
    correlationId: "original-correlation", causationId: "original-causation", createdAt: new Date(),
    payload: type === "shipment.created" ? { shipment_id: "shipment", order_id: "order", merchant_id: input.merchantId, carrier_key: "melhor-envio-1", private_address: "PRIVATE" }
      : { quote_id: "quote", session_id: "session", option_count: 1, expires_at: "2026-11-01T00:00:00Z", destination_zip: "PRIVATE" },
    status: "dead", attempts: 5, lastError: "outbox_handler_missing", leaseToken: null, leaseExpiresAt: null,
    nextAttemptAt: null, deliveredAt: null, publishedAt: null };
  const audits = new Map<string, any>(); const calls: any[] = [];
  const state = { failAudit: false, conflict: false, transactions: 0 };
  // Actual Prisma adapter against a serialized, rollback-capable transaction
  // double. This tests SQL/CAS contracts; it is not a PostgreSQL engine test.
  let tail: Promise<void> = Promise.resolve();
  const prisma: any = { $transaction: async (work: any, options: any) => {
    const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    state.transactions++; const before = structuredClone(row); const beforeAudits = new Map(audits);
    assert.equal(options.isolationLevel, "ReadCommitted");
    const tx = {
      $queryRaw: async (query: any) => { calls.push(["row-lock", query]); assert.match(query.sql, /FOR UPDATE/);
        return query.values.includes(row.eventId) && query.values.includes(row.merchantId) ? [{ eventId: row.eventId }] : []; },
      outboxMessage: {
        findFirst: async ({ where }: any) => row.eventId === where.eventId && row.merchantId === where.merchantId ? structuredClone(row) : null,
        updateMany: async (args: any) => { calls.push(["queue-cas", args]);
          const matches = Object.entries(args.where).every(([key, expected]: any) => JSON.stringify(row[key]) === JSON.stringify(key === "payload" ? expected.equals : expected));
          if (!matches || state.conflict) return { count: 0 };
          Object.assign(row, args.data); return { count: 1 }; },
      },
      merchantAuditEvent: { findUnique: async ({ where }: any) => audits.get(where.id) ?? null,
        create: async ({ data }: any) => { calls.push(["audit-create", data]); if (state.failAudit) throw Error("audit_unavailable");
          if (audits.has(data.id)) throw Error("duplicate_audit"); audits.set(data.id, structuredClone(data)); return data; } },
    };
    try { return await work(tx); } catch (error) { for (const key of Object.keys(row)) delete row[key]; Object.assign(row, before);
      audits.clear(); for (const [key, value] of beforeAudits) audits.set(key, value); throw error;
    } finally { release(); }
  } };
  const bus = new InMemoryDomainEventBus();
  const handlerPrisma: any = { merchantAuditEvent: { upsert: async ({ where, create }: any) => {
    if (!audits.has(where.id)) audits.set(where.id, structuredClone(create)); return audits.get(where.id);
  } } };
  const handler = type === "shipment.created" ? new ShipmentCreatedAuditHandler(bus, handlerPrisma) : new ShippingQuoteCreatedAuditHandler(bus, handlerPrisma);
  handler.onModuleInit();
  const repository = new PrismaInformationalEventRedriveAdapter(prisma);
  const useCase = new RedriveInformationalEventUseCase(repository, bus);
  return { input, row, audits, calls, state, bus, useCase, repository, run: () => useCase.execute(input) };
}

test("operational use case and port are registered/exported without an HTTP controller", () => {
  const providers: any[] = Reflect.getMetadata("providers", MessagingModule);
  const exports: any[] = Reflect.getMetadata("exports", MessagingModule);
  assert.ok(providers.includes(RedriveInformationalEventUseCase)); assert.ok(providers.some(p => p.provide === INFORMATIONAL_EVENT_REDRIVE));
  assert.ok(exports.includes(RedriveInformationalEventUseCase)); assert.ok(exports.includes(INFORMATIONAL_EVENT_REDRIVE));
  assert.equal((Reflect.getMetadata("controllers", MessagingModule) ?? []).length, 0);
});

for (const type of ["shipping.quote.created", "shipment.created"] as const) test(`${type} requeues its original envelope with immutable historical audit in one transaction`, async () => {
  const f = fixture(type), original = structuredClone(f.row);
  const result = await f.run(); assert.equal(result.outcome, "requeued"); assert.equal(f.state.transactions, 1);
  assert.equal(f.row.status, "pending"); assert.equal(f.row.attempts, 0); assert.equal(f.row.lastError, null);
  for (const key of ["eventId", "payload", "schemaVersion", "eventType", "merchantId", "occurredAt", "correlationId", "causationId", "producer", "publishedAt"])
    assert.deepEqual(f.row[key], original[key]);
  const audit = f.audits.get(result.auditId!); assert.equal(audit.actorId, f.input.actorId); assert.equal(audit.metadata.purpose, f.input.purpose);
  assert.equal(audit.metadata.priorStatus, "dead"); assert.equal(audit.metadata.priorAttempts, 5);
  assert.equal(audit.metadata.priorLastError, "outbox_handler_missing"); assert.equal(audit.metadata.grantedRetryBudget, 5);
  assert.match(audit.metadata.envelopeFingerprint, /^[0-9a-f]{64}$/); assert.equal(JSON.stringify(audit).includes("PRIVATE"), false);
  assert.deepEqual(audit.metadata.handlerIds, [INFORMATIONAL_EVENT_AUDIT_HANDLERS[type]]);
  assert.deepEqual(f.calls.find(c => c[0] === "queue-cas")[1].data, { status: "pending", attempts: 0, lastError: null, nextAttemptAt: f.row.nextAttemptAt });
});

test("concurrent duplicate operations consume one recovery budget and create one historical audit", async () => {
  const f = fixture(); const results = await Promise.all(Array.from({ length: 8 }, () => f.run()));
  assert.equal(results.filter(r => r.outcome === "requeued").length, 1);
  assert.equal(results.filter(r => r.outcome === "already_requested").length, 7);
  assert.equal(f.audits.size, 1); assert.equal(f.calls.filter(c => c[0] === "queue-cas").length, 1);
  f.row.status = "dead"; f.row.attempts = 5; f.row.lastError = "outbox_handler_failed";
  assert.equal((await f.run()).outcome, "already_requested"); assert.equal(f.row.attempts, 5);
});

test("delivered events remain a no-op with or without a prior recovery audit", async () => {
  for (const recovered of [false, true]) {
    const f = fixture(); if (recovered) await f.run(); f.row.status = "delivered"; f.row.deliveredAt = new Date();
    const before = structuredClone(f.row), calls = f.calls.length;
    assert.equal((await f.run()).outcome, "already_delivered"); assert.deepEqual(f.row, before);
    assert.equal(f.calls.slice(calls).filter(c => c[0] === "queue-cas" || c[0] === "audit-create").length, 0);
  }
});

for (const [name, mutate] of [
  ["wrong tenant", (f: any) => { f.input.merchantId = "other"; }],
  ["wrong event id", (f: any) => { f.input.eventId = "other"; }],
  ["wrong expected type", (f: any) => { f.input.expectedEventType = "shipment.created"; f.bus.subscribe("shipment.created", async () => {}, INFORMATIONAL_EVENT_AUDIT_HANDLERS["shipment.created"]); }],
  ["schema version", (f: any) => { f.row.schemaVersion = 2; }],
  ["producer", (f: any) => { f.row.producer = "payment"; }],
  ["malformed correlation", (f: any) => { f.row.correlationId = ""; }],
  ["payload tenant", (f: any) => { f.row.payload.merchant_id = "other"; }],
  ["payload shape", (f: any) => { f.row.payload = { session_id: "session" }; }],
  ["pending state", (f: any) => { f.row.status = "pending"; }],
  ["processing state", (f: any) => { f.row.status = "processing"; }],
  ["unexpected failure", (f: any) => { f.row.lastError = "provider_timeout"; }],
  ["attempts below five", (f: any) => { f.row.attempts = 4; }],
  ["attempts above five", (f: any) => { f.row.attempts = 6; }],
  ["lease token", (f: any) => { f.row.leaseToken = "active"; }],
  ["lease expiry", (f: any) => { f.row.leaseExpiresAt = new Date(); }],
  ["dead row with delivery timestamp", (f: any) => { f.row.deliveredAt = new Date(); }],
] as const) test(`${name} cannot authorize queue or audit writes`, async () => {
  const f = fixture(); mutate(f); const before = structuredClone(f.row);
  await assert.rejects(f.run()); assert.deepEqual(f.row, before); assert.equal(f.audits.size, 0);
  assert.equal(f.calls.filter(c => c[0] === "queue-cas" || c[0] === "audit-create").length, 0);
});

for (const mode of ["missing", "extra", "duplicate", "wrong-id"] as const) test(`registry ${mode} blocks before the transaction`, async () => {
  const f = fixture(), bus = new InMemoryDomainEventBus();
  if (mode !== "missing") bus.subscribe(f.input.expectedEventType, async () => {}, mode === "wrong-id" ? "financial-handler" : INFORMATIONAL_EVENT_AUDIT_HANDLERS[f.input.expectedEventType]);
  if (mode === "extra" || mode === "duplicate") bus.subscribe(f.input.expectedEventType, async () => {}, mode === "extra" ? "financial-handler" : INFORMATIONAL_EVENT_AUDIT_HANDLERS[f.input.expectedEventType]);
  await assert.rejects(new RedriveInformationalEventUseCase(f.repository, bus).execute(f.input), /handlers_unconfirmed/);
  assert.equal(f.state.transactions, 0);
});

test("financial/stock event types and incomplete operational identities fail strict input validation", async () => {
  for (const patch of [{ expectedEventType: "order.completed" }, { expectedEventType: "inventory.sale" }, { actorId: "" }, { purpose: "" }, { extra: "bypass" }]) {
    const f = fixture(); await assert.rejects(f.useCase.execute({ ...f.input, ...patch } as any)); assert.equal(f.state.transactions, 0);
  }
});

test("the repository also rejects unconfirmed handler identifiers before entering a transaction", async () => {
  const f = fixture(); await assert.rejects(f.repository.redrive(f.input, ["other-consumer"]), /handlers_unconfirmed/);
  assert.equal(f.state.transactions, 0);
});

test("audit failure rolls back the queue CAS, and a lost CAS cannot create a recovery audit", async () => {
  for (const mode of ["failAudit", "conflict"] as const) {
    const f = fixture(), before = structuredClone(f.row); f.state[mode] = true;
    await assert.rejects(f.run()); assert.deepEqual(f.row, before); assert.equal(f.audits.size, 0);
  }
});

test("an existing recovery audit cannot authorize a changed original envelope", async () => {
  const f = fixture(); await f.run(); f.row.payload.option_count = 3;
  const before = structuredClone(f.row); await assert.rejects(f.run(), /audit_mismatch/); assert.deepEqual(f.row, before);
});

for (const alreadyHandled of [false, true]) test(`the actual dispatcher consumes the requeued original and preserves ${alreadyHandled ? "completed" : "new"} handler receipts`, async () => {
  const f = fixture("shipment.created"); await f.run();
  const repo = new InMemoryOutboxRepository(); const original = f.row;
  repo.appendOutbox({ event_id: original.eventId, event_type: original.eventType, merchant_id: original.merchantId,
    schema_version: original.schemaVersion, occurred_at: original.occurredAt.toISOString(), producer: original.producer,
    correlation_id: original.correlationId, causation_id: original.causationId, payload: original.payload });
  const handlerId = INFORMATIONAL_EVENT_AUDIT_HANDLERS["shipment.created"];
  if (alreadyHandled) { const claim = repo.claimBatch()[0]!; assert.equal(repo.completeHandler(claim, handlerId), true);
    repo.failClaim(claim, "interrupted_after_handler_receipt", new Date(0)); }
  const dispatcher = new OutboxDispatcher(repo, f.bus); await dispatcher.dispatch(); await dispatcher.dispatch();
  assert.equal(repo.isProcessed(original.eventId), true); assert.equal(repo.isHandlerProcessed(original.eventId, handlerId), true);
  assert.equal(f.audits.size, alreadyHandled ? 1 : 2);
  f.row.status = "delivered"; f.row.deliveredAt = new Date(); assert.equal((await f.run()).outcome, "already_delivered");
});
