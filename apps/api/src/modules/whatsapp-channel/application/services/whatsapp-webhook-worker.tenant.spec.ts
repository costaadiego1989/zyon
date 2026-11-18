import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { WhatsAppWebhookWorker } from "./whatsapp-webhook-worker.service.js";
import { TenantContextService, type TenantContext } from "../../../../shared/tenant/tenant-context.service.js";
import { ServiceBusinessAnswerFactory } from "../../../knowledge-base/application/services/service-business-answer.factory.js";
import { KnowledgeResponseAuditService } from "../../../knowledge-base/application/services/knowledge-response-audit.service.js";
import type { WhatsAppInboxClaim } from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import { INBOX_LEASE_MS } from "../../domain/ports/whatsapp-webhook-inbox.port.js";

const claim = (merchantId: string): WhatsAppInboxClaim => ({
  id: merchantId + "-inbox", dedupKey: merchantId, eventId: merchantId, kind: "message", merchantId,
  configId: merchantId + "-config", deviceId: "META_CLOUD:" + merchantId + "-config", streamKey: merchantId,
  payloadHash: "synthetic", leaseToken: merchantId + "-lease", attempts: 1,
  payload: { merchantId, deviceId: "META_CLOUD:" + merchantId + "-config", fromNumber: "5511999995701",
    body: "Você pode chamar alguém da equipe?", messageType: "text", timestamp: Date.now(), provider: "META_CLOUD" },
});
const config = (c: WhatsAppInboxClaim) => ({ id: c.configId, merchantId: c.merchantId, provider: "META_CLOUD", enabled: true });
const expectedContext = (c: WhatsAppInboxClaim) => ({ merchantId: c.merchantId, userId: "whatsapp-inbox", role: "buyer", correlationId: c.id });
const checkpoint = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(tenant: TenantContextService, c: WhatsAppInboxClaim, handle: () => Promise<void>, options: {
  findConfig?: () => Promise<ReturnType<typeof config> | null>; renew?: () => Promise<boolean>;
} = {}) {
  let next: WhatsAppInboxClaim | null = c;
  const completed: string[] = [], failures: string[] = [], thrown: string[] = [];
  const inbox = {
    claimNext: async () => { const value = next; next = null; return value; },
    renew: options.renew ?? (async () => true),
    complete: async () => { completed.push(c.id); return true; },
    fail: async (_claim: unknown, code: string) => { failures.push(code); return true; },
  };
  const incoming = { execute: async () => {
    try { await handle(); } catch (error) { thrown.push(error instanceof Error ? error.message : "non_error"); throw error; }
  } };
  const worker = new WhatsAppWebhookWorker(inbox as never,
    { findById: options.findConfig ?? (async () => config(c)) } as never,
    incoming as never, { execute: async () => assert.fail("message must not run status handler") } as never,
    undefined, tenant);
  return { worker, completed, failures, thrown };
}

function actualBusinessPorts(tenant: TenantContextService, merchantId: string) {
  const recorded: Array<Record<string, any>> = [];
  const factory = new ServiceBusinessAnswerFactory({ $transaction: async (run: (tx: any) => unknown) => run({
    $queryRaw: async (query: { values: unknown[] }) => { assert.deepEqual(query.values, [merchantId]); return [{ id: merchantId }]; },
    merchant: { findUnique: async (input: { where: { id: string } }) => {
      assert.equal(input.where.id, merchantId); return { businessMode: "products" };
    } },
  }) } as never, tenant, { assertAllowed: async () => assert.fail("product mode needs no service entitlement") },
  {} as never, {} as never);
  const audit = new KnowledgeResponseAuditService({ execute: async input => {
    recorded.push(input);
    return { id: "synthetic-audit", merchantId: input.merchantId, actorType: input.actor.type, actorId: input.actor.id,
      action: input.action, resourceType: input.resourceType, outcome: input.outcome ?? "success", metadata: input.metadata ?? {}, occurredAt: new Date(0).toISOString() };
  } }, tenant);
  return { factory, audit, recorded };
}

test("T57 verified inbox scope reaches the actual business factory and audit before a reply", async () => {
  const tenant = new TenantContextService(), c = claim("tenant-a"), ports = actualBusinessPorts(tenant, c.merchantId);
  let opened: unknown;
  const f = fixture(tenant, c, async () => {
    opened = await ports.factory.open({ merchantId: c.merchantId, fallbackPurpose: "existing_company_context" });
    await ports.audit.execute({ merchantId: c.merchantId, channel: "whatsapp", finalResponse: "Conversa preservada.",
      admission: { status: "insufficient", evidence: [] } });
  });
  assert.equal(tenant.get(), null);
  await f.worker.drain();
  // On the original worker this contains knowledge_audit_scope_mismatch:
  // the real factory first returns unavailable because the same ALS is null.
  assert.deepEqual(f.thrown, []);
  assert.deepEqual(opened, { kind: "products" });
  assert.deepEqual(f.completed, [c.id]); assert.deepEqual(f.failures, []);
  assert.equal(ports.recorded.length, 1);
  assert.equal(ports.recorded[0]!.merchantId, c.merchantId);
  assert.deepEqual(ports.recorded[0]!.actor, { type: "service", id: "knowledge-response" });
  assert.equal(ports.recorded[0]!.correlationId, c.id);
  assert.equal(ports.recorded[0]!.metadata.channel, "whatsapp");
  assert.equal(ports.recorded[0]!.metadata.responseSha256, createHash("sha256").update("Conversa preservada.").digest("hex"));
  assert.equal(tenant.get(), null);
});

test("T57 validated background identity never copies ambient or payload privileges and restores its caller", async () => {
  const tenant = new TenantContextService(), c = claim("tenant-a");
  Object.assign(c.payload, { userId: "forged-owner", role: "owner", auth: { merchantId: "foreign", role: "admin" } });
  const ambient: TenantContext = { merchantId: "ambient", userId: "human-owner", role: "owner",
    buyerGlobalUserId: "ambient-buyer", embedSessionToken: "ambient-token", correlationId: "ambient-correlation" };
  const contexts: unknown[] = [];
  const f = fixture(tenant, c, async () => { contexts.push(tenant.get()); await checkpoint(); contexts.push(tenant.get()); });
  await tenant.run(ambient, async () => {
    await f.worker.drain(); assert.deepEqual(tenant.get(), ambient);
  });
  assert.deepEqual(contexts, [expectedContext(c), expectedContext(c)]);
  assert.deepEqual(f.completed, [c.id]); assert.deepEqual(f.failures, []); assert.equal(tenant.get(), null);
});

test("T57 concurrent asynchronous merchant turns retain their own real context and audit ownership", async () => {
  const tenant = new TenantContextService(), a = claim("tenant-a"), b = claim("tenant-b");
  let entered = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const contexts: Array<{ merchantId: string; before: unknown; after: unknown }> = [];
  const items = [a, b].map(c => {
    const ports = actualBusinessPorts(tenant, c.merchantId);
    const f = fixture(tenant, c, async () => {
      const before = tenant.get(); if (++entered === 2) release(); await gate;
      const after = tenant.get(); contexts.push({ merchantId: c.merchantId, before, after });
      assert.deepEqual(await ports.factory.open({ merchantId: c.merchantId, fallbackPurpose: "existing_company_context" }), { kind: "products" });
      await ports.audit.execute({ merchantId: c.merchantId, channel: "whatsapp", finalResponse: "Preservado.", admission: { status: "insufficient", evidence: [] } });
    });
    return { c, f, ports };
  });
  await Promise.all(items.map(item => item.f.worker.drain()));
  for (const { c, f, ports } of items) {
    assert.deepEqual(contexts.find(value => value.merchantId === c.merchantId), { merchantId: c.merchantId, before: expectedContext(c), after: expectedContext(c) });
    assert.deepEqual(f.thrown, []); assert.deepEqual(f.completed, [c.id]); assert.deepEqual(f.failures, []);
    assert.equal(ports.recorded.length, 1); assert.equal(ports.recorded[0]!.merchantId, c.merchantId);
  }
  assert.equal(tenant.get(), null);
});

test("T57 an existing processing exception retains its code while the validated tenant context is restored", async () => {
  const tenant = new TenantContextService(), c = claim("tenant-a"), original = new Error("whatsapp_business_read_failed");
  let seen: unknown;
  const f = fixture(tenant, c, async () => { seen = tenant.get(); await checkpoint(); throw original; });
  await f.worker.drain();
  assert.deepEqual(seen, expectedContext(c)); assert.deepEqual(f.thrown, [original.message]);
  assert.deepEqual(f.failures, [original.message]); assert.deepEqual(f.completed, []); assert.equal(tenant.get(), null);
});

test("T57 a missing, changed, foreign, disabled or wrong-provider configuration grants no tenant execution", async () => {
  for (const mutate of [() => null, (value: ReturnType<typeof config>) => ({ ...value, id: "other" }),
    (value: ReturnType<typeof config>) => ({ ...value, merchantId: "foreign" }),
    (value: ReturnType<typeof config>) => ({ ...value, enabled: false }),
    (value: ReturnType<typeof config>) => ({ ...value, provider: "TWILIO" })]) {
    const tenant = new TenantContextService(), c = claim("tenant-a"); let entries = 0;
    const original = tenant.run.bind(tenant);
    tenant.run = (context, work) => { entries++; return original(context, work); };
    const f = fixture(tenant, c, async () => assert.fail("unvalidated claim must not reach processing"),
      { findConfig: async () => mutate(config(c)) });
    await f.worker.drain(); assert.equal(entries, 0); assert.equal(tenant.get(), null);
    assert.deepEqual(f.completed, []); assert.deepEqual(f.thrown, []);
    assert.deepEqual(f.failures, ["whatsapp_channel_changed_or_disabled"]);
  }
});

test("T57 lease refusal while validating configuration grants no tenant execution", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const tenant = new TenantContextService(), c = claim("tenant-a"); let entries = 0, renewals = 0;
  const original = tenant.run.bind(tenant);
  tenant.run = (context, work) => { entries++; return original(context, work); };
  let release!: () => void, entered!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(tenant, c, async () => assert.fail("lost lease must not reach processing"), {
    findConfig: async () => { entered(); await gate; return config(c); },
    renew: async () => { renewals++; return false; },
  });
  const pending = f.worker.drain(); await validating;
  t.mock.timers.tick(INBOX_LEASE_MS / 4); await checkpoint(); release(); await pending;
  assert.equal(renewals, 1); assert.equal(entries, 0); assert.equal(tenant.get(), null);
  // A lost lease cannot be changed by the former owner, including its failure.
  assert.deepEqual(f.completed, []); assert.deepEqual(f.failures, []); assert.deepEqual(f.thrown, []);
});
