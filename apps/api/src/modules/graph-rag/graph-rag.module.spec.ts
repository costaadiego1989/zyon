import test from "node:test";
import assert from "node:assert/strict";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { graphRagSettings } from "./graph-rag.settings.js";
import { GraphRagRuntime } from "./graph-rag.module.js";
import { GraphRagSynchronization } from "./application/graph-sync.service.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";

const valid = { NODE_ENV: "production", GRAPH_RAG_ENABLED: "true", GRAPH_RAG_MERCHANT_IDS: "shop-a",
  NEO4J_URI: "bolt://graph.internal:7687", NEO4J_READ_USER: "search", NEO4J_READ_PASSWORD: "read-fixture",
  NEO4J_WRITE_USER: "indexer", NEO4J_WRITE_PASSWORD: "write-fixture" };
test("RAG07 disabled zero network", async () => {
  let calls = 0;
  const runtime = new GraphRagRuntime(graphRagSettings({}), { admitReader: async () => { calls++;throw Error(); }, close: async () => {} } as any);
  await runtime.onModuleInit();
  assert.equal(runtime.enabledFor("shop-a"), false);
  assert.equal((await runtime.searchCatalog({ merchantId: "shop-a", query: "pele" })).status, "unavailable");
  const sync = new GraphRagSynchronization(runtime, {} as any, {} as any,
    { subscribe: () => { calls++; } } as any, new TenantContextService());
  sync.onModuleInit();await sync.synchronize("shop-a");await sync.beforeApplicationShutdown();
  assert.equal(calls, 0);
});
test("RAG08 production activation gate", async () => {
  for (const patch of [{ NEO4J_URI: undefined }, { NEO4J_READ_PASSWORD: undefined },
    { NEO4J_READ_USER: "indexer" }, { GRAPH_RAG_MERCHANT_IDS: "" }, { GRAPH_RAG_ENABLED: "1" },
    { NEO4J_URI: "bolt://user:password@graph.internal" }]) assert.equal(graphRagSettings({ ...valid, ...patch }).enabled, false);
  const runtime = new GraphRagRuntime(graphRagSettings(valid), { admitReader: async () => false, close: async () => {} } as any);
  await runtime.onModuleInit();
  assert.equal(runtime.readyFor("shop-a"), false);
  assert.deepEqual(await runtime.searchCatalog({ merchantId: "shop-a", query: "pele" }), { status: "unavailable", reason: "disabled" });
});
test("RAG07 scoped synchronization", async () => {
  const tenant = new TenantContextService(), calls: string[] = [], handlers = new Map<string, any>();
  const pages: string[] = [], lists: string[] = [];
  const runtime = { settings: { enabled: true, merchantIds: ["shop-a"] }, readyFor: (id: string) => id === "shop-a",
    projection: { projectCatalog: async source => { assert.equal(tenant.get()?.merchantId, "shop-a");calls.push(source.id);return { status: "applied" }; },
      projectDocument: async source => { calls.push(source.id);return { status: "applied" }; }, retireMissingCatalog: async (_id, ids) => { assert.deepEqual(ids, ["p1"]);calls.push("complete"); } } } as any;
  const sync = new GraphRagSynchronization(runtime,
    { page: async id => { pages.push(id);return { sources: [{ merchantId: id, id: "p1" }] }; } } as any,
    { list: async id => { lists.push(id);return [{ merchantId: id, id: "policy1" }]; } } as any,
    { subscribe: (type, handler) => handlers.set(type, handler) } as any, tenant);
  sync.onModuleInit();await sync.synchronize("shop-a");
  const before = calls.length;await sync.synchronize("shop-b");assert.equal(calls.length, before);
  assert.deepEqual(pages, ["shop-a"]);assert.deepEqual(lists, ["shop-a"]);
  assert.ok(handlers.has("product.deleted"));assert.ok(handlers.has("merchant.config_updated"));
  await handlers.get("support.faq_updated")({ merchantId: "shop-a", payload: { secret: "must-not-index" } });
  assert.equal(calls.includes("must-not-index"), false);
  assert.ok(calls.includes("policy1"));
  runtime.readyFor = () => false;
  await sync.synchronize("shop-a");assert.deepEqual(pages, ["shop-a", "shop-a"]);assert.deepEqual(lists, ["shop-a", "shop-a"]);
  await sync.beforeApplicationShutdown();
});

test("RAG09 shutdown drains synchronization before driver closure and rejects new work", async () => {
  const order: string[] = [];
  let release!: () => void, began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const runtime = { settings: { enabled: true, merchantIds: ["shop-a"] }, readyFor: () => true,
    projection: { projectCatalog: async () => { order.push("projection:start");began();await pending;order.push("projection:done");return { status: "applied" }; },
      retireMissingCatalog: async () => { order.push("retire"); } } } as any;
  let reads = 0;
  const sync = new GraphRagSynchronization(runtime,
    { page: async () => { reads++;return { sources: [{ merchantId: "shop-a", id: "p1" }] }; } } as any,
    { list: async () => { reads++;return []; } } as any, {} as any, new TenantContextService());
  const work = sync.synchronize("shop-a");await started;
  const graph = new GraphRagRuntime(graphRagSettings({}), { close: async () => { order.push("closed"); } } as any);
  let stoppingBegan!: () => void;
  const stopping = new Promise<void>(resolve => { stoppingBegan = resolve; });
  class DriverHarness {}
  Module({ providers: [{ provide: "driver", useValue: graph }] })(DriverHarness);
  class ShutdownHarness {}
  Module({ imports: [DriverHarness], providers: [{ provide: "sync", useValue: {
    beforeApplicationShutdown: async () => { stoppingBegan();await sync.beforeApplicationShutdown();order.push("drained"); },
  } }] })(ShutdownHarness);
  const app = await NestFactory.createApplicationContext(ShutdownHarness, { logger: false });
  const drain = app.close();await stopping;
  try { await sync.synchronize("shop-a");assert.equal(reads, 1);assert.deepEqual(order, ["projection:start"]); }
  finally { release();await drain;await work; }
  assert.deepEqual(order, ["projection:start", "projection:done", "drained", "closed"]);
});
test("incomplete enumeration cannot retire missing products and projection errors do not escape", async () => {
  let retires = 0;
  const runtime = { settings: { enabled: true, merchantIds: ["shop-a"] }, readyFor: () => true,
    projection: { retireMissingCatalog: async () => { retires++; }, projectCatalog: async () => ({ status: "applied" }) } } as any;
  const sync = new GraphRagSynchronization(runtime,
    { page: async () => ({ sources: [], nextCursor: "repeated" }) } as any, {} as any, {} as any, new TenantContextService());
  await sync.synchronize("shop-a");assert.equal(retires, 0);
});
