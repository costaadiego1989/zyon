import "reflect-metadata";
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { PrismaWhatsAppOnboardingStore } from "./prisma-whatsapp-onboarding.repository.js";
import { PrismaWhatsAppConfigRepository } from "./prisma-whatsapp-config.repository.js";
import { registerTenantMiddleware } from "../../../../shared/persistence/tenant.middleware.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";

const databaseUrl = process.env.WHATSAPP_ONBOARDING_TEST_DATABASE_URL;
describe("WhatsApp onboarding leases and reservations (isolated PostgreSQL)", { skip: !databaseUrl }, () => {
  let db: PrismaClient;
  let store: PrismaWhatsAppOnboardingStore;
  const ids: string[] = [];
  const merchant = () => { const id = "wa-test-" + randomUUID(); ids.push(id); return id; };
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "55439");
    assert.equal(url.pathname, "/whatsapp_onboarding_test");
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_channel_configs (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, merchant_id text UNIQUE NOT NULL,
      enabled boolean NOT NULL DEFAULT false, provider text NOT NULL DEFAULT 'TWILIO',
      credentials jsonb NOT NULL DEFAULT '{}', whatsapp_number text, status text NOT NULL DEFAULT 'DISCONNECTED',
      device_id text, phone_number text, webhook_secret text, connected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    store = new PrismaWhatsAppOnboardingStore(db);
  });
  after(async () => {
    if (!db) return;
    await db.whatsAppChannelConfig.deleteMany({ where: { merchantId: { in: ids } } });
    await db.$disconnect();
  });

  it("20 competing requests acquire exactly one lease", async () => {
    const id = merchant();
    const results = await Promise.all(Array.from({ length: 20 }, () => store.claim(id)));
    const leases = results.filter(value => value !== null);
    assert.equal(leases.length, 1);
    await store.release(leases[0]!);
    const next = await store.claim(id);
    assert.ok(next);
    await store.release(next);
  });

  it("a second merchant cannot reserve the same phone or WABA, including simultaneous writes", async () => {
    const [a, b] = await Promise.all([store.claim(merchant()), store.claim(merchant())]);
    assert.ok(a && b);
    const patch = { whatsappNumber: "5511999999001", credentials: { wabaId: "123456789" } };
    const results = await Promise.allSettled([store.save(a, patch), store.save(b, patch)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected" && result.reason instanceof ConflictException).length, 1);
    const loser = results[0].status === "rejected" ? a : b;
    await assert.rejects(store.save(loser, { whatsappNumber: "5511999999002", credentials: { wabaId: "123456789" } }), ConflictException);
    await assert.rejects(store.save(loser, { whatsappNumber: "5511999999001", credentials: { wabaId: "999999999" } }), ConflictException);
    await Promise.all([store.release(a), store.release(b)]);
  });

  it("expired workers cannot save or release the replacement worker's lease", async () => {
    const id = merchant();
    const first = await store.claim(id);
    assert.ok(first);
    await db.whatsAppChannelConfig.update({ where: { merchantId: id }, data: {
      credentials: { onboardingLease: { token: first.token, expiresAt: 0 } },
    } });
    const second = await store.claim(id);
    assert.ok(second);
    await assert.rejects(store.save(first, { status: "ACTIVE", enabled: true }), ConflictException);
    await store.release(first);
    assert.equal(await store.claim(id), null);
    await store.save(second, { status: "PROVISIONING" });
    await store.release(second);
  });

  it("global reservation still works inside the production tenant middleware", async () => {
    const ctx = new TenantContextService();
    const scoped = new PrismaWhatsAppOnboardingStore(registerTenantMiddleware(db, ctx) as unknown as PrismaClient);
    const [a, b] = [merchant(), merchant()];
    const run = <T>(id: string, fn: () => Promise<T>) => ctx.run({ merchantId: id, userId: id, role: "owner" }, fn);
    const first = await run(a, () => scoped.claim(a));
    assert.ok(first);
    await run(a, () => scoped.save(first, { whatsappNumber: "5511999999111", credentials: { wabaId: "777777777" } }));
    await run(a, () => scoped.release(first));
    const second = await run(b, () => scoped.claim(b));
    assert.ok(second);
    await assert.rejects(run(b, () => scoped.save(second, { whatsappNumber: "5511999999111", credentials: { wabaId: "888888888" } })), ConflictException);
    await run(b, () => scoped.release(second));
  });

  it("progress renews the current lease and preserves credentials without resurrecting an expired worker", async () => {
    const id = merchant();
    const lease = await store.claim(id);
    assert.ok(lease);
    const nearExpiry = Date.now() + 15_000;
    await db.whatsAppChannelConfig.update({ where: { merchantId: id }, data: {
      credentials: { wabaId: "555555555", onboardingLease: { token: lease.token, expiresAt: nearExpiry } },
    } });
    await store.save(lease, { status: "PROVISIONING" });
    const row = await db.whatsAppChannelConfig.findUniqueOrThrow({ where: { merchantId: id } });
    const credentials = row.credentials as Record<string, any>;
    assert.equal(credentials.wabaId, "555555555");
    assert.equal(credentials.onboardingLease.token, lease.token);
    assert.ok(credentials.onboardingLease.expiresAt > nearExpiry + 60_000);
    await store.release(lease);
  });

  it("persisted secrets are encrypted and both repository paths decrypt them", async () => {
    const id = merchant();
    const lease = await store.claim(id);
    assert.ok(lease);
    await store.save(lease, { credentials: { accountSid: "AC" + "a".repeat(32), authToken: "private-test-token", senderCreateAttempted: true } });
    await store.release(lease);
    const persisted = await db.whatsAppChannelConfig.findUniqueOrThrow({ where: { merchantId: id } });
    assert.ok(!JSON.stringify(persisted.credentials).includes("private-test-token"));
    const config = await new PrismaWhatsAppConfigRepository(db).findByMerchantId(id);
    assert.equal(config!.credentials.authToken, "private-test-token");
    const resumed = await store.claim(id);
    assert.equal(resumed!.config.credentials.authToken, "private-test-token");
    assert.equal(resumed!.config.credentials.senderCreateAttempted, true);
    await store.release(resumed!);
  });
});
