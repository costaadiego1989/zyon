import assert from "node:assert/strict";
import test from "node:test";
import { FiscalStockEvidenceReader } from "./fiscal-stock-evidence.reader.js";
const context: any = { identity: { merchantId: "m1", connectionId: "c1", provider: "omie", environment: "homologation", issuerTaxId: "12345678000195", reference: "sale_original" },
  intent: { id: "i1", remoteOrderId: "401", remoteInvoiceId: "501" }, snapshot: { contentHash: "original_hash", completedAt: new Date("2026-11-14T12:00:00Z") },
  envelope: { policy: { stockOwner: "provider" }, commercialLines: [{ sku: "shirt", quantity: 2, productType: "physical" }] } };
const payload = { timeZone: "America/Sao_Paulo", products: [{ id: 101, sku: "shirt" }] };
const movement = { idMov: 601, idDoc: 501, idPedido: 401, idProd: 101, qtde: 2, tipo: "saida", operacao: "11", cancelamento: "N", devolucao: "N" };
function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, origin?: string) {
  const calls: { url: string; init: RequestInit }[] = []; const reader = new FiscalStockEvidenceReader({ credential: async scope => { assert.equal(scope.merchantId, "m1"); assert.equal(scope.connectionId, "c1"); return "original_account_token"; },
    olistOrigin: async () => origin ? { objectType: origin, source: "verified_provider_contract", evidenceReference: "synthetic-reviewed-contract" } : null,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return handler(String(url), init ?? {}); }) as typeof fetch }); return { reader, calls };
}
test("FISCAL-26 Omie exact authenticated sale movement binds note order SKU quantity without a mutation call", async () => {
  const f = setup(() => Response.json({ nPagina: 1, nTotPaginas: 1, movProdutoListar: [movement] })); const result = await f.reader.read(context, payload, "501", "401"); assert.equal(result.found, true);
  if (result.found) { assert.deepEqual(result.evidence.lines, [{ sku: "shirt", quantity: 2 }]); assert.equal(result.evidence.remoteInvoiceId, "501"); assert.equal(result.evidence.remoteOrderId, "401"); assert.equal(result.evidence.snapshotHash, "original_hash"); assert.match(result.evidence.evidenceReference, /^omie:stock-movements:601:[a-f0-9]{64}$/); }
  assert.equal(f.calls[0]!.url, "https://app.omie.com.br/api/v1/estoque/consulta/"); const body = JSON.parse(String(f.calls[0]!.init.body)); assert.equal(body.call, "ListarMovimentoEstoque"); assert.equal(body.param[0].idProd, 101); assert.equal(new Headers(f.calls[0]!.init.headers).get("authorization"), "Bearer original_account_token");
});
for (const patch of [{ idDoc: 502 }, { idPedido: 402 }, { idProd: 102 }, { qtde: 1 }, { tipo: "entrada" }, { operacao: "13" }, { cancelamento: "S" }, { devolucao: "S" }]) test("FISCAL-26 mismatched Omie movement " + Object.keys(patch)[0] + " cannot prove a stock effect", async () => {
  const f = setup(() => Response.json({ nPagina: 1, nTotPaginas: 1, movProdutoListar: [{ ...movement, ...patch }] })); assert.equal((await f.reader.read(context, payload, "501", "401")).found, false);
});
test("FISCAL-26 Omie complete pagination is required and duplicate movements are rejected", async () => {
  const f = setup((_url, init) => { const page = JSON.parse(String(init.body)).param[0].nPagina; return Response.json({ nPagina: page, nTotPaginas: 2, movProdutoListar: page === 1 ? [{ ...movement, qtde: 1 }] : [{ ...movement, idMov: 602, qtde: 1 }] }); });
  assert.equal((await f.reader.read(context, payload, "501", "401")).found, true); assert.equal(f.calls.length, 2);
  const duplicate = setup((_url, init) => Response.json({ nPagina: JSON.parse(String(init.body)).param[0].nPagina, nTotPaginas: 2, movProdutoListar: [{ ...movement, qtde: 1 }] })); assert.equal((await duplicate.reader.read(context, payload, "501", "401")).found, false);
});
test("FISCAL-26 Olist origin semantics require a reviewed contract before any read, never a guessed object value", async () => {
  const c = { ...context, identity: { ...context.identity, provider: "tiny" } }; const f = setup(() => { throw new Error("no IO without reviewed origin"); }); const result = await f.reader.read(c, payload, "501", "401"); assert.equal(result.found, false); assert.equal(f.calls.length, 0);
});
test("FISCAL-26 Olist authenticated exact document-origin outbound quantity is distinct from balance", async () => {
  const c = { ...context, identity: { ...context.identity, provider: "tiny" } }; const f = setup(() => Response.json({ paginacao: { total: 1, limit: 100, offset: 0 }, itens: [{ id: 601, idProduto: 101, idOrigem: 501, objOrigem: "reviewed_invoice_type", tipo: "S", quantidade: 2 }] }), "reviewed_invoice_type");
  const result = await f.reader.read(c, payload, "501", "401"); assert.equal(result.found, true); assert.ok(f.calls[0]!.url.startsWith("https://api.tiny.com.br/public-api/v3/estoque/101/logs-movimentacao?")); assert.equal(f.calls[0]!.init.method, "GET");
  const bad = setup(() => Response.json({ paginacao: { total: 1 }, itens: [{ id: 601, idProduto: 101, idOrigem: 501, objOrigem: "adjustment", tipo: "S", quantidade: 2, saldo: 0 }] }), "reviewed_invoice_type"); assert.equal((await bad.reader.read(c, payload, "501", "401")).found, false);
});
test("FISCAL-26 Bling balances and authorized note cannot fabricate a per-invoice movement receipt", async () => {
  const f = setup(() => { throw new Error("unsupported read must not be guessed"); }); const result = await f.reader.read({ ...context, identity: { ...context.identity, provider: "bling" } }, payload, "501", "401"); assert.deepEqual(result, { found: false, reasonCode: "fiscal_stock_movement_contract_unverified" }); assert.equal(f.calls.length, 0);
});
test("FISCAL-26 default Zyon stock ownership needs no provider movement or second stock operation", async () => {
  const f = setup(() => { throw new Error("no provider movement for zyon owner"); }); assert.deepEqual(await f.reader.read({ ...context, envelope: { ...context.envelope, policy: { stockOwner: "zyon" } } }, payload, "501", "401"), { found: false, reasonCode: "fiscal_stock_owned_by_zyon" }); assert.equal(f.calls.length, 0);
});
