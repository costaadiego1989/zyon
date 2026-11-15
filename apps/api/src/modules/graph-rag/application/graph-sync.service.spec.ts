import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicBusinessReconciler, type PublicBusinessSourcePagePort } from "./public-business-reconciler.js";
import { GraphRagSynchronization } from "./graph-sync.service.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";

test("T65", async t => {
  await t.test("scheduled synchronization normalizes scoped work even when the graph reader is unavailable", async () => {
    const tenant = new TenantContextService(), stored = new Set<string>();
    const runtime = { settings: { enabled: true, merchantIds: ["tenant-a"] }, readyFor: () => false };
    const publicBusiness = new PublicBusinessReconciler({ pageIdentities: async (merchantId, type) => ({ sourceIds: [merchantId + ":" + type] }) },
      { normalizeCurrent: async (merchantId, type, id) => {
        assert.equal(tenant.get()?.merchantId, merchantId);
        stored.add(type + "/" + id);
      } });
    const sync = new GraphRagSynchronization(runtime as any, {} as any, {} as any, {} as any, tenant, publicBusiness);
    await sync.reconcile();
    assert.deepEqual([...stored], ["company", "business_hours", "professional", "service", "faq", "policy"].map(type => type + "/tenant-a:" + type));
    const snapshot = [...stored];await sync.synchronize("tenant-b");assert.deepEqual([...stored], snapshot);
    runtime.settings.enabled = false;stored.clear();await sync.reconcile();assert.equal(stored.size, 0);
    await sync.beforeApplicationShutdown();
  });

  await t.test("actual event and periodic paths retry failed normalization without graph calls", async () => {
    const tenant = new TenantContextService(), handlers = new Map<string, (event: any) => Promise<void>>();
    const stored = new Set<string>();let failure = true;
    const runtime = { settings: { enabled: true, merchantIds: ["tenant-a"] }, readyFor: () => false };
    const sync = new GraphRagSynchronization(runtime as any, {} as any, {} as any,
      { subscribe: (kind: string, handler: (event: any) => Promise<void>) => handlers.set(kind, handler) } as any, tenant,
      { reconcile: async (merchantId: string) => {
        assert.equal(tenant.get()?.merchantId, merchantId);
        if (failure) throw Error("synthetic-source-temporarily-offline");
        stored.add("current:" + merchantId);
      } });
    try {
      sync.onModuleInit();await sync.synchronize("tenant-a");assert.deepEqual([...stored], []);
      failure = false;await handlers.get("support.faq_updated")!({ merchantId: "tenant-a", payload: { private: "not-source-authority" } });
      assert.deepEqual([...stored], ["current:tenant-a"]);
      stored.clear();await sync.reconcile();assert.deepEqual([...stored], ["current:tenant-a"]);
    } finally { await sync.beforeApplicationShutdown(); }
  });

  await t.test("shutdown drains pending canonical work and prevents the next normalization", async () => {
    let started!: () => void, release!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const stored: string[] = [], tenant = new TenantContextService();
    const runtime = { settings: { enabled: true, merchantIds: ["tenant-a"] }, readyFor: () => false };
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async (_merchantId, type) => ({ sourceIds: [type] }) },
      { normalizeCurrent: async (_merchantId, _type, id) => { started();await hold;stored.push(id); } });
    const sync = new GraphRagSynchronization(runtime as any, {} as any, {} as any, {} as any, tenant, reconciler);
    const pending = sync.reconcile();await began;
    const closing = sync.beforeApplicationShutdown();await sync.synchronize("tenant-a");
    assert.deepEqual(stored, []);release();await Promise.all([pending, closing]);
    assert.deepEqual(stored, ["company"]);
    await sync.reconcile();assert.deepEqual(stored, ["company"]);
  });

  await t.test("normalizes the six ordinary public source kinds independently of any graph provider", async () => {
    const state = new Map<string, string>();
    const reconciler = new PublicBusinessReconciler({
      pageIdentities: async (merchantId, type) => ({ sourceIds: [`${merchantId}:${type}`] }),
    }, { normalizeCurrent: async (merchantId, type, sourceId) => {
      state.set(`${merchantId}/${type}/${sourceId}`, "current");
    } });
    await reconciler.reconcile("tenant-a");
    assert.deepEqual([...state.keys()], ["company", "business_hours", "professional", "service", "faq", "policy"]
      .map(type => `tenant-a/${type}/tenant-a:${type}`));
    assert.equal([...state.values()].every(value => value === "current"), true);
  });

  await t.test("bounded passes resume a large source set and eventually include its final page", async () => {
    const pages: Array<string | undefined> = [], ids = new Set<string>();
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async (_merchant, type, cursor, limit) => {
      assert.equal(limit, 100);
      if (type !== "service") return { sourceIds: [] };
      pages.push(cursor);
      const index = cursor === undefined ? 0 : Number(cursor);
      return { sourceIds: [`service-${index}`], ...(index < 4 ? { nextCursor: String(index + 1) } : {}) };
    } }, { normalizeCurrent: async (_merchant, type, id) => { if (type === "service") ids.add(id); } });
    await reconciler.reconcile("tenant-a");
    assert.deepEqual(pages, [undefined, "1"]);
    await reconciler.reconcile("tenant-a");
    await reconciler.reconcile("tenant-a");
    assert.deepEqual(pages, [undefined, "1", "2", "3", "4"]);
    assert.deepEqual([...ids], ["service-0", "service-1", "service-2", "service-3", "service-4"]);
  });

  await t.test("failed page remains replayable after an offline normalization failure", async () => {
    const stored = new Set<string>(); let unavailable = true;
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async (_merchant, type) =>
      ({ sourceIds: type === "faq" ? ["old-removed", "new-published"] : [] }) }, {
      normalizeCurrent: async (_merchant, _type, id) => {
        if (id === "new-published" && unavailable) throw new Error("canonical_unavailable");
        stored.add(id);
      },
    });
    await assert.rejects(reconciler.reconcile("tenant-a"), /canonical_unavailable/);
    assert.deepEqual([...stored], ["old-removed"]);
    unavailable = false;
    await reconciler.reconcile("tenant-a");
    assert.deepEqual([...stored], ["old-removed", "new-published"]);
  });

  await t.test("tenant cursors stay separate and a fresh worker safely replays from the start", async () => {
    const visited: string[] = [];
    const sources: PublicBusinessSourcePagePort = { pageIdentities: async (merchant, type, cursor) => {
      if (type !== "professional") return { sourceIds: [] };
      visited.push(`${merchant}:${cursor ?? "start"}`);
      const index = cursor === undefined ? 0 : Number(cursor);
      return { sourceIds: [`${merchant}-${index}`], nextCursor: String(index + 1) };
    } };
    const stored = new Map<string, number>();
    const work = { normalizeCurrent: async (merchant: string, _type: unknown, id: string) => {
      stored.set(`${merchant}:${id}`, 1);
    } };
    const reconciler = new PublicBusinessReconciler(sources, work);
    await reconciler.reconcile("tenant-a"); await reconciler.reconcile("tenant-b");
    await reconciler.reconcile("tenant-a");
    await new PublicBusinessReconciler(sources, work).reconcile("tenant-a");
    assert.deepEqual(visited, ["tenant-a:start", "tenant-a:1", "tenant-b:start", "tenant-b:1", "tenant-a:2", "tenant-a:3", "tenant-a:start", "tenant-a:1"]);
    assert.equal(stored.size, 6);
    assert.deepEqual([...stored.values()], Array(6).fill(1));
  });

  await t.test("shutdown after an awaited page prevents new normalization or a second page", async () => {
    let stopping = false; const stored: string[] = [];
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async () => {
      stopping = true; return { sourceIds: ["not-started"], nextCursor: "next" };
    } }, { normalizeCurrent: async (_merchant, _type, id) => { stored.push(id); } });
    await reconciler.reconcile("tenant-a", () => stopping);
    assert.deepEqual(stored, []);
  });

  await t.test("invalid or looping pages cannot acknowledge a cursor or enqueue unrelated identities", async () => {
    const stored: string[] = [];
    let calls = 0;
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async () => {
      calls++; return { sourceIds: ["first"], nextCursor: "same" };
    } }, { normalizeCurrent: async (_merchant, _type, id) => { stored.push(id); } });
    await assert.rejects(reconciler.reconcile("tenant-a"), /public_reconciliation_page_invalid/);
    assert.equal(calls, 2); assert.deepEqual(stored, ["first"]);
    await assert.rejects(reconciler.reconcile(" "), /public_reconciliation_scope_invalid/);
    assert.equal(calls, 2);
  });
});
