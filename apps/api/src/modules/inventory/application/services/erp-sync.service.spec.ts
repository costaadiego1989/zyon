import assert from "node:assert/strict";
import test from "node:test";
import { ErpSyncService } from "./erp-sync.service.js";

const applied = {
  receiptId: "receipt_a",
  event: { merchantId: "merchant_a", orderId: "order_a", items: [], totalCents: 0, timestamp: "2026-09-13T00:00:00.000Z" },
  stockDecrementedCount: 1,
  idempotent: false,
  items: [{ sku: "SKU", itemId: "item_a", locationId: "warehouse_a", quantity: 2, remainingQuantity: 7 }],
};

test("ERP sale work is persisted once per connection before any remote request", async () => {
  const jobs: any[] = [];
  let creates = 0;
  const prisma = {
    erpConnection: {
      findMany: async () => [{ id: "connection_a" }],
    },
    erpSyncJob: {
      create: async ({ data }: any) => {
        creates += 1;
        if (creates > 1) {
          const error: any = new Error("duplicate");
          error.code = "P2002";
          throw error;
        }
        jobs.push({ id: "job_a", ...data });
        return jobs[0];
      },
      findUnique: async () => jobs[0],
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
  };
  const service = new ErpSyncService(prisma as never);

  await service.enqueueSale(applied);
  await service.enqueueSale(applied);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, "sale");
  assert.equal(jobs[0].dedupeKey, "sale:connection_a:receipt_a");
  assert.deepEqual(jobs[0].payload, { receiptId: "receipt_a" });
});

test("expired ERP leases return to the durable queue after a worker crash", async () => {
  const calls: any[] = [];
  const prisma = {
    erpSyncJob: {
      updateMany: async (input: any) => {
        calls.push(input);
        return { count: 1 };
      },
      findMany: async () => [],
    },
  };
  const service = new ErpSyncService(prisma as never);

  await service.drain();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.status, "running");
  assert.equal(calls[0].data.status, "queued");
  assert.equal(calls[0].data.lockedUntil, null);
  assert.equal(calls[0].data.lastErrorCode, "erp_worker_lease_expired");
});

test("a repeated ERP webhook shares one persisted snapshot job", async () => {
  const jobs: any[] = [];
  const prisma = {
    erpConnection: { findFirst: async () => ({ id: "connection_a", merchantId: "merchant_a", provider: "bling", status: "connected" }) },
    erpSyncJob: {
      create: async ({ data }: any) => {
        if (jobs.length) {
          const error: any = new Error("duplicate"); error.code = "P2002"; throw error;
        }
        jobs.push({ id: "job_a", ...data }); return jobs[0];
      },
      findUnique: async () => jobs[0],
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
  };
  const service = new ErpSyncService(prisma as never);

  await service.enqueueWebhookFull("merchant_a", "connection_a", "event_a");
  await service.enqueueWebhookFull("merchant_a", "connection_a", "event_a");

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].dedupeKey, "webhook:full:connection_a:event_a");
});
