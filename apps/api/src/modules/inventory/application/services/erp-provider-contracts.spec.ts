import assert from "node:assert/strict";
import test from "node:test";
import { ErpSyncService } from "./erp-sync.service.js";
import { ConnectOmieUseCase } from "../use-cases/connect-omie.use-case.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

const tinyConnection = { accessTokenCipher: encryptErpSecret("test-tiny-token") };
const omieConnection = { accessTokenCipher: encryptErpSecret("test-app-key"), refreshTokenCipher: encryptErpSecret("test-app-secret") };
function reply(retorno: unknown) {
  return new Response(JSON.stringify({ retorno }), { headers: { "x-limit-api": "60000" } });
}

for (const stock of [
  { saldo: 10 },
  { saldo: 10, depositos: [{ deposito: { saldo: 10, desconsiderar: "N" } }, { deposito: { saldo: 50, desconsiderar: "S" } }] },
]) {
  test(`Tiny imports its authoritative balance with deposits=${Boolean(stock.depositos)}`, async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      if (String(url).includes("pdv.produtos")) return reply({ status: "OK", produtos: [{ produto: { id: "123" } }], numero_paginas: 1 });
      if (String(url).includes("produto.obter.php")) return reply({ status: "OK", produto: { codigo: "TEST-123", nome: "Teste", preco: 1, tipo: "P" } });
      return reply({ status: "OK", produto: stock });
    }) as typeof fetch;
    t.after(() => { globalThis.fetch = original; });
    const snapshots = await (new ErpSyncService({} as never) as any).pullTiny(tinyConnection);
    assert.equal(snapshots[0].quantity, 10);
    assert.equal(snapshots[0].salePriceCents, 100);
  });
}

test("Tiny rejects missing stock instead of erasing the local snapshot", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("pdv.produtos")) return reply({ status: "OK", produtos: [{ produto: { id: "123" } }] });
    return reply({ status: "OK", produto: { codigo: "TEST-123", nome: "Teste" } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(() => (new ErpSyncService({} as never) as any).pullTiny(tinyConnection), /erp_tiny_stock_missing/);
});

test("Tiny sends the documented nested stock payload for absolute balance", async (t) => {
  const original = globalThis.fetch;
  let payload: any;
  globalThis.fetch = (async (_: any, options: RequestInit) => {
    payload = JSON.parse(new URLSearchParams(String(options.body)).get("estoque")!);
    return reply({ status: "OK", registros: [{ registro: { status: "OK", saldoEstoque: 7 } }] });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  await (new ErpSyncService({} as never) as any).pushTinySnapshot(tinyConnection, "123", 7, "receipt-key");
  assert.equal(payload.estoque.idProduto, 123);
  assert.equal(payload.estoque.tipo, "B");
  assert.equal(payload.estoque.quantidade, "7");
  assert.equal(payload.estoque.observacoes, "Zyon receipt-key");
  assert.equal(payload.estoque.data, undefined, "Tiny should supply its local current timestamp");
});

for (const failure of [
  { status: "Erro", codigo_erro: 20 },
  { status: "OK", registros: [{ registro: { status: "Erro", codigo_erro: 32 } }] },
  { status: "OK", registros: { registro: { status: "Erro", codigo_erro: 32 } } },
  { status: "OK", registros: { status: "Erro", codigo_erro: 32 } },
  {},
]) {
  test(`Tiny refuses rejected or malformed stock acknowledgments ${JSON.stringify(failure)}`, async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => reply(failure)) as typeof fetch;
    t.after(() => { globalThis.fetch = original; });
    await assert.rejects(() => (new ErpSyncService({} as never) as any).pushTinySnapshot(tinyConnection, "123", 7, "receipt-key"), /erp_tiny_/);
  });
}

test("Tiny accepts code 20 only for the empty product listing", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => reply({ status: "Erro", codigo_erro: 20 })) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  assert.deepEqual(await (new ErpSyncService({} as never) as any).pullTiny(tinyConnection), []);
});

test("Omie includes products without movements and imports zero stock with price", async (t) => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_: any, options: RequestInit) => {
    request = JSON.parse(String(options.body));
    return new Response(JSON.stringify({ nTotPaginas: 1, produtos: [{ nCodProd: 123, cCodigo: "OMIE-123", cDescricao: "Teste", nSaldo: 0, nPrecoUnitario: 1 }] }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const result = await (new ErpSyncService({} as never) as any).pullOmie(omieConnection);
  assert.equal(request.param[0].cExibeTodos, "S");
  assert.equal(result[0].quantity, 0);
  assert.equal(result[0].salePriceCents, 100);
});

test("Omie does not persist a connected state for an HTTP 200 API fault", async (t) => {
  const original = globalThis.fetch;
  let stored = false;
  globalThis.fetch = (async () => new Response(JSON.stringify({ faultcode: "AUTH", faultstring: "Invalid credentials" }))) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const useCase = new ConnectOmieUseCase({ upsert: async () => { stored = true; } } as never);
  await assert.rejects(() => useCase.execute({ merchantId: "merchant_a", appKey: "test", appSecret: "test" }), /omie_validation_failed/);
  assert.equal(stored, false);
});

test("mixed-provider cart pushes only the items mapped to this ERP account", async (t) => {
  const original = globalThis.fetch;
  const writes: any[] = [];
  globalThis.fetch = (async (_: any, options: RequestInit) => {
    writes.push(JSON.parse(new URLSearchParams(String(options.body)).get("estoque")!));
    return reply({ status: "OK" });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const service = new ErpSyncService({
    inventorySaleReceipt: { findFirst: async () => ({ orderId: "order_a", result: { items: [
      { sku: "BLING-ONLY", itemId: "item_bling", quantity: 1, remainingQuantity: 7 },
      { sku: "TINY-ONLY", itemId: "item_tiny", quantity: 1, remainingQuantity: 10 },
      { sku: "LOCAL-ONLY", itemId: "item_local", quantity: 1, remainingQuantity: 3 },
    ] } }) },
    erpProductMapping: { findFirst: async ({ where }: any) => {
      assert.equal(where.merchantId, "merchant_a");
      assert.equal(where.connectionId, "tiny_connection");
      return where.sku === "TINY-ONLY" ? { externalProductId: "123" } : null;
    } },
  } as never);
  await (service as any).pushSale({ ...tinyConnection, id: "tiny_connection", provider: "tiny" }, "merchant_a", "receipt_a");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].estoque.idProduto, 123);
  assert.equal(writes[0].estoque.quantidade, "10");
});


test("Omie stock adjustments use the Brazil date when the server has passed UTC midnight", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-14T02:30:00.000Z") });
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = (async (_: any, options: RequestInit) => {
    request = JSON.parse(String(options.body));
    return new Response(JSON.stringify({ codigo_status: "0", id_ajuste: 123 }));
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  await (new ErpSyncService({} as never) as any).pushOmieSale(omieConnection, "123", 1, "order_a", "receipt-key");
  assert.equal(request.param[0].data, "13/09/2026");
  assert.equal(request.param[0].tipo, "SAI");
  assert.equal(request.param[0].codigo_local_estoque, 0);
  assert.equal(request.param[0].valor, 0);
});

for (const failure of [{ faultcode: "AUTH" }, { codigo_status: "99" }]) {
  test(`Omie refuses HTTP 200 failures ${JSON.stringify(failure)}`, async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(failure))) as typeof fetch;
    t.after(() => { globalThis.fetch = original; });
    await assert.rejects(() => (new ErpSyncService({} as never) as any).pushOmieSale(omieConnection, "123", 1, "order_a", "receipt-key"), /erp_omie_api_error/);
  });
}

test("Tiny accepts a single object stock acknowledgment", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => reply({ status: "OK", registros: { registro: { status: "OK", saldoEstoque: 7 } } })) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  await (new ErpSyncService({} as never) as any).pushTinySnapshot(tinyConnection, "123", 7, "receipt-key");
});
