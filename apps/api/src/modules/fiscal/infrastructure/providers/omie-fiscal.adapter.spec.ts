import assert from "node:assert/strict";
import test from "node:test";
import { OmieFiscalAdapter } from "./omie-fiscal.adapter.js";
import { buildOmieFiscalPayload, fiscalObjectFingerprint } from "./omie-fiscal.payload.js";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageRecord } from "../../domain/fiscal-provider-stage.port.js";

const identity: FiscalIdentity = { merchantId: "merchant_a", connectionId: "connection_a", provider: "omie", environment: "homologation", issuerTaxId: "12345678000195", reference: "zyon-order-original" };
const key = "35" + "1".repeat(18) + "55" + "1".repeat(22);
const xml = (issuer = identity.issuerTaxId, env = "2") => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><tpAmb>${env}</tpAmb><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${issuer}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>${env}</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>151260029467289</nProt><dhRecbto>2026-11-15T10:00:00-03:00</dhRecbto></infProt></protNFe></nfeProc>`;
function payload(stockOwner = "zyon", scope = identity) { return buildOmieFiscalPayload({ identity: scope, issuedAt: "2026-11-15T13:00:00Z", sendEmail: false, fiscalPayment: { code: "17" }, snapshot: {
  merchantId: scope.merchantId, environment: scope.environment, currency: "BRL", completedAt: new Date("2026-11-14T12:00:00Z"), recipient: {
    name: "Empresa Compradora", taxId: "12ABC34501DE35", email: "company@example.test", address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" } },
  items: { version: 1, profileVersionId: "profile1", buyerContacts: { email: "buyer@example.test" }, commercialLines: [], excludedLines: [], pendingLines: [], policy: { stockOwner, emailOwner: "zyon", whatsappOwner: "zyon" },
    lines: [{ sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }], fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 } } } as never,
  profile: { id: "profile1", merchantId: scope.merchantId, environment: scope.environment, provider: "omie", confirmedBy: "accountant", confirmedAt: new Date(), itemRules: {
    currency: "BRL", supportedProductTypes: ["physical"], operation: { etapa: "10", codigoParcela: "001", codigoCenarioImpostos: 1001, codigoCategoria: "1.01.02", codigoContaCorrente: 602,
      modalidadeFrete: "0", contribuinte: "N", indPresenca: "2", indIntermediario: "0", timeZone: "America/Sao_Paulo", products: { shirt: { productId: 101 } } },
    items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { "icms_sn.cod_sit_trib_icms_sn": "102", "icms_sn.origem_icms_sn": "0", "pis_padrao.cod_sit_trib_pis": "07", "cofins_padrao.cod_sit_trib_cofins": "07" } } } } } as never }); }
type Handler = (call: string, param: Record<string, unknown>, init: RequestInit, url: string) => Response | undefined | Promise<Response | undefined>;
function setup(override?: Handler, options: { fence?: boolean; stockOwner?: string; token?: string; scope?: FiscalIdentity; emailOwner?: string } = {}) {
  const scope = options.scope ?? identity; const data = payload(options.stockOwner, scope); const calls: { call: string; param: Record<string, unknown>; init: RequestInit; url: string }[] = [];
  const records = new Map<string, FiscalProviderStageRecord>(); let client: Record<string, unknown> | undefined; let order: Record<string, unknown> | undefined; let billed = false;
  const adapter = new OmieFiscalAdapter({ scope, credential: async () => options.token ?? "omie_app_token_a", expectedPayload: data, companyId: "701",
    policy: { version: "policy1", profileVersionId: "profile1", stockOwner: options.stockOwner ?? "zyon", emailOwner: options.emailOwner ?? "zyon", whatsappOwner: "zyon" },
    journal: { check: async () => options.fence !== false, read: async (_id, stage) => records.get(stage) ?? null, begin: async record => { if (options.fence === false) return false; records.set(record.stage, record); return true; }, finish: async record => { records.set(record.stage, record); return true; } },
    authorization: { read: async () => ({ scope, evidenceReference: "validated_app_grant:fixture", permissions: ["fiscal_read", "fiscal_write", "order_write", "contact_write"] }) },
    fetch: (async (raw: string | URL | Request, init: RequestInit = {}) => {
      const url = String(raw); const body = init.body ? JSON.parse(init.body as string) : {}; const call = body.call ?? "artifact"; const param = body.param?.[0] ?? {};
      calls.push({ call, param, init, url }); const custom = await override?.(call, param, init, url); if (custom) return custom;
      if (call === "ConsultarEmpresa") return Response.json({ codigo_empresa: 701, cnpj: scope.issuerTaxId, gera_nfe: "S", inativa: "N", ct_espass: "never_expose" });
      if (call === "ListarClientes") return Response.json({ pagina: 1, total_de_paginas: 1, clientes_cadastro: [] });
      if (call === "IncluirCliente") { client = { ...param, codigo_cliente_omie: 301 }; return Response.json({ codigo_cliente_omie: 301, codigo_cliente_integracao: param.codigo_cliente_integracao, codigo_status: "0" }); }
      if (call === "ConsultarCliente") return Response.json(client ?? { ...data.contact, codigo_cliente_omie: 301 });
      if (call === "ConsultarProduto") return Response.json({ codigo_produto: 101, codigo: "shirt", ncm: "61091000", unidade: "UN", origem_imposto: "NCM", recomendacoes_fiscais: { origem_mercadoria: "0" }, inativo: "N" });
      if (call === "ListarPedidos") return Response.json({ pagina: 1, total_de_paginas: 1, pedido_venda_produto: [] });
      if (call === "IncluirPedido") { order = { ...param, cabecalho: { ...param.cabecalho as object, codigo_pedido: 401 }, total_pedido: { valor_total_pedido: 21.01 } }; return Response.json({ codigo_pedido: 401, codigo_pedido_integracao: scope.reference, codigo_status: "0" }); }
      if (call === "ConsultarPedido") return Response.json({ pedido_venda_produto: order ?? { ...data.order, cabecalho: { ...data.order.cabecalho as object, codigo_pedido: 401, codigo_cliente: 301 }, total_pedido: { valor_total_pedido: 21.01 } } });
      if (call === "ValidarPedidoVenda") return Response.json({ nCodPed: 401, cCodIntPed: scope.reference, cCodStatus: "0" });
      if (call === "FaturarPedidoVenda") { billed = true; return Response.json({ nCodPed: 401, cCodIntPed: scope.reference, cCodStatus: "0" }); }
      if (call === "StatusPedido") return Response.json({ codigo_pedido: 401, codigo_pedido_integracao: scope.reference, ambiente: "H", faturada: billed ? "S" : "N", ListaNfe: billed ? [{ chave_nfe: key, numero_nfe: "22", serie_nfe: "1", protocolo: 151260029467289, xml_distr: xml() }] : [] });
      if (call === "ConsultarNF") return Response.json({ ide: { mod: "55", tpAmb: "2", nNF: "22", serie: "1" }, nfEmitInt: { nCodEmp: 701 }, compl: { nIdNF: 501, nIdPedido: 401, cChaveNFe: key }, total: { ICMSTot: { vNF: 21.01 } } });
      if (call === "NotaFiscalStatus") return Response.json({ integracao: { codigo_empresa: 701, codigo_nf: 501 }, dados_lote: { ambiente: "H" }, dados_nota_fiscal: { faturada: "S", status_sefaz: "100", chave_nfe: key, protocolo: 151260029467289 }, dados_cancelamento: { nfCanc: "N" } });
      if (call === "NotaFiscalCancelar") return Response.json({ codigo_nf: 501, codigo_status: "0" });
      if (call === "GetUrlDanfe") return Response.json({ cUrlDanfe: "https://app.omie.com.br/documentos/nfe.pdf", dtValUrl: "2099-01-01" });
      if (call === "ObterNfe") return Response.json({ nChaveNfe: key, cXmlNfe: xml(), cCodStatus: "0", cLinkPortal: "https://app.omie.com.br/portal/not-xml" });
      if (call === "artifact") return new Response("%PDF-1.7 synthetic", { headers: { "content-type": "application/pdf" } });
      throw new Error("unexpected_test_call " + call);
    }) as typeof fetch });
  const writes = () => calls.filter(value => ["IncluirCliente", "IncluirPedido", "FaturarPedidoVenda", "NotaFiscalCancelar"].includes(value.call));
  const prepare = async () => { const order = await adapter.ensureOrder(scope, data); assert.equal(order.outcome, "accepted"); if (order.outcome !== "accepted") throw new Error("order_required"); const result = await adapter.generate(scope, order.value); assert.deepEqual(result, { outcome: "accepted", value: { remoteOrderId: "401" } }); };
  const bill = () => adapter.submit(scope, { remoteOrderId: "401", payload: {}, sendEmail: false });
  return { adapter, scope, data, calls, records, writes, prepare, bill };
}

function readbackFixture(change?: (order: Record<string, any>) => void, options: { zeroFreight?: boolean; formatted?: boolean; omitDefaults?: boolean } = {}) {
  let sent: Record<string, unknown> | undefined;
  const f = setup((call, param) => {
    if (call === "IncluirPedido") sent = structuredClone(param);
    if (call !== "ConsultarPedido") return;
    const order: Record<string, any> = structuredClone(sent ?? { ...f.data.order, cabecalho: { ...f.data.order.cabecalho as object, codigo_cliente: 301 } });
    order.cabecalho.codigo_pedido = 401;
    order.total_pedido = { valor_total_pedido: f.data.totalCents / 100 };
    if (options.formatted) {
      order.cabecalho.codigo_cenario_impostos = "1001";
      order.det[0].produto.ncm = "6109.10.00"; order.det[0].produto.cfop = "5.102";
    }
    if (options.zeroFreight) delete order.frete.valor_frete;
    if (options.omitDefaults) {
      delete order.cabecalho.nao_gerar_boleto;
      delete order.informacoes_adicionais.meio_pagamento; delete order.informacoes_adicionais.descr_meio_pagamento;
    }
    change?.(order); return Response.json({ pedido_venda_produto: order });
  });
  if (options.zeroFreight) { (f.data.order.frete as Record<string, unknown>).valor_frete = 0; f.data.totalCents = 1899; }
  Object.assign(f.data.order.informacoes_adicionais as object, { meio_pagamento: "99", descr_meio_pagamento: "Pagamento confirmado pela loja" });
  return f;
}

test("FISCAL-82 Omie accepted creation binds exact selected-client request and validates real readback", async () => {
  const f = readbackFixture(undefined, { zeroFreight: true, formatted: true, omitDefaults: true });
  assert.equal(Object.hasOwn(f.data.order.cabecalho as object, "codigo_cliente"), false);
  const created = await f.adapter.ensureOrder(identity, f.data);
  assert.deepEqual(created, { outcome: "accepted", value: { id: "401", reference: identity.reference } });
  const request = f.calls.find(call => call.call === "IncluirPedido")!.param;
  assert.equal((request.cabecalho as Record<string, unknown>).codigo_cliente, 301);
  assert.equal(f.records.get("order.create")!.relatedIds!.orderFingerprint, fiscalObjectFingerprint(request));
  assert.notEqual(f.records.get("order.create")!.relatedIds!.orderFingerprint, fiscalObjectFingerprint(f.data.order));
  assert.deepEqual(await f.adapter.generate(identity, { id: "401", reference: identity.reference }), { outcome: "accepted", value: { remoteOrderId: "401" } });
  assert.equal((await f.bill()).outcome, "accepted");
  assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
  assert.equal(f.writes().filter(call => call.call === "FaturarPedidoVenda").length, 1);
  assert.equal(f.calls.filter(call => call.call === "ConsultarCliente").length, 3);
});

test("FISCAL-82 Omie exact fiscal formats and omitted zero freight require no missing-default trust", async () => {
  const f = readbackFixture(undefined, { zeroFreight: true, formatted: true });
  assert.deepEqual(await f.adapter.generate(identity, { id: "401", reference: identity.reference }), { outcome: "accepted", value: { remoteOrderId: "401" } });
  assert.equal(f.records.has("order.create"), false); assert.equal(f.writes().length, 0);
});

test("FISCAL-82 Omie missing defaults without exact accepted receipt stay blocked and preserve journals", async t => {
  const cases = ["none", "legacy", "unknown", "started", "other_id", "other_reference", "other_identity", "fingerprint", "other_client", "changed_request"];
  for (const name of cases) await t.test(name, async () => {
    const f = readbackFixture(undefined, { zeroFreight: true, omitDefaults: true });
    if (name !== "none") {
      assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted");
      const original = f.records.get("order.create")!; const relatedIds = { ...original.relatedIds };
      if (name === "legacy") delete relatedIds.orderFingerprint;
      if (name === "fingerprint") relatedIds.orderFingerprint = "0".repeat(64);
      if (name === "other_client") relatedIds.orderFingerprint = fiscalObjectFingerprint({ ...f.data.order, cabecalho: { ...f.data.order.cabecalho as object, codigo_cliente: 302 } });
      f.records.set("order.create", { ...original, relatedIds, ...(name === "unknown" || name === "started" ? { outcome: name } : {}),
        ...(name === "other_id" ? { remoteId: "402" } : {}), ...(name === "other_reference" ? { reference: "foreign" } : {}),
        ...(name === "other_identity" ? { identity: { ...identity, merchantId: "foreign" } } : {}) });
    }
    if (name === "changed_request") (f.data.order.informacoes_adicionais as Record<string, unknown>).descr_meio_pagamento = "Diferente";
    const before = JSON.stringify([...f.records]); const writes = f.writes().length;
    await assert.rejects(f.adapter.generate(identity, { id: "401", reference: identity.reference }), /fiscal_(?:order|identity|stage)/);
    assert.equal(JSON.stringify([...f.records]), before); assert.equal(f.writes().length, writes);
    assert.equal(f.calls.some(call => call.call === "ValidarPedidoVenda" || call.call === "FaturarPedidoVenda"), false);
    if (name === "unknown" || name === "started") assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" });
    assert.equal(f.writes().length, writes);
  });
});

test("FISCAL-82 Omie invalid or divergent formats content and effects never validate or bill", async t => {
  const cases: Array<[string, (order: Record<string, any>) => void]> = [
    ...["6109-10-00", "6109.10.01", "61091000 ", 61091000].map(value => ["NCM " + value, (o: any) => { o.det[0].produto.ncm = value; }] as [string, (o: any) => void]),
    ...["5-102", "6.102", " 5102", 5102].map(value => ["CFOP " + value, (o: any) => { o.det[0].produto.cfop = value; }] as [string, (o: any) => void]),
    ...["1002", "01001", "1e3", "1001.0", " 1001", true, null].map(value => ["scenario " + value, (o: any) => { o.cabecalho.codigo_cenario_impostos = value; }] as [string, (o: any) => void]),
    ["reference", o => { o.cabecalho.codigo_pedido_integracao = "foreign"; }],
    ["order ID", o => { o.cabecalho.codigo_pedido = 402; }],
    ["client", o => { o.cabecalho.codigo_cliente = 302; }],
    ["total", o => { o.total_pedido.valor_total_pedido = 19; }],
    ["unit price", o => { o.det[0].produto.valor_unitario = 9; }],
    ["quantity", o => { o.det[0].produto.quantidade = 3; }],
    ["product", o => { o.det[0].produto.codigo_produto = 102; }],
    ["stock", o => { o.det[0].inf_adic.nao_movimentar_estoque = "N"; }],
    ["finance", o => { o.det[0].inf_adic.nao_gerar_financeiro = "N"; }],
    ["email", o => { o.informacoes_adicionais.enviar_email = "S"; }],
    ["missing email", o => { delete o.informacoes_adicionais.enviar_email; }],
    ["Pix", o => { o.informacoes_adicionais.enviar_pix = "S"; }],
    ["indicators", o => { o.informacoes_adicionais.outros_detalhes.cIndicadorOd = "1"; }],
    ["boleto", o => { o.cabecalho.nao_gerar_boleto = "N"; }],
    ["payment", o => { o.informacoes_adicionais.meio_pagamento = "15"; }],
    ["description", o => { o.informacoes_adicionais.descr_meio_pagamento = "Diferente"; }],
    ["installment boleto", o => { o.lista_parcelas = { parcela: [{ nao_gerar_boleto: "N" }] }; }],
    ["installment payment", o => { o.lista_parcelas = { parcela: [{ meio_pagamento: "15" }] }; }],
    ["installment description", o => { o.lista_parcelas = { parcela: [{ descr_meio_pagamento: "Diferente" }] }; }],
    ["malformed installments", o => { o.lista_parcelas = { parcela: {} }; }],
    ["freight", o => { o.frete.valor_frete = 1; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = readbackFixture(change, { zeroFreight: true, formatted: true, omitDefaults: true });
    assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted");
    const before = JSON.stringify([...f.records]); const writes = f.writes().length;
    await assert.rejects(f.adapter.generate(identity, { id: "401", reference: identity.reference }), /fiscal_(?:order|identity|contact)/);
    assert.equal(JSON.stringify([...f.records]), before); assert.equal(f.writes().length, writes);
    assert.equal(f.calls.some(call => call.call === "ValidarPedidoVenda" || call.call === "FaturarPedidoVenda"), false);
  });
});

test("FISCAL-82 Omie NSU remains exact in global and per-installment payment metadata", async t => {
  for (const name of ["equivalent", "different global", "missing global", "different installment"] as const) await t.test(name, async () => {
    const f = readbackFixture(o => {
      if (name === "different global") o.informacoes_adicionais.nsu = "foreign";
      if (name === "missing global") delete o.informacoes_adicionais.nsu;
      if (name === "different installment") o.lista_parcelas = { parcela: [{ nsu: "foreign" }] };
    }, { zeroFreight: true, formatted: true, omitDefaults: true });
    (f.data.order.informacoes_adicionais as Record<string, unknown>).nsu = "NSU321";
    assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted");
    const writes = f.writes().length;
    if (name === "equivalent") assert.deepEqual(await f.adapter.generate(identity, { id: "401", reference: identity.reference }), { outcome: "accepted", value: { remoteOrderId: "401" } });
    else {
      await assert.rejects(f.adapter.generate(identity, { id: "401", reference: identity.reference }), /fiscal_order_content/);
      assert.equal(f.records.has("invoice.validate"), false);
    }
    assert.equal(f.writes().length, writes);
  });
});

test("FISCAL-82 Omie missing positive freight or changed customer cannot use accepted defaults", async t => {
  for (const name of ["positive freight", "customer content"]) await t.test(name, async () => {
    let changed = false;
    const f = name === "positive freight" ? readbackFixture(o => { delete o.frete.valor_frete; }, { omitDefaults: true }) : setup(call => call === "ConsultarCliente" && changed ? Response.json({ ...payload().contact, codigo_cliente_omie: 301, endereco_numero: "99" }) : undefined);
    assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted"); changed = true;
    const writes = f.writes().length;
    await assert.rejects(f.adapter.generate(identity, { id: "401", reference: identity.reference }), /fiscal_(?:order|contact)_content/);
    assert.equal(f.writes().length, writes); assert.equal(f.records.has("invoice.validate"), false);
  });
});

test("FISCAL-81 Omie exact initial reference absence permits one normal order creation", async () => {
  const f = setup((call, param) => call === "ConsultarPedido" && param.codigo_pedido_integracao === identity.reference
    ? Response.json({ faultcode: "SOAP-ENV:Client-103", faultstring: `ERROR: Pedido não cadastrado para o Código de Integração [${identity.reference}] !` }, { status: 500 }) : undefined);
  assert.deepEqual(await f.adapter.findByReference(identity), { found: false });
  assert.deepEqual(f.calls.map(call => call.param), [{ codigo_pedido_integracao: identity.reference }]);
  assert.equal(f.writes().length, 0); assert.equal(f.records.size, 0);
  assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "accepted", value: { id: "401", reference: identity.reference } });
  assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "accepted", value: { id: "401", reference: identity.reference } });
  assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
});

test("FISCAL-81 Omie ambiguous or unauthorized reference failures never become absence", async t => {
  const fault = { faultcode: "SOAP-ENV:Client-103", faultstring: `ERROR: Pedido não cadastrado para o Código de Integração [${identity.reference}] !` };
  const cases: Array<[string, () => Response]> = [
    ...[200, 400, 401, 403, 404, 429, 502, 503].map(status => [String(status), () => Response.json(fault, { status })] as [string, () => Response]),
    ["other fault", () => Response.json({ ...fault, faultcode: "SOAP-ENV:Client-102" }, { status: 500 })],
    ["other reference", () => Response.json({ ...fault, faultstring: "ERROR: Pedido não cadastrado para o Código de Integração [foreign] !" }, { status: 500 })],
    ["different message", () => Response.json({ ...fault, faultstring: fault.faultstring + " Retry later" }, { status: 500 })],
    ["missing fault", () => Response.json({ faultstring: fault.faultstring }, { status: 500 })],
    ["malformed", () => new Response("not JSON", { status: 500 })],
    ["null", () => Response.json(null, { status: 500 })],
  ];
  for (const [name, response] of cases) await t.test(name, async () => {
    const f = setup(call => call === "ConsultarPedido" ? response() : undefined);
    await assert.rejects(f.adapter.findByReference(identity), /fiscal_(?:provider|reauthorization)/);
    assert.equal(f.writes().length, 0); assert.equal(f.records.size, 0);
  });
});

test("FISCAL-81 Omie accepted and uncertain journals never admit missing or another create", async t => {
  for (const outcome of ["accepted", "unknown", "started"] as const) await t.test(outcome, async () => {
    const f = setup(call => ["ConsultarPedido", "StatusPedido"].includes(call) ? Response.json({ faultcode: "SOAP-ENV:Client-103", faultstring: `ERROR: Pedido não cadastrado para o Código de Integração [${identity.reference}] !` }, { status: 500 }) : undefined);
    const record: FiscalProviderStageRecord = { identity, stage: "order.create", reference: identity.reference, outcome, ...(outcome === "accepted" ? { remoteId: "401" } : {}) };
    f.records.set("order.create", record);
    await assert.rejects(f.adapter.findByReference(identity), /fiscal_provider/);
    const result = await f.adapter.ensureOrder(identity, f.data);
    assert.deepEqual(result, outcome === "accepted" ? { outcome: "accepted", value: { id: "401", reference: identity.reference } } : { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" });
    assert.equal(f.records.get("order.create"), record); assert.equal(f.writes().length, 0);
    assert.deepEqual(f.calls[0]!.param, outcome === "accepted" ? { codigo_pedido: 401, codigo_pedido_integracao: identity.reference } : { codigo_pedido_integracao: identity.reference });
  });
});

test("FISCAL-81 Omie known invoice numeric order cancel and reconciliation lookups cannot be absence", async t => {
  for (const operation of ["query", "download", "generate", "cancel", "reconcile"] as const) await t.test(operation, async () => {
    const f = setup(call => call === "ConsultarPedido" ? Response.json({ faultcode: "SOAP-ENV:Client-103", faultstring: `ERROR: Pedido não cadastrado para o Código de Integração [${identity.reference}] !` }, { status: 500 }) : undefined);
    const actions = {
      query: () => f.adapter.query(identity, "501"),
      download: () => f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml" }),
      generate: () => f.adapter.generate(identity, { id: "401", reference: identity.reference }),
      cancel: () => f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento fiscal solicitado", requestedAt: "2026-11-15T16:00:00-03:00", restoreStock: false, reverseAccounts: false, cancelSale: false }),
      reconcile: () => f.adapter.reconcileStage(identity, { identity, stage: "order.create", reference: identity.reference, outcome: "unknown" }),
    };
    await assert.rejects(actions[operation], /fiscal_provider/);
    assert.equal(f.writes().length, 0); assert.equal(f.records.size, 0);
  });
});

test("FISCAL-80 Omie maps invoice indicators to documented order details and preserves policies", async t => {
  for (const stockOwner of ["zyon", "provider"]) await t.test(stockOwner, async () => {
    const data = payload(stockOwner); const additional = data.order.informacoes_adicionais as Record<string, unknown>;
    assert.deepEqual(additional.outros_detalhes, { cIndicadorOd: "2", cIndicadorIntOd: "0" });
    for (const field of ["indPresenca", "indIntermediario", "cnpjIntermediario", "identIntermediario"]) assert.equal(Object.hasOwn(additional, field), false);
    assert.equal(additional.meio_pagamento, "17"); assert.equal(additional.enviar_email, "N"); assert.equal(additional.enviar_pix, "N");
    assert.equal((data.order.cabecalho as Record<string, unknown>).codigo_pedido_integracao, identity.reference);
    assert.equal(data.totalCents, 2101);
    const item = (data.order.det as Array<{ inf_adic: Record<string, unknown>; produto: Record<string, unknown> }>)[0]!;
    assert.equal(item.inf_adic.nao_movimentar_estoque, stockOwner === "zyon" ? "S" : "N");
    assert.equal(item.inf_adic.nao_gerar_financeiro, "S"); assert.equal(item.produto.valor_unitario, 10); assert.equal(item.produto.quantidade, 2);
  });
});

test("FISCAL-80 Omie creates the order against the documented additional-information shape", async () => {
  const f = setup((call, param) => {
    if (call !== "IncluirPedido") return;
    const additional = param.informacoes_adicionais as Record<string, unknown>;
    if (["indPresenca", "indIntermediario", "cnpjIntermediario", "identIntermediario"].some(field => Object.hasOwn(additional, field)))
      return Response.json({ faultcode: "SOAP-ENV:Client", faultstring: "Unsupported field in informacoes_adicionais" }, { status: 500 });
    assert.deepEqual(additional.outros_detalhes, { cIndicadorOd: "2", cIndicadorIntOd: "0" });
  });
  assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "accepted", value: { id: "401", reference: identity.reference } });
  assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
  assert.deepEqual(f.calls.find(call => call.call === "IncluirPedido")!.param.det, f.data.order.det);
});

test("FISCAL-79 Omie accepts documented goods origin and formatted NCM without changing the order", async t => {
  for (const taxRuleSource of ["NCM", "PRD", ""]) await t.test(taxRuleSource || "empty tax rule source", async () => {
    const f = setup(call => call === "ConsultarProduto" ? Response.json({ codigo_produto: 101, codigo: "shirt", ncm: "6109.10.00", unidade: "UN", origem_imposto: taxRuleSource, recomendacoes_fiscais: { origem_mercadoria: "0" }, inativo: "N" }) : undefined);
    const result = await f.adapter.ensureOrder(identity, f.data);
    assert.deepEqual(result, { outcome: "accepted", value: { id: "401", reference: identity.reference } });
    const sent = f.calls.find(call => call.call === "IncluirPedido")!.param;
    assert.equal((sent.cabecalho as Record<string, unknown>).codigo_pedido_integracao, identity.reference);
    assert.deepEqual(sent.det, f.data.order.det);
    const item = (sent.det as Array<{ produto: Record<string, unknown> }>)[0]!;
    assert.equal(item.produto.ncm, "61091000"); assert.equal(item.produto.codigo_produto, 101); assert.equal(item.produto.quantidade, 2);
    assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
  });
});

test("FISCAL-79 Omie rejects unverified goods origin or invalid NCM before customer and order writes", async t => {
  const product = { codigo_produto: 101, codigo: "shirt", ncm: "6109.10.00", unidade: "UN", origem_imposto: "NCM", recomendacoes_fiscais: { origem_mercadoria: "0" }, inativo: "N" };
  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing goods origin", { recomendacoes_fiscais: {} }],
    ["tax rule source is never a goods origin fallback", { recomendacoes_fiscais: undefined, origem_imposto: "0" }],
    ["different goods origin", { recomendacoes_fiscais: { origem_mercadoria: "1" } }],
    ["invalid goods origin", { recomendacoes_fiscais: { origem_mercadoria: "9" } }],
    ["different NCM digits", { ncm: "6109.10.01" }],
    ["letters in NCM", { ncm: "NCM61091000" }],
    ["invalid NCM punctuation", { ncm: "6109-10-00" }],
    ["different product identity", { codigo_produto: 102 }],
    ["different SKU", { codigo: "other-shirt" }],
    ["different unit", { unidade: "PC" }],
    ["inactive product", { inativo: "S" }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const f = setup(call => call === "ConsultarProduto" ? Response.json({ ...product, ...change }) : undefined);
    await assert.rejects(f.adapter.ensureOrder(identity, f.data), /^Error: fiscal_product_configuration_mismatch$/);
    assert.equal(f.writes().length, 0); assert.equal(f.calls.some(call => call.call === "ListarClientes"), false);
  });
});
test("Omie real producer creates confirmed contact and original-value order then validates and bills", async () => {
  const f = setup(); await f.prepare(); const receipt = await f.bill(); assert.equal(receipt.outcome, "accepted");
  if (receipt.outcome === "accepted") { assert.equal(receipt.value.status, "processing"); assert.equal(receipt.value.remoteOrderId, "401"); assert.equal("remoteInvoiceId" in receipt.value, false); }
  assert.deepEqual(f.writes().map(call => call.call), ["IncluirCliente", "IncluirPedido", "FaturarPedidoVenda"]);
  const sent = f.calls.find(call => call.call === "IncluirPedido")!; assert.equal(sent.url, "https://app.omie.com.br/api/v1/produtos/pedido/"); assert.equal(new Headers(sent.init.headers).get("authorization"), "Bearer omie_app_token_a");
  assert.equal((sent.param.cabecalho as Record<string, unknown>).codigo_pedido_integracao, identity.reference); assert.equal((sent.param.cabecalho as Record<string, unknown>).data_previsao, "15/11/2026");
  const item = (sent.param.det as { produto: Record<string, unknown>; inf_adic: Record<string, unknown> }[])[0]!;
  assert.equal(item.produto.quantidade, 2); assert.equal(item.produto.valor_unitario, 10); assert.equal(item.produto.valor_desconto, 1.01); assert.equal((sent.param.frete as Record<string, unknown>).valor_frete, 2.02);
  assert.equal(item.inf_adic.nao_movimentar_estoque, "S"); assert.equal(item.inf_adic.nao_gerar_financeiro, "S"); assert.equal(item.produto.reservado, "N");
  assert.equal((sent.param.cabecalho as Record<string, unknown>).nao_gerar_boleto, "S"); assert.equal((sent.param.informacoes_adicionais as Record<string, unknown>).enviar_pix, "N");
  assert.ok(f.calls.findIndex(call => call.call === "ValidarPedidoVenda") < f.calls.findIndex(call => call.call === "FaturarPedidoVenda"));
});
test("Omie failed lease fence performs zero remote IO", async () => { const f = setup(undefined, { fence: false }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal(f.calls.length, 0); });
test("Omie uncertain customer creation cannot repeat even when no invoice exists", async () => { const f = setup(call => { if (call === "IncluirCliente") throw new Error("lost response secret"); }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal(f.writes().length, 1); assert.equal(f.records.get("contact.create")!.outcome, "unknown"); });
test("Omie uncertain order creation never repeats customer or order", async () => { const f = setup(call => { if (call === "IncluirPedido") throw new Error("lost response"); }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.deepEqual(f.writes().map(call => call.call), ["IncluirCliente", "IncluirPedido"]); });
test("Omie accepted or uncertain billing is never called twice", async () => {
  for (const uncertain of [false, true]) { const f = setup(call => { if (uncertain && call === "FaturarPedidoVenda") throw new Error("timeout"); }); await f.prepare(); await f.bill(); await f.bill(); assert.equal(f.calls.filter(call => call.call === "FaturarPedidoVenda").length, 1); }
});
test("Omie confirmed query obtains real NF ID and exact XML protocol time instead of order ID", async () => { const f = setup(); await f.prepare(); await f.bill(); const result = await f.adapter.query(identity); assert.equal(result.found, true); if (result.found) { assert.equal(result.document.remoteInvoiceId, "501"); assert.equal(result.document.status, "authorized"); if (result.document.status === "authorized") assert.equal(result.document.authorization.authorizedAt, "2026-11-15T10:00:00-03:00"); } });
test("Omie no invoice after accepted billing stays absent without another mutation", async () => { const f = setup(call => call === "StatusPedido" ? Response.json({ codigo_pedido: 401, codigo_pedido_integracao: identity.reference, ListaNfe: [] }) : undefined); await f.prepare(); await f.bill(); assert.deepEqual(await f.adapter.query(identity), { found: false }); await f.bill(); assert.equal(f.calls.filter(call => call.call === "FaturarPedidoVenda").length, 1); });
test("Omie wrong issuer environment or order identity cannot authorize", async () => {
  for (const bad of ["issuer", "environment", "reference"]) { const f = setup(call => call === "StatusPedido" ? Response.json({ codigo_pedido: 401, codigo_pedido_integracao: bad === "reference" ? "foreign" : identity.reference, ListaNfe: [{ chave_nfe: key, xml_distr: xml(bad === "issuer" ? "52998224725" : identity.issuerTaxId, bad === "environment" ? "1" : "2") }] }) : undefined); await f.prepare(); await assert.rejects(f.adapter.query(identity), /identity|environment/); }
});
test("Omie downloads private XML and DANFE without forwarding app bearer to an artifact URL", async () => { const f = setup(); await f.prepare(); await f.bill(); const document = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml" }); assert.equal(new TextDecoder().decode(document.bytes), xml()); const pdf = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "danfe" }); assert.equal(pdf.mimeType, "application/pdf"); assert.equal(new Headers(f.calls.find(call => call.call === "artifact")!.init.headers).get("authorization"), null); });
test("Omie an unreviewed artifact origin is refused without leaking token or URL to another host", async () => { const f = setup(call => call === "GetUrlDanfe" ? Response.json({ cUrlDanfe: "https://evil.example/private" }) : undefined); await f.prepare(); await f.bill(); await assert.rejects(f.adapter.download(identity, { remoteInvoiceId: "501", kind: "danfe" }), /artifact_origin/); assert.equal(f.calls.some(call => call.url.startsWith("https://evil.example")), false); });
test("Omie fiscal cancellation uses NotaFiscalCancelar and original suppression flags without cancelling sale", async () => { const f = setup(); await f.prepare(); await f.bill(); const result = await f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento fiscal solicitado", requestedAt: "2026-11-15T16:00:00-03:00", restoreStock: false, reverseAccounts: false, cancelSale: false }); assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") assert.equal(result.value.status, "processing"); const call = f.calls.find(call => call.call === "NotaFiscalCancelar")!; assert.equal(call.param.codigo_nf, 501); assert.equal(call.param.dtCanc, "15/11/2026"); assert.equal(f.calls.some(call => ["CancelarPedidoVenda", "DevolverPedido", "ImportarCancNFe"].includes(call.call)), false); });
test("Omie provider-owned stock cancellation is blocked without documented non-restoration control", async () => { const f = setup(undefined, { stockOwner: "provider" }); const result = await f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento fiscal solicitado", requestedAt: "2026-11-15T16:00:00-03:00", restoreStock: false, reverseAccounts: false, cancelSale: false }); assert.deepEqual(result, { outcome: "not_accepted", reasonCode: "fiscal_cancellation_effect_control_unverified" }); assert.equal(f.calls.length, 0); });
test("Omie changed original stock or financial flags block billing and fiscal cancellation", async () => {
  const f = setup(call => call === "ConsultarPedido" ? Response.json({ pedido_venda_produto: { ...payload().order, cabecalho: { ...payload().order.cabecalho as object, codigo_pedido: 401, codigo_cliente: 301 }, det: [{ ...(payload().order.det as object[])[0], inf_adic: { nao_movimentar_estoque: "N", nao_gerar_financeiro: "N" } }] } }) : undefined);
  const order = await f.adapter.ensureOrder(identity, f.data); assert.equal(order.outcome, "accepted"); if (order.outcome === "accepted") await assert.rejects(f.adapter.generate(identity, order.value), /effects|content/); assert.equal(f.calls.some(call => call.call === "FaturarPedidoVenda"), false);
  await assert.rejects(f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento fiscal solicitado", requestedAt: "2026-11-15T16:00:00-03:00", restoreStock: false, reverseAccounts: false, cancelSale: false }), /effects|content/);
  assert.equal(f.calls.some(call => call.call === "NotaFiscalCancelar"), false);
});
test("Omie existing CPF customer with matching fiscal details is reused without another customer POST", async () => { const f = setup(call => call === "ListarClientes" ? Response.json({ pagina: 1, total_de_paginas: 1, clientes_cadastro: [{ ...payload().contact, codigo_cliente_integracao: "existing_buyer", codigo_cliente_omie: 301 }] }) : call === "ConsultarCliente" ? Response.json({ ...payload().contact, codigo_cliente_integracao: "existing_buyer", codigo_cliente_omie: 301 }) : undefined); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted"); assert.equal(f.calls.filter(call => call.call === "IncluirCliente").length, 0); });
test("Omie interleaved accounts use isolated Bearer app tokens and cannot borrow another merchant scope", async () => { const a = setup(undefined, { token: "a" }); const b = setup(undefined, { token: "b", scope: { ...identity, merchantId: "merchant_b", connectionId: "connection_b" } }); await a.adapter.inspectConnection(identity); await b.adapter.inspectConnection(b.scope); assert.equal(new Headers(a.calls[0]!.init.headers).get("authorization"), "Bearer a"); assert.equal(new Headers(b.calls[0]!.init.headers).get("authorization"), "Bearer b"); await assert.rejects(b.adapter.ensureOrder(identity, a.data), /identity/); });
test("Omie readiness never exposes opaque certificate secrets or pretends an invoice404 proves readiness", async () => { const f = setup(); const result = await f.adapter.inspectConnection(identity); assert.ok(result.some(value => value.code === "issuer" && value.status === "verified")); assert.ok(result.some(value => value.code === "certificate" && value.status === "pending")); assert.equal(JSON.stringify(result).includes("never_expose"), false); assert.deepEqual(f.calls.map(call => call.call), ["ConsultarEmpresa"]); });
test("Omie missing distribution XML uses documented ObterNfe XML and never a portal URL as XML", async () => {
  const f = setup(call => call === "StatusPedido" ? Response.json({ codigo_pedido: 401, codigo_pedido_integracao: identity.reference, ListaNfe: [{ chave_nfe: key }] }) : undefined);
  await f.prepare(); const result = await f.adapter.query(identity); assert.equal(result.found && result.document.status, "authorized");
  const query = f.calls.find(call => call.call === "ObterNfe")!; assert.equal(query.param.nIdNfe, 501); assert.equal(query.url, "https://app.omie.com.br/api/v1/produtos/dfedocs/");
  assert.equal(f.calls.some(call => call.call === "GetUrlNotaFiscal" || call.url.includes("/portal/")), false);
});
test("Omie repeat customer history is paginated instead of refusing accounts with over100orders", async () => {
  const pages: number[] = []; const f = setup((call, param) => {
    if (call !== "ListarPedidos") return undefined; pages.push(Number(param.pagina));
    return Response.json({ pagina: param.pagina, total_de_paginas: 2, pedido_venda_produto: param.pagina === 1 ? Array.from({ length: 100 }, (_, n) => ({ cabecalho: { codigo_pedido: n + 1000, codigo_pedido_integracao: "old_" + n } })) : [] });
  });
  assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted"); assert.deepEqual(pages, [1, 2]); assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
});
test("Omie long read discovery checkpoints its next page under the fence without another customer or order POST", async () => {
  const pages: number[] = []; const f = setup((call, param) => {
    if (call !== "ListarPedidos") return undefined; pages.push(Number(param.pagina));
    return Response.json({ pagina: param.pagina, total_de_paginas: 11, pedido_venda_produto: param.pagina === 11 ? [] : [{ cabecalho: { codigo_pedido: Number(param.pagina) + 1000, codigo_pedido_integracao: "old" } }] });
  });
  assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "not_accepted", reasonCode: "fiscal_order_discovery_in_progress", retryAfterMs: 1000 });
  assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 0);
  assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted"); assert.deepEqual(pages, Array.from({ length: 11 }, (_, i) => i + 1));
  assert.equal(f.writes().filter(call => call.call === "IncluirCliente").length, 1); assert.equal(f.writes().filter(call => call.call === "IncluirPedido").length, 1);
});
test("Omie exact17digit protocol comes from XML even when JSON integer metadata is rounded", async () => {
  const protocol = "12345678901234567"; const sourceXml = xml().replace("151260029467289", protocol);
  const f = setup(call => call === "StatusPedido" ? Response.json({ codigo_pedido: 401, codigo_pedido_integracao: identity.reference, ListaNfe: [{ chave_nfe: key, xml_distr: sourceXml }] })
    : call === "NotaFiscalStatus" ? Response.json({ integracao: { codigo_empresa: 701, codigo_nf: 501 }, dados_lote: { ambiente: "H" }, dados_nota_fiscal: { faturada: "S", status_sefaz: "100", chave_nfe: key, protocolo: Number(protocol) }, dados_cancelamento: { nfCanc: "N" } }) : undefined);
  await f.prepare(); const result = await f.adapter.query(identity); assert.equal(result.found && result.document.status, "authorized");
  if (result.found && result.document.status === "authorized") { assert.equal(result.document.authorization.protocol, protocol); assert.notEqual(result.document.authorization.protocol, String(Number(protocol))); }
});
test("Omie onboarding inspects the actual company without a sale payload policy or fictitious claim", async () => {
  const calls: string[] = []; const adapter = new OmieFiscalAdapter({ scope: identity, companyId: "701", credential: async () => "app_token",
    authorization: { read: async () => ({ scope: identity, evidenceReference: "validated_app_grant:fixture", permissions: ["fiscal_read", "fiscal_write"] }) },
    fetch: (async (_url: unknown, init: RequestInit) => { const call = JSON.parse(init.body as string).call; calls.push(call); return Response.json({ codigo_empresa: 701, cnpj: identity.issuerTaxId, gera_nfe: "S" }); }) as typeof fetch });
  const result = await adapter.inspectConnection(identity); assert.ok(result.some(check => check.code === "issuer" && check.status === "verified")); assert.deepEqual(calls, ["ConsultarEmpresa"]);
  await assert.rejects(adapter.ensureOrder(identity, {}), /sale_context/); await assert.rejects(adapter.query(identity), /sale_context/); assert.deepEqual(calls, ["ConsultarEmpresa"]);
});
test("Omie retry after accepted billing recovers receipt even after ERP advances the order stage", async () => {
  let billed = false; const f = setup(call => {
    if (call === "FaturarPedidoVenda") billed = true;
    if (billed && call === "ConsultarPedido") return Response.json({ pedido_venda_produto: { ...payload().order, cabecalho: { ...payload().order.cabecalho as object, codigo_pedido: 401, codigo_cliente: 301, etapa: "50" } } });
    return undefined;
  });
  await f.prepare(); assert.equal((await f.bill()).outcome, "accepted"); assert.equal((await f.bill()).outcome, "accepted");
  assert.equal(f.calls.filter(call => call.call === "FaturarPedidoVenda").length, 1);
});

test("FISCAL-66 Omie original XML is recovered through ObterNfe after confirmed cancellation before a private copy", async () => {
  const cancelled = `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>151260029467299</nProt><dhRegEvento>2026-11-15T15:00:00Z</dhRegEvento></infEvento></retEvento></procEventoNFe>`;
  const f = setup(call => call === "StatusPedido" ? Response.json({ codigo_pedido: 401, codigo_pedido_integracao: identity.reference, ListaNfe: [{ chave_nfe: key, xml_distr: cancelled }] }) : call === "NotaFiscalStatus" ? Response.json({ integracao: { codigo_empresa: 701, codigo_nf: 501 }, dados_lote: { ambiente: "H" }, dados_nota_fiscal: { faturada: "S", status_sefaz: "100", chave_nfe: key }, dados_cancelamento: { nfCanc: "S" } }) : undefined);
  await f.prepare(); const before = f.writes().length; const artifact = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml", authorization: { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-15T13:00:00.000Z" } });
  assert.equal(new TextDecoder().decode(artifact.bytes), xml()); assert.ok(f.calls.some(c => c.call === "ObterNfe" && c.param.nIdNfe === 501)); assert.equal(f.writes().length, before); assert.equal(f.calls.some(c => c.call === "FaturarPedidoVenda"), false);
});

const invalidLookupClients: Array<[string, unknown]> = [
  ["different ID with identical fiscal fields", 893], ["missing ID", undefined], ["null ID", null], ["empty ID", ""],
  ["zero ID", 0], ["negative ID", -1], ["fractional ID", 417.5], ["unsafe ID", Number.MAX_SAFE_INTEGER + 1],
  ["non-numeric ID", "foreign"], ["noncanonical ID", "0417"], ["boolean ID", true],
];
function numericClientFixture(returnedId: unknown) {
  const f = setup((call, param) => {
    if (call === "ConsultarCliente") {
      assert.deepEqual(param, { codigo_cliente_omie: 417 });
      return Response.json({ ...f.data.contact, ...(returnedId === undefined ? {} : { codigo_cliente_omie: returnedId }) });
    }
    if (call === "ConsultarPedido") return Response.json({ pedido_venda_produto: {
      ...f.data.order, cabecalho: { ...f.data.order.cabecalho as object, codigo_pedido: 401, codigo_cliente: 417 }, total_pedido: { valor_total_pedido: 21.01 },
    } });
  });
  return f;
}
function assertNoNumericClientEffects(f: ReturnType<typeof setup>, before: string) {
  assert.equal(JSON.stringify([...f.records]), before, "rejected client identity cannot mutate the existing stage journal");
  assert.deepEqual(f.calls.filter(call => ["IncluirCliente", "IncluirPedido", "ValidarPedidoVenda", "FaturarPedidoVenda"].includes(call.call)), []);
  assert.equal(f.records.has("order.create"), false);
  assert.equal(f.records.has("invoice.submit"), false);
}
test("FISCAL-82 Omie numeric client identity blocks order creation before trusting recipient fields", async t => {
  for (const [name, returnedId] of invalidLookupClients) await t.test(name, async () => {
    const f = numericClientFixture(returnedId);
    f.records.set("contact.create", { identity, stage: "contact.create", reference: identity.reference + ":contact", remoteId: "417", outcome: "accepted" });
    const before = JSON.stringify([...f.records]);
    await assert.rejects(f.adapter.ensureOrder(identity, f.data), /fiscal_(?:identity_mismatch|provider_entity_invalid)/);
    assertNoNumericClientEffects(f, before); assert.equal(f.records.has("invoice.validate"), false);
    assert.equal(f.calls.some(call => call.call === "ListarPedidos"), false);
  });
});
test("FISCAL-82 Omie numeric client identity blocks existing-order validation without journal writes", async t => {
  for (const [name, returnedId] of invalidLookupClients) await t.test(name, async () => {
    const f = numericClientFixture(returnedId); const before = JSON.stringify([...f.records]);
    await assert.rejects(f.adapter.generate(identity, { id: "401", reference: identity.reference }), /fiscal_(?:identity_mismatch|provider_entity_invalid)/);
    assertNoNumericClientEffects(f, before); assert.equal(f.records.has("invoice.validate"), false);
    assert.deepEqual(f.calls.map(call => call.call), ["ConsultarPedido", "ConsultarCliente"]);
  });
});
test("FISCAL-82 Omie numeric client identity blocks billing and preserves prior validation", async t => {
  for (const [name, returnedId] of invalidLookupClients) await t.test(name, async () => {
    const f = numericClientFixture(returnedId);
    f.records.set("invoice.validate", { identity, stage: "invoice.validate", reference: identity.reference, remoteId: "401", outcome: "accepted" });
    const before = JSON.stringify([...f.records]);
    await assert.rejects(f.bill(), /fiscal_(?:identity_mismatch|provider_entity_invalid)/);
    assertNoNumericClientEffects(f, before); assert.equal(f.records.get("invoice.validate")!.outcome, "accepted");
    assert.deepEqual(f.calls.map(call => call.call), ["ConsultarPedido", "ConsultarCliente"]);
  });
});
test("FISCAL-82 Omie numeric client identity accepts the exact numeric or string lookup ID", async t => {
  for (const returnedId of [417, "417"]) await t.test(String(typeof returnedId), async () => {
    const f = numericClientFixture(returnedId);
    f.records.set("contact.create", { identity, stage: "contact.create", reference: identity.reference + ":contact", remoteId: "417", outcome: "accepted" });
    assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "accepted", value: { id: "401", reference: identity.reference } });
    assert.equal((f.calls.find(call => call.call === "IncluirPedido")!.param.cabecalho as Record<string, unknown>).codigo_cliente, 417);
    assert.deepEqual(await f.adapter.generate(identity, { id: "401", reference: identity.reference }), { outcome: "accepted", value: { remoteOrderId: "401" } });
    assert.equal((await f.bill()).outcome, "accepted");
    assert.equal(f.records.get("order.create")!.outcome, "accepted"); assert.equal(f.records.get("invoice.submit")!.outcome, "accepted");
  });
});

test("FISCAL-80 Omie transmits exact optional intermediary identifiers and sale invariants", async () => {
  const data = buildOmieFiscalPayload({ identity, issuedAt: "2026-11-18T12:30:00Z", sendEmail: false, fiscalPayment: { code: "17" },
    snapshot: { merchantId: identity.merchantId, environment: identity.environment, currency: "BRL", recipient: {
      name: "Cliente Intermediado", taxId: "52998224725", address: { street: "Rua Teste", number: "3", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" },
    }, items: { version: 1, profileVersionId: "profile1", commercialLines: [], excludedLines: [], pendingLines: [], policy: { stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon" },
      lines: [{ sku: "shirt", name: "Estojo", quantity: 3, unitPriceCents: 722, grossCents: 2166, discountCents: 13, shippingCents: 0, totalCents: 2153 }], fiscalTotals: { subtotalCents: 2166, discountCents: 13, shippingCents: 0, totalCents: 2153 },
    } } as never,
    profile: { id: "profile1", merchantId: identity.merchantId, environment: identity.environment, provider: "omie", confirmedBy: "accountant", confirmedAt: new Date("2026-11-18T10:00:00Z"), itemRules: {
      currency: "BRL", supportedProductTypes: ["physical"], operation: { etapa: "10", codigoParcela: "001", codigoCenarioImpostos: 1001, codigoCategoria: "1.01.02", codigoContaCorrente: 602, modalidadeFrete: "9", contribuinte: "N", indPresenca: "9", indIntermediario: "1", cnpjIntermediario: "11222333000181", identIntermediario: "loja-417", timeZone: "America/Sao_Paulo", products: { shirt: { productId: 101 } } },
      items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { "pis_padrao.cod_sit_trib_pis": "07" } } },
    } } as never,
  });
  const f = setup(); Object.assign(f.data, data);
  assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "accepted", value: { id: "401", reference: identity.reference } });
  const sent = f.calls.find(call => call.call === "IncluirPedido")!.param;
  const additional = sent.informacoes_adicionais as Record<string, unknown>;
  assert.deepEqual(additional.outros_detalhes, { cIndicadorOd: "9", cIndicadorIntOd: "1", cCnpjIntOd: "11222333000181", cIdentificadorIntOd: "loja-417" });
  for (const field of ["indPresenca", "indIntermediario", "cnpjIntermediario", "identIntermediario", "cCnpjIntOd", "cIdentificadorIntOd"]) assert.equal(Object.hasOwn(additional, field), false);
  assert.deepEqual(sent.cabecalho, { codigo_pedido_integracao: identity.reference, data_previsao: "18/11/2026", quantidade_itens: 1, etapa: "10", codigo_parcela: "001", codigo_cenario_impostos: 1001, nao_gerar_boleto: "S", codigo_cliente: 301 });
  assert.equal(f.calls.find(call => call.call === "IncluirCliente")!.param.cnpj_cpf, "52998224725");
  assert.equal(additional.enviar_email, "N"); assert.equal(additional.enviar_pix, "N"); assert.equal(additional.meio_pagamento, "17"); assert.equal(Object.hasOwn(additional, "utilizar_emails"), false);
  const item = (sent.det as Array<{ produto: Record<string, unknown>; inf_adic: Record<string, unknown> }>)[0]!;
  assert.equal(item.produto.codigo_produto, 101); assert.equal(item.produto.codigo, "shirt"); assert.equal(item.produto.quantidade, 3); assert.equal(item.produto.valor_unitario, 7.22); assert.equal(item.produto.valor_desconto, 0.13);
  assert.deepEqual(item.inf_adic, { nao_movimentar_estoque: "S", nao_gerar_financeiro: "S" }); assert.deepEqual(sent.frete, { modalidade: "9", valor_frete: 0 });
  assert.equal(Math.round((Number(item.produto.valor_unitario) * Number(item.produto.quantidade) - Number(item.produto.valor_desconto)) * 100), 2153); assert.equal(f.data.totalCents, 2153);
  assert.equal(f.records.get("order.create")!.relatedIds!.orderFingerprint, fiscalObjectFingerprint(sent));
  assert.equal(f.records.get("order.create")!.relatedIds!.financialSuppressed, "true"); assert.equal(f.records.get("order.create")!.relatedIds!.stockSuppressed, "true");
  assert.equal(f.calls.filter(call => call.call === "IncluirPedido").length, 1); assert.equal(f.calls.some(call => call.call === "ValidarPedidoVenda" || call.call === "FaturarPedidoVenda"), false);
  assert.equal(f.records.has("invoice.validate"), false); assert.equal(f.records.has("invoice.submit"), false);
});
