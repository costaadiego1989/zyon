import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { arrangeIssuance } from "../../../../tests/fiscal-issuance-harness.js";
import { FiscalIssuanceService } from "./fiscal-issuance.service.js";
import { FiscalProviderFactory } from "../infrastructure/fiscal-provider.factory.js";
import { PrismaFiscalIssuanceStore } from "../infrastructure/prisma-fiscal-issuance.store.js";
import type { OmieFiscalPayload } from "../infrastructure/providers/omie-fiscal.payload.js";

let f: Awaited<ReturnType<typeof createFiscalFixture>>;
before(async () => { f = await createFiscalFixture(); }, { timeout: 120000 });
after(async () => { await f?.close(); });
const profileItemRules = { currency: "BRL", supportedProductTypes: ["physical"], operation: { etapa: "10", codigoParcela: "001", codigoCenarioImpostos: 1001, codigoCategoria: "1.01.02", codigoContaCorrente: 602,
  modalidadeFrete: "0", contribuinte: "N", indPresenca: "2", indIntermediario: "0", timeZone: "America/Sao_Paulo", products: { shirt: { productId: 101 } } },
  items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { "icms_sn.cod_sit_trib_icms_sn": "102", "icms_sn.origem_icms_sn": "0", "pis_padrao.cod_sit_trib_pis": "07", "cofins_padrao.cod_sit_trib_cofins": "07" } } } };
for (const buyerEmail of [null, "invalid", "original@example.test"]) test("FISCAL-47 actual Omie issuance retains original provider email ownership with " + (buyerEmail ?? "absent") + " destination", async () => {
  const a = await arrangeIssuance(f, { provider: "omie", emailOwner: "provider", buyerEmail, profileItemRules });
  let payload: OmieFiscalPayload; let billed = false; let order: Record<string, unknown> | undefined; let client: Record<string, unknown> | undefined;
  const calls: { call: string; param: Record<string, unknown> }[] = [];
  const key = "352611" + a.sale.connection.issuerTaxId + "550010000000221123456780";
  const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><tpAmb>2</tpAmb><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${a.sale.connection.issuerTaxId}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>151260029467289</nProt><dhRecbto>2026-11-15T13:00:00Z</dhRecbto></infProt></protNFe></nfeProc>`;
  const factory = new FiscalProviderFactory({ credential: async () => "synthetic_omie_app", policyVersion: () => "synthetic_confirmed_policy", accountEvidence: { read: async () => null },
    authorization: { read: async scope => ({ scope, evidenceReference: "synthetic_app_grant", permissions: ["fiscal_read", "fiscal_write", "contact_write", "order_write"] }) },
    fetch: (async (_url: unknown, init: RequestInit) => {
      const { call, param: [param] } = JSON.parse(init.body as string); calls.push({ call, param });
      if (call === "ConsultarPedido") return Response.json({ pedido_venda_produto: order ?? { ...payload.order, cabecalho: { ...payload.order.cabecalho as object, codigo_pedido: 401, codigo_cliente: 301 } } });
      if (call === "StatusPedido") return Response.json({ codigo_pedido: 401, codigo_pedido_integracao: a.sale.intent.stableReference, ListaNfe: billed ? [{ chave_nfe: key, xml_distr: xml }] : [] });
      if (call === "ConsultarProduto") return Response.json({ codigo_produto: 101, codigo: "shirt", ncm: "61091000", unidade: "UN", origem_imposto: "NCM", recomendacoes_fiscais: { origem_mercadoria: "0" }, inativo: "N" });
      if (call === "ListarClientes") return Response.json({ pagina: 1, total_de_paginas: 1, clientes_cadastro: [] });
      if (call === "IncluirCliente") { client = { ...param, codigo_cliente_omie: 301 }; return Response.json({ codigo_cliente_omie: 301, codigo_cliente_integracao: param.codigo_cliente_integracao, codigo_status: "0" }); }
      if (call === "ConsultarCliente") return Response.json(client);
      if (call === "ListarPedidos") return Response.json({ pagina: 1, total_de_paginas: 1, pedido_venda_produto: [] });
      if (call === "IncluirPedido") { order = { ...param, cabecalho: { ...param.cabecalho, codigo_pedido: 401 }, total_pedido: { valor_total_pedido: 21.01 } }; return Response.json({ codigo_pedido: 401, codigo_pedido_integracao: a.sale.intent.stableReference, codigo_status: "0" }); }
      if (call === "ValidarPedidoVenda" || call === "FaturarPedidoVenda") { if (call === "FaturarPedidoVenda") billed = true; return Response.json({ nCodPed: 401, cCodIntPed: a.sale.intent.stableReference, cCodStatus: "0" }); }
      if (call === "ConsultarNF") return Response.json({ ide: { mod: "55", tpAmb: "2" }, compl: { nIdNF: 501, nIdPedido: 401, cChaveNFe: key }, total: { ICMSTot: { vNF: 21.01 } } });
      if (call === "NotaFiscalStatus") return Response.json({ integracao: { codigo_nf: 501 }, dados_lote: { ambiente: "H" }, dados_nota_fiscal: { faturada: "S", status_sefaz: "100", chave_nfe: key, protocolo: "151260029467289" }, dados_cancelamento: { nfCanc: "N" } });
      throw new Error("unexpected_synthetic_call_" + call);
    }) as typeof fetch });
  const service = new FiscalIssuanceService(a.store, { build: (...args) => payload = factory.build(...args) as OmieFiscalPayload, create: (...args) => factory.create(...args) }, a.payments);
  await service.run((await a.claim())!); assert.equal((await a.current()).state, "processing");
  const sent = calls.find(c => c.call === "IncluirPedido")!.param.informacoes_adicionais as Record<string, unknown>; const valid = buyerEmail === "original@example.test";
  assert.equal(sent.enviar_email, valid ? "S" : "N"); assert.equal(sent.utilizar_emails, valid ? buyerEmail : undefined); assert.equal(sent.enviar_pix, "N"); assert.equal(sent.nsu, "TID_original");
  const first = await new PrismaFiscalIssuanceStore(f.prisma).readOnly(a.scope, a.sale.intent.id); const decision = await first.providerEmailRequest();
  assert.equal(decision.owner, "provider"); assert.equal(decision.requested, valid); assert.equal(decision.included, valid); assert.equal(decision.reasonCode, valid ? undefined : buyerEmail === null ? "fiscal_email_destination_unavailable" : "fiscal_email_destination_invalid");
  await f.prisma.fiscalConnection.update({ where: { id: a.sale.connection.id }, data: { emailOwner: "zyon" } });
  await f.prisma.fiscalIntent.update({ where: { id: a.sale.intent.id }, data: { nextAttemptAt: new Date(0) } }); await service.run((await a.claim())!);
  const document = await f.prisma.fiscalDocument.findUniqueOrThrow({ where: { intentId: a.sale.intent.id } }); assert.equal(document.state, "authorized"); assert.equal(document.accessKey, key); assert.equal(document.authorizationProtocol, "151260029467289");
  assert.deepEqual(await (await new PrismaFiscalIssuanceStore(f.prisma).readOnly(a.scope, a.sale.intent.id)).providerEmailRequest(), decision);
  const stage = await f.prisma.fiscalProviderStageReceipt.findFirstOrThrow({ where: { intentId: a.sale.intent.id, stage: "invoice.submit" } });
  assert.equal(stage.outcome, "accepted"); assert.equal((stage.relatedIds as Record<string, string>).emailOwner, "provider"); assert.equal((stage.relatedIds as Record<string, string>).sendEmail, String(valid));
  assert.equal(calls.filter(c => c.call === "FaturarPedidoVenda").length, 1); assert.equal(await f.prisma.fiscalDelivery.count({ where: { merchantId: a.sale.merchantId } }), 0);
  assert.ok(!JSON.stringify(stage).includes("original@example.test")); assert.equal(document.documentState, "document_pending");
});
