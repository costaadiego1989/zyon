import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicBusinessReconciler, type PublicBusinessSourcePagePort } from "./public-business-reconciler.js";

const ids = Array.from({ length: 251 }, (_, index) => "professional-" + String(index).padStart(3, "0"));
function fixture() {
  const stored = new Map<string, number>(), cursors: Array<string | undefined> = [];
  const pages: PublicBusinessSourcePagePort = {
    pageIdentities: async (_merchantId, type, cursor, limit) => {
      assert.equal(limit, 100);
      if (type !== "professional") return { sourceIds: [] };
      cursors.push(cursor);
      const offset = cursor === undefined ? 0 : ids.indexOf(cursor) + 1;
      assert.ok(cursor === undefined || offset > 0);
      const sourceIds = ids.slice(offset, offset + 100);
      return offset + sourceIds.length < ids.length
        ? { sourceIds, nextCursor: sourceIds[sourceIds.length - 1]! }
        : { sourceIds };
    },
  };
  const save = async (_merchantId: string, _type: string, sourceIds: string[]) => {
    for (const id of sourceIds) if (!stored.has(id)) stored.set(id, 1);
  };
  const legacy = async () => { throw new Error("unexpected_single_source_fallback"); };
  return { stored, cursors, pages, save, legacy };
}

test("T67", async t => {
  await t.test("bounded batches resume after two pages and restart preserves previously normalized revisions", async () => {
    const f = fixture(), work = { normalizeCurrent: f.legacy, normalizeCurrentPage: f.save };
    const reconciler = new PublicBusinessReconciler(f.pages, work);
    await reconciler.reconcile("tenant-a");
    assert.deepEqual([...f.stored.keys()], ids.slice(0, 200));
    await reconciler.reconcile("tenant-a");
    assert.deepEqual([...f.stored.keys()], ids);
    assert.deepEqual(f.cursors, [undefined, ids[99], ids[199]]);
    const before = [...f.stored];
    const restarted = new PublicBusinessReconciler(f.pages, work);
    await restarted.reconcile("tenant-a");await restarted.reconcile("tenant-a");
    assert.deepEqual([...f.stored], before);
  });

  await t.test("a failed second page retains the last committed cursor and retries that exact boundary", async () => {
    const f = fixture();let fail = true;
    const reconciler = new PublicBusinessReconciler(f.pages, {
      normalizeCurrent: f.legacy,
      normalizeCurrentPage: async (...args) => {
        if (fail && args[2][0] === ids[100]) throw new Error("synthetic_page_unavailable");
        await f.save(...args);
      },
    });
    await assert.rejects(reconciler.reconcile("tenant-a"), /synthetic_page_unavailable/);
    assert.deepEqual([...f.stored.keys()], ids.slice(0, 100));
    fail = false;await reconciler.reconcile("tenant-a");
    assert.deepEqual([...f.stored.keys()], ids);
    assert.deepEqual(f.cursors, [undefined, ids[99], ids[99], ids[199]]);
  });

  await t.test("stopping after one committed page permits safe replay before the remaining identities", async () => {
    const f = fixture();let stopping = false;
    const reconciler = new PublicBusinessReconciler(f.pages, {
      normalizeCurrent: f.legacy,
      normalizeCurrentPage: async (...args) => { await f.save(...args);stopping = true; },
    });
    await reconciler.reconcile("tenant-a", () => stopping);
    assert.deepEqual([...f.stored.keys()], ids.slice(0, 100));
    const before = [...f.stored];stopping = false;
    await reconciler.reconcile("tenant-a", () => false);
    await reconciler.reconcile("tenant-a", () => false);
    assert.deepEqual([...f.stored.keys()], ids);
    assert.deepEqual([...f.stored].slice(0, 100), before);
    assert.deepEqual(f.cursors, [undefined, undefined, ids[99], ids[199]]);
  });

  await t.test("invalid pages cannot reach either normalization writer", async () => {
    const stored = new Set<string>();
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async () => ({ sourceIds: ["duplicate", "duplicate"] }) }, {
      normalizeCurrent: async (_merchantId, _type, id) => { stored.add(id); },
      normalizeCurrentPage: async (_merchantId, _type, sourceIds) => { sourceIds.forEach(id => stored.add(id)); },
    });
    await assert.rejects(reconciler.reconcile("tenant-a"), /public_reconciliation_page_invalid/);
    assert.deepEqual([...stored], []);
  });

  await t.test("existing single-source callers retain scoped six-family normalization", async () => {
    const stored: string[] = [];
    const reconciler = new PublicBusinessReconciler({ pageIdentities: async (_merchantId, type) => ({ sourceIds: [type] }) }, {
      normalizeCurrent: async (merchantId, type, id) => { stored.push(merchantId + "/" + type + "/" + id); },
    });
    await reconciler.reconcile("tenant-a");
    assert.deepEqual(stored, ["company", "business_hours", "professional", "service", "faq", "policy"].map(type => "tenant-a/" + type + "/" + type));
  });
});
