import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaShoppingRepository } from "./infrastructure/prisma-shopping.repository.js";
import { PrismaBuyerAccountLgpdRepository } from "../buyer-account/infrastructure/prisma-buyer-account-lgpd.repository.js";
import { freshState, validateSettings } from "./domain/shopping-agent.js";
import { ShoppingAgentService } from "./application/shopping-agent.service.js";

// Explicit opt-in only. Never reuse DATABASE_URL or an existing application schema.
const connection = process.env.SHOPPING_AGENT_TEST_DATABASE_URL;
describe("shopping-agent migration and persistence (isolated PostgreSQL)", { skip: !connection }, () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let repository: PrismaShoppingRepository;
  let schemaUrl: string;
  const schema = `shopping_agent_${randomUUID().replaceAll("-", "")}`;
  const settings = () => freshState(validateSettings({ accepted: true, quietStart: 0, quietEnd: 0 }));
  before(async () => {
    const url = new URL(connection!);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Test database must be local");
    assert.match(url.pathname, /^\/shopping_agent_test(?:_[a-z0-9_]+)?$/i, "Test database name must identify a disposable shopping-agent database");
    admin = new PrismaClient({ datasources: { db: { url: connection } } });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set("schema", schema); schemaUrl = url.toString();
    prisma = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    await prisma.$executeRawUnsafe('CREATE TABLE "merchants" ("id" TEXT PRIMARY KEY)');
    await prisma.$executeRawUnsafe('CREATE TABLE "buyer_accounts" ("global_user_id" TEXT PRIMARY KEY)');
    const migration = await readFile(new URL("../../../prisma/deploy-migrations/20261027190000_buyer_shopping_agent/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map(s => s.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe('INSERT INTO "merchants" VALUES (\'merchant\'), (\'other\')');
    await prisma.$executeRawUnsafe('INSERT INTO "buyer_accounts" VALUES (\'buyer\'), (\'other\')');
    repository = new PrismaShoppingRepository(prisma);
  });
  after(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
  it("the deploy migration supports one buyer/store workspace under concurrent creation", async () => {
    const rows = await Promise.all(Array.from({ length: 10 }, () => repository.create("buyer", "merchant", settings())));
    assert.equal(new Set(rows.map(row => row.id)).size, 1);
    assert.equal(await prisma.buyerShoppingWorkspace.count(), 1);
    assert.equal(await repository.find("other", "merchant"), null);
    assert.equal(await repository.find("buyer", "other"), null);
  });
  it("optimistic updates accept exactly one writer for the same revision", async () => {
    const row = (await repository.find("buyer", "merchant"))!;
    const state = structuredClone(row.state); state.settings.maxDailyNotifications = 7;
    state.settings.appearance = { version: 1, style: "visor", color: "ocean", expression: "happy" };
    const results = await Promise.all(Array.from({ length: 10 }, () => repository.compareAndSwap(row, state, new Date(0))));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await repository.find("buyer", "merchant"))!.state.settings.maxDailyNotifications, 7);
  });
  it("retrying a task survives the key ordering of a real JSONB roundtrip", async () => {
    const service = new ShoppingAgentService(repository, { async quote() { return {}; } } as any,
      { async assertAllowed() {} } as any, {} as any);
    const config = { kind: "price_watch", title: "Café", items: [{ productId: "product", variantId: "variant", quantity: 1 }], targetCents: 5000, includeShipping: false, targetDiscountPercent: 0 };
    const first = await service.createTask("buyer", "merchant", config, "postgres-request-key");
    const repeated = await service.createTask("buyer", "merchant", config, "postgres-request-key");
    assert.equal(first.id, repeated.id);
    assert.equal((await repository.find("buyer", "merchant"))!.state.tasks.length, 1);
    await assert.rejects(() => service.createTask("buyer", "merchant", { ...config, targetCents: 6000 }, "postgres-request-key"),
      (error: any) => error.code === "agent_idempotency_conflict");
  });
  it("only one worker claims a due workspace, and only its owner can release it", async () => {
    const due = (await repository.find("buyer", "merchant"))!;
    await repository.compareAndSwap(due, due.state, new Date(0));
    const now = new Date();
    const [first, second] = await Promise.all([repository.claimDue(now, "first", 1), repository.claimDue(now, "second", 1)]);
    assert.equal(first.length + second.length, 1);
    const claimed = [...first, ...second][0]!;
    await repository.release(claimed.id, "outsider");
    assert.equal((await repository.find("buyer", "merchant"))!.leaseId, claimed.leaseId);
    await repository.release(claimed.id, claimed.leaseId!);
    assert.equal((await repository.find("buyer", "merchant"))!.leaseId, null);
  });
  it("a new client recovers persisted state and the buyer export includes its store", async () => {
    const restarted = new PrismaClient({ datasources: { db: { url: schemaUrl } } });
    try {
      const row = await new PrismaShoppingRepository(restarted).find("buyer", "merchant");
      assert.equal(row?.state.settings.maxDailyNotifications, 7);
      assert.deepEqual(row?.state.settings.appearance, { version: 1, style: "visor", color: "ocean", expression: "happy" });
      const exported = await new PrismaBuyerAccountLgpdRepository(restarted).listShoppingWorkspacesForExport("buyer");
      assert.equal(exported.length, 1); assert.equal((exported[0] as { merchantId: string }).merchantId, "merchant");
    } finally { await restarted.$disconnect(); }
  });
  it("deleting a buyer cascades its workspaces while preserving another buyer", async () => {
    await repository.create("other", "merchant", settings());
    await prisma.$executeRawUnsafe('DELETE FROM "buyer_accounts" WHERE "global_user_id" = \'buyer\'');
    assert.equal(await repository.find("buyer", "merchant"), null);
    assert.ok(await repository.find("other", "merchant"));
  });
});
