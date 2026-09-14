import assert from "node:assert/strict";
import test from "node:test";
import { ErpSyncService } from "./erp-sync.service.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

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

test("an existing Bling connection registers its canonical webhook route before a snapshot", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { id: "company_42" } }), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const routes: any[] = [];
  const service = new ErpSyncService({
    erpWebhookRoute: {
      findUnique: async () => null,
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ create }: any) => { routes.push(create); return create; },
    },
  } as never);

  await (service as any).ensureBlingWebhookRoute({
    id: "connection_a",
    merchantId: "merchant_a",
    provider: "bling",
    accessTokenCipher: encryptErpSecret("opaque-access-token"),
    tokenExpiresAt: new Date(Date.now() + 5 * 60_000),
  });

  assert.deepEqual(routes, [{ provider: "bling", externalAccountId: "company_42", merchantId: "merchant_a", connectionId: "connection_a" }]);
});

test("Bling imports the authoritative physical balance endpoint for each product snapshot", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/produtos")) {
      return { ok: true, json: async () => ({ data: [{ id: 123, codigo: "BLING-123", nome: "Produto de teste" }] }) } as Response;
    }
    if (url.pathname.endsWith("/produtos/123")) {
      return { ok: true, json: async () => ({ data: { id: 123, codigo: "BLING-123", nome: "Produto de teste", tipo: "P", preco: 19.9 } }) } as Response;
    }
    if (url.pathname.endsWith("/estoques/saldos")) {
      return { ok: true, json: async () => ({ data: [{ produto: { id: 123 }, saldoFisicoTotal: 7, saldoVirtualTotal: 5 }] }) } as Response;
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = new ErpSyncService({} as never);
  const snapshots = await (service as any).pullBling({
    accessTokenCipher: encryptErpSecret("access-token"),
    tokenExpiresAt: new Date(Date.now() + 5 * 60_000),
  });

  assert.deepEqual(snapshots, [{
    externalProductId: "123", externalLocationId: "0", sku: "BLING-123", productName: "Produto de teste",
    quantity: 7, costCents: undefined, salePriceCents: 1990,
  }]);
  const balanceRequest = urls.find((url) => url.pathname.endsWith("/estoques/saldos"));
  assert.ok(balanceRequest);
  assert.deepEqual(balanceRequest.searchParams.getAll("idsProdutos[]"), ["123"]);
});

test("Bling balances outbound stock in its active default deposit", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith("/depositos")) {
      return { ok: true, json: async () => ({ data: [{ id: 456, padrao: true, desconsiderarSaldo: false }] }) } as Response;
    }
    if (url.pathname.endsWith("/estoques")) return { ok: true, json: async () => ({ data: { id: 1 } }) } as Response;
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = new ErpSyncService({} as never);
  const depositId = await (service as any).blingDefaultDepositId("access-token");
  await (service as any).pushBlingSnapshot("access-token", "123", 7, "receipt-key", depositId);

  assert.equal(depositId, 456);
  const stockRequest = requests.find((request) => request.url.pathname.endsWith("/estoques"));
  assert.ok(stockRequest);
  assert.deepEqual(JSON.parse(String(stockRequest.init?.body)), {
    produto: { id: 123 }, deposito: { id: 456 }, operacao: "B", quantidade: 7, observacoes: "Zyon receipt-key",
  });
});

test("Bling retries a transient per-second rate limit before failing a snapshot job", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { period: "second" } }), { status: 429 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = new ErpSyncService({} as never);
  const startedAt = Date.now();
  const result = await (service as any).blingFetch("access-token", "/produtos?pagina=1&limite=100");

  assert.deepEqual(result, { data: [] });
  assert.equal(calls, 2);
  assert.ok(Date.now() - startedAt >= 300);
});

test("Bling day rate limits do not enter the short retry loop", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { period: "day" } }), { status: 429 });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const service = new ErpSyncService({} as never);
  await assert.rejects(() => (service as any).blingFetch("access-token", "/produtos?pagina=1&limite=100"), /erp_bling_rate_limit_day/);
  assert.equal(calls, 1);
});
