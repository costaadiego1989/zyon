import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { PrismaM2MManagementStore } from "../infrastructure/prisma-m2m-management.store.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

// The explicit disposable runner verifies its generated URL and UUID marker
// before enabling this opt-in spec. No M2M session/expiry model is invented here.
test(
  "M2M management Prisma persistence: agents, reputation, protocol config and tenant isolation",
  { skip: runPrisma ? false : "Requires the explicit owned disposable legacy Prisma runner." },
  async (t) => {
    const prisma = createPrismaClient();
    const store = new PrismaM2MManagementStore(prisma);
    const merchantId = `mrc_m2m_${randomUUID()}`;
    const otherMerchantId = `mrc_m2m_${randomUUID()}`;
    const globalUserId = `usr_m2m_${randomUUID()}`;
    const expiresAt = new Date("2035-01-02T03:04:05.000Z");
    const input = {
      merchantId, globalUserId, displayName: "Synthetic M2M agent",
      status: "active" as const, m2mSecretHash: null,
      scopes: ["read", "negotiate"], expiresAt,
    };
    let agentId = "";

    try {
      await t.test("create and read preserve scalar fields and nested reputation defaults", async () => {
        const created = await store.createAgent(input);
        agentId = created.id;
        assert.ok(agentId.length > 0);
        assert.equal(created.merchantId, merchantId);
        assert.equal(created.globalUserId, globalUserId);
        assert.equal(created.displayName, input.displayName);
        assert.equal(created.status, "active");
        assert.equal(created.m2mSecretHash, null);
        assert.deepEqual(created.scopes, ["read", "negotiate"]);
        assert.equal(created.expiresAt?.toISOString(), expiresAt.toISOString());
        assert.ok(created.createdAt instanceof Date);
        assert.ok(created.updatedAt instanceof Date);
        assert.deepEqual(created.reputation, { transactionCount: 0, disputeCount: 0, reputationScore: 100 });
        assert.deepEqual(await store.findAgentById(merchantId, agentId), created);
        assert.deepEqual(await store.listAgents(merchantId), [created]);
      });

      await t.test("same buyer can exist in two tenants but duplicate creation is atomic within one", async () => {
        assert.ok(agentId);
        assert.equal(await store.findAgentById(otherMerchantId, agentId), null);
        assert.deepEqual(await store.listAgents(otherMerchantId), []);
        const other = await store.createAgent({ ...input, merchantId: otherMerchantId, displayName: "Other tenant agent" });
        assert.notEqual(other.id, agentId);
        assert.deepEqual((await store.listAgents(merchantId)).map(agent => agent.id), [agentId]);
        assert.deepEqual((await store.listAgents(otherMerchantId)).map(agent => agent.id), [other.id]);
        const reputationCount = await prisma.agentReputation.count();
        await assert.rejects(store.createAgent(input), error =>
          typeof error === "object" && error !== null && "code" in error && error.code === "P2002");
        assert.equal(await prisma.buyerAgent.count({ where: { merchantId, globalUserId } }), 1);
        assert.equal(await prisma.agentReputation.count(), reputationCount);
      });

      await t.test("status mutation is scoped by merchant and missing agents are a no-op", async () => {
        assert.ok(agentId);
        await store.updateAgentStatus(otherMerchantId, agentId, "suspended");
        assert.equal((await store.findAgentById(merchantId, agentId))?.status, "active");
        await store.updateAgentStatus(merchantId, "synthetic-missing-agent", "suspended");
        await store.updateAgentStatus(merchantId, agentId, "suspended");
        assert.equal((await store.findAgentById(merchantId, agentId))?.status, "suspended");
        const other = (await store.listAgents(otherMerchantId))[0];
        assert.equal(other?.status, "active");
      });

      await t.test("protocol configuration upsert preserves omitted fields and tenant boundaries", async () => {
        assert.equal(await store.getConfig(merchantId), null);
        assert.equal(await store.getConfig(otherMerchantId), null);
        assert.deepEqual(await store.upsertConfig(merchantId, {}), {
          merchantId, enabled: false, webhookUrl: null, webhookEndpointId: null, maxSessionTtlMinutes: 30,
        });
        const enabled = await store.upsertConfig(merchantId, {
          enabled: true, webhookUrl: "https://synthetic.invalid/m2m", webhookEndpointId: "synthetic-endpoint", maxSessionTtlMinutes: 15,
        });
        assert.deepEqual(await store.upsertConfig(merchantId, { maxSessionTtlMinutes: 45 }), { ...enabled, maxSessionTtlMinutes: 45 });
        assert.equal(await prisma.m2MProtocolConfig.count({ where: { merchantId } }), 1);
        assert.equal(await store.getConfig(otherMerchantId), null);
        assert.equal((await store.upsertConfig(otherMerchantId, {})).enabled, false);
        assert.equal((await store.getConfig(merchantId))?.enabled, true);
      });

      await t.test("reputation reads persisted values and deletion cascades only to its own reputation", async () => {
        assert.ok(agentId);
        await prisma.agentReputation.update({ where: { agentId }, data: {
          transactionCount: { increment: 2 }, disputeCount: { increment: 1 }, reputationScore: 90,
        } });
        const expected = { transactionCount: 2, disputeCount: 1, reputationScore: 90 };
        assert.deepEqual((await store.findAgentById(merchantId, agentId))?.reputation, expected);
        assert.deepEqual((await store.listAgents(merchantId))[0]?.reputation, expected);
        const other = (await store.listAgents(otherMerchantId))[0];
        assert.ok(other);
        await prisma.buyerAgent.delete({ where: { id: agentId } });
        assert.equal(await store.findAgentById(merchantId, agentId), null);
        assert.equal(await prisma.agentReputation.findUnique({ where: { agentId } }), null);
        assert.deepEqual((await store.findAgentById(otherMerchantId, other.id))?.reputation,
          { transactionCount: 0, disputeCount: 0, reputationScore: 100 });
      });
    } finally {
      try {
        await prisma.buyerAgent.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
        await prisma.m2MProtocolConfig.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      } finally { await prisma.$disconnect(); }
    }
  }
);
