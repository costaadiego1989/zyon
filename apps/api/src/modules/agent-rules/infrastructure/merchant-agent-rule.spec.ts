import test from "node:test";
import assert from "node:assert/strict";
import { AgentRulesEntity } from "../domain/entities/agent-rules.entity.js";
import { PrismaAgentRulesRepository } from "./prisma-agent-rules.repository.js";
import { findMerchantAgentRule } from "./find-merchant-agent-rule.js";
import { UpdateAgentRulesUseCase } from "../application/agent-rules.use-cases.js";

test("canonical public identity wins and named agents are never selected", async () => {
  let calls = 0;
  const row = { identity: { agentName: "Canonical" } };
  const prisma = { agentRule: { findFirst: async ({ where }: any) => {
    calls++;
    assert.deepEqual(where, { merchantId: "m1", agentId: "default", userId: null, scope: "merchant_default" });
    return row;
  } } } as any;
  assert.equal(await findMerchantAgentRule(prisma, "m1"), row);
  assert.equal(calls, 1);
});

test("legacy user settings survive first merchant save without overwriting the private record", async () => {
  const legacy = AgentRulesEntity.createDefault({ merchantId: "m1", userId: "u1" }).update({ identity: { agentName: "Legacy", persona: "Shop concierge" } }).snapshot();
  const row = { ...legacy, userId: "u1", createdAt: new Date(legacy.createdAt), updatedAt: new Date(legacy.updatedAt) };
  let write: any;
  const prisma = { agentRule: {
    findFirst: async ({ where, orderBy }: any) => {
      assert.equal(where.merchantId, "m1");
      if (where.scope === "merchant_default") return null;
      assert.deepEqual(where.agentId, { startsWith: "agt_" });
      assert.deepEqual(orderBy, [{ updatedAt: "desc" }, { id: "asc" }]);
      return row;
    },
    upsert: async (input: any) => { write = input; return { ...input.create, userId: null, createdAt: new Date(legacy.createdAt) }; },
  } } as any;
  const repo = new PrismaAgentRulesRepository(prisma);
  assert.equal((await repo.getDefault("m1"))?.identity.agentName, "Legacy");
  await new UpdateAgentRulesUseCase(repo).execute({ merchantId: "m1" }, { identity: { greeting: "Olá!" } });
  assert.deepEqual(write.where, { merchantId_agentId: { merchantId: "m1", agentId: "default" } });
  assert.equal(write.create.scope, "merchant_default");
  assert.equal(write.create.identity.persona, "Shop concierge");
  assert.equal(write.create.identity.greeting, "Olá!");
});
