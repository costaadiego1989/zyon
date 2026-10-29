import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../domain/ports/merchant-agent-rule-reader.port.js";
import { PrismaMerchantAgentRuleReader } from "./merchant-agent-rule-reader.adapter.js";
import { AgentRuleReaderModule } from "../agent-rule-reader.module.js";

const primaryQuery = (merchantId: string) => ({ where: { merchantId, agentId: "default", userId: null, scope: "merchant_default" } });
const legacyQuery = (merchantId: string) => ({ where: { merchantId, scope: "user_agent", agentId: { startsWith: "agt_" } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
const current = { id: "PRIVATE_RULE", merchantId: "merchant-a", identity: { agentName: "Lia", tone: "friendly" }, checkoutSettings: { agentMode: "proactive" }, guardrails: "PRIVATE_POLICY" };
const projection = { identity: current.identity, checkoutSettings: current.checkoutSettings };

function fixture(results: Array<unknown | Error>) {
  const queries: unknown[] = [];
  const prisma = { agentRule: { findFirst: async (query: unknown) => {
    queries.push(query); const value = results.shift(); if (value instanceof Error) throw value; return value ?? null;
  } } } as unknown as PrismaClient;
  return { prisma, queries, reader: new PrismaMerchantAgentRuleReader(prisma) };
}

test("reader retains merchant_default precedence and exposes only the public projection", async () => {
  const f = fixture([current, { identity: { agentName: "Legacy" }, checkoutSettings: {} }]);
  const result = await f.reader.findForMerchant("merchant-a");
  assert.deepEqual(result, projection);
  assert.deepEqual(f.queries, [primaryQuery("merchant-a")]);
  assert.deepEqual(Object.keys(result!).sort(), ["checkoutSettings", "identity"]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});

test("reader retains the exact scoped legacy fallback and updatedAt/id ordering", async () => {
  const f = fixture([null, current]);
  assert.deepEqual(await f.reader.findForMerchant("merchant-a"), projection);
  assert.deepEqual(f.queries, [primaryQuery("merchant-a"), legacyQuery("merchant-a")]);
});

test("reader returns null when both current and legacy configuration are absent", async () => {
  const f = fixture([null, null]);
  assert.equal(await f.reader.findForMerchant("merchant-a"), null);
  assert.deepEqual(f.queries, [primaryQuery("merchant-a"), legacyQuery("merchant-a")]);
});

test("reader preserves null JSON projection fields without fabricating defaults", async () => {
  const f = fixture([{ identity: null, checkoutSettings: null }]);
  assert.deepEqual(await f.reader.findForMerchant("merchant-a"), { identity: null, checkoutSettings: null });
});

for (const primaryFails of [true, false]) {
  test(`reader propagates the original ${primaryFails ? "current" : "legacy"} read failure`, async () => {
    const failure = new Error("synthetic-read-error");
    const f = fixture(primaryFails ? [failure] : [null, failure]);
    await assert.rejects(f.reader.findForMerchant("merchant-a"), error => error === failure);
    assert.deepEqual(f.queries, primaryFails ? [primaryQuery("merchant-a")] : [primaryQuery("merchant-a"), legacyQuery("merchant-a")]);
  });
}

test("reader performs independent scoped reads for two merchants without cache or cross-tenant state", async () => {
  const f = fixture([current, null, { identity: { agentName: "B" }, checkoutSettings: {} }]);
  assert.deepEqual(await f.reader.findForMerchant("merchant-a"), projection);
  assert.deepEqual(await f.reader.findForMerchant("merchant-b"), { identity: { agentName: "B" }, checkoutSettings: {} });
  assert.deepEqual(f.queries, [primaryQuery("merchant-a"), primaryQuery("merchant-b"), legacyQuery("merchant-b")]);
});

test("provider-only module resolves the real adapter with the existing Prisma token and no lifecycle", async () => {
  const f = fixture([current]);
  class TestPersistenceModule {}
  Global()(TestPersistenceModule);
  Module({ providers: [{ provide: PRISMA_CLIENT, useValue: f.prisma }], exports: [PRISMA_CLIENT] })(TestPersistenceModule);
  class ReaderContractModule {}
  Module({ imports: [TestPersistenceModule, AgentRuleReaderModule] })(ReaderContractModule);
  const context = await NestFactory.createApplicationContext(ReaderContractModule, { logger: false });
  try {
    const reader = context.get<MerchantAgentRuleReaderPort>(MERCHANT_AGENT_RULE_READER);
    assert.ok(reader instanceof PrismaMerchantAgentRuleReader);
    assert.equal(reader, context.get(PrismaMerchantAgentRuleReader));
    assert.deepEqual(await reader.findForMerchant("merchant-a"), projection);
    assert.deepEqual(f.queries, [primaryQuery("merchant-a")]);
  } finally { await context.close(); }
});

