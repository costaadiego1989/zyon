import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { BlingFiscalAdapter } from "./bling-fiscal.adapter.js";
import { buildBlingFiscalPayload } from "./bling-fiscal.payload.js";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageRecord } from "../../domain/fiscal-provider-stage.port.js";

const identity: FiscalIdentity = { merchantId: "merchant_a", connectionId: "connection_a", provider: "bling", environment: "homologation", issuerTaxId: "12345678000195", reference: "zyon-order-original" };
const key = "35" + "1".repeat(18) + "55" + "1".repeat(22);
const xml = (environment = "2", issuer = identity.issuerTaxId) => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><tpAmb>${environment}</tpAmb><mod>55</mod><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${issuer}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>${environment}</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>151260029467289</nProt><dhRecbto>2026-11-14T15:00:00Z</dhRecbto></infProt></protNFe></nfeProc>`;
const compressed = (content = xml()) => Response.json({ data: [{ nome: key + ".xml", conteudo: gzipSync(content).toString("base64") }] });
function payload(scope = identity, delivery: { emailOwner?: string; buyerEmail?: string; recipientEmail?: string } = {}) { return buildBlingFiscalPayload({ identity: scope, issuedAt: "2026-11-15T10:00:00Z", snapshot: {
  merchantId: identity.merchantId, environment: identity.environment, currency: "BRL", completedAt: new Date("2026-11-14T12:00:00Z"), recipient: {
    name: "Empresa Compradora", taxId: "12ABC34501DE35", ...(delivery.recipientEmail ? { email: delivery.recipientEmail } : {}), address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } },
  items: { version: 1, profileVersionId: "profile1", buyerContacts: { email: delivery.buyerEmail }, commercialLines: [], excludedLines: [], pendingLines: [], policy: { stockOwner: "zyon", emailOwner: delivery.emailOwner ?? "zyon", whatsappOwner: "zyon" },
    lines: [{ sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }], fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 } } } as never,
  profile: { id: "profile1", merchantId: identity.merchantId, environment: identity.environment, provider: "bling", confirmedBy: "accountant", confirmedAt: new Date(), itemRules: {
    currency: "BRL", supportedProductTypes: ["physical"], operation: { departureDateBasis: "issued_at", expectedDateBasis: "issued_at", fretePorConta: 0, indicadorIe: 9, lojaId: 601, crt: 1, cupomFiscal: 0,
      products: { shirt: { productId: 101, naturezaOperacaoId: 201 } } }, items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { "simples.cst": "102", "pis.cst": "07", "cofins.cst": "07" } } } } } as never }); }
function setup(override?: (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>, options: { fence?: boolean; finish?: boolean; evidence?: boolean; token?: string; evidencePatch?: Record<string, unknown>; authorization?: boolean; scope?: FiscalIdentity; emailOwner?: string } = {}) {
  const scope = options.scope ?? identity;
  const calls: { url: string; init: RequestInit }[] = []; const records = new Map<string, FiscalProviderStageRecord>();
  const evidence = { scope, policyVersion: "policy1", profileVersionId: "profile1", source: "responsible_confirmation", confirmedBy: "authorized_accountant", confirmationPermission: "fiscal.configure", certificateValidUntil: "2099-01-01T00:00:00Z", confirmedAt: "2026-11-14T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    effects: { stockOnSave: false, stockOnAuthorize: false, stockOnCancel: false, accountsOnSave: false, accountsOnAuthorize: false, accountsOnCancel: false, automaticEmail: false } };
  const adapter = new BlingFiscalAdapter({ scope, credential: async () => options.token ?? "merchant_a_token",
    journal: { check: async () => options.fence !== false, read: async (_identity, stage) => records.get(stage) ?? null,
      begin: async record => { if (options.fence === false) return false; records.set(record.stage, record); return true; }, finish: async record => { if (options.finish === false) return false; records.set(record.stage, record); return true; } },
    policy: { version: "policy1", profileVersionId: "profile1", stockOwner: "zyon", emailOwner: options.emailOwner ?? "zyon", whatsappOwner: "zyon" },
    accountEvidence: { read: async () => options.evidence === false ? null : { ...evidence, ...options.evidencePatch } as never },
    authorization: { read: async () => options.authorization === false ? null : ({ scope, evidenceReference: "validated_oauth_grant:fixture", permissions: ["fiscal_read", "fiscal_write", "order_write", "contact_write"] }) },
    fetch: (async (raw: string | URL | Request, init: RequestInit = {}) => {
      const url = String(raw); calls.push({ url, init }); const custom = await override?.(url, init); if (custom) return custom;
      if (url.includes("/empresas/me/dados-basicos")) return Response.json({ data: { cnpj: identity.issuerTaxId } });
      if (url.includes("/produtos/101")) return Response.json({ data: { id: 101, codigo: "shirt", tipo: "P", situacao: "A", unidade: "UN", tributacao: { ncm: "61091000", origem: 0 } } });
      if (url.endsWith("/naturezas-operacoes/201/obter-tributacao")) return Response.json({ data: { cfop: 5102, simples: { cst: "102" }, pis: { cst: "07" }, cofins: { cst: "07" } } });
      if (url.includes("/contatos?") || url.includes("/pedidos/vendas?") || url.includes("/nfe?")) return Response.json({ data: [] });
      if (url.endsWith("/contatos")) return Response.json({ data: { id: 301 } }, { status: 201 });
      if (url.endsWith("/contatos/301")) return Response.json({ data: { id: 301, ...payload().contact } });
      if (url.endsWith("/pedidos/vendas")) return Response.json({ data: { id: 401 } }, { status: 201 });
      if (url.endsWith("/gerar-nfe")) return Response.json({ idNotaFiscal: 501 }, { status: 201 });
      if (url.includes("/enviar?")) return Response.json({ data: { xml: "untrusted acceptance" } });
      if (url.includes("/nfe/documento/")) return compressed();
      if (url.endsWith("/nfe/501")) return Response.json({ data: { id: 501, numeroPedidoLoja: identity.reference, situacao: 5, numero: "22", serie: 1, chaveAcesso: key } });
      throw new Error("unexpected_test_request " + url);
    }) as typeof fetch });
  return { adapter, calls, records, scope };
}
const posts = (f: ReturnType<typeof setup>) => f.calls.filter(call => call.init.method === "POST" && call.url !== "https://api.bling.com.br/Api/v3/naturezas-operacoes/201/obter-tributacao");
test("FISCAL-53 Bling stages real contact order generation and submit using stable original sale data", async () => {
  const f = setup(); const input = payload(); const order = await f.adapter.ensureOrder(identity, input); assert.equal(order.outcome, "accepted");
  if (order.outcome !== "accepted") return; const generated = await f.adapter.generate(identity, order.value); assert.deepEqual(generated, { outcome: "accepted", value: { remoteInvoiceId: "501" } });
  const submitted = await f.adapter.submit(identity, { remoteInvoiceId: "501", payload: {}, sendEmail: false }); assert.equal(submitted.outcome, "accepted"); if (submitted.outcome === "accepted") assert.equal(submitted.value.status, "processing");
  const writes = posts(f); assert.equal(writes.length, 4); const contact = JSON.parse(writes[0]!.init.body as string); const sale = JSON.parse(writes[1]!.init.body as string);
  assert.equal(writes[0]!.url, "https://api.bling.com.br/Api/v3/contatos");
  assert.equal(contact.numeroDocumento, "12ABC34501DE35"); assert.equal(contact.codigo, identity.reference + ":contact"); assert.equal(sale.numeroLoja, identity.reference);
  assert.equal(sale.data, "2026-11-14"); assert.equal(sale.dataSaida, "2026-11-15"); assert.equal(sale.desconto.valor, 1.01); assert.equal(sale.transporte.frete, 2.02);
  assert.equal(sale.itens[0].produto.id, 101); assert.equal(sale.itens[0].quantidade, 2); assert.equal(sale.itens[0].valor, 10); assert.deepEqual(sale.parcelas, []);
  assert.ok(writes[3]!.url.endsWith("/nfe/501/enviar?enviarEmail=false")); assert.equal(new Headers(writes[0]!.init.headers).get("authorization"), "Bearer merchant_a_token");
  assert.equal(f.records.get("order.create")!.remoteId, "401"); assert.equal(f.records.get("invoice.generate")!.remoteId, "501");
});
test("Bling recovers the original remote order and existing invoice without a second POST", async () => {
  const f = setup(url => url.includes("/pedidos/vendas?") ? Response.json({ data: [{ id: 401 }] }) : url.endsWith("/pedidos/vendas/401") ? Response.json({ data: { id: 401, numeroLoja: identity.reference, total: 21.01, contato: { numeroDocumento: "12ABC34501DE35" }, notaFiscal: { id: 501 } } }) : undefined);
  const result = await f.adapter.ensureOrder(identity, payload()); assert.equal(result.outcome, "accepted");
  if (result.outcome === "accepted") assert.equal((await f.adapter.generate(identity, result.value)).outcome, "accepted"); assert.equal(posts(f).length, 0);
});
test("Bling contact timeout remains its own unresolved stage even when invoice lookup is empty", async () => {
  const f = setup((url, init) => { if (url.endsWith("/contatos") && init.method === "POST") throw new Error("timeout secret"); });
  assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); assert.deepEqual(await f.adapter.findByReference(identity), { found: false });
  assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); assert.equal(posts(f).length, 1); assert.equal(f.records.get("contact.create")!.outcome, "unknown");
  assert.equal(f.calls.filter(call => call.url.includes("/contatos?numeroDocumento=")).length, 1);
});
test("Bling order timeout never repeats accepted contact or uncertain order writes", async () => {
  const f = setup((url, init) => { if (url.endsWith("/pedidos/vendas") && init.method === "POST") throw new Error("lost response"); });
  assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); assert.equal(posts(f).length, 2);
});
test("Bling failed current fence performs zero provider IO", async () => { const f = setup(undefined, { fence: false }); assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); assert.equal(f.calls.length, 0); });
test("Bling unresolved generate stage cannot repeat generation", async () => {
  const f = setup((url) => { if (url.endsWith("/gerar-nfe")) throw new Error("timeout"); });
  const order = await f.adapter.ensureOrder(identity, payload()); assert.equal(order.outcome, "accepted"); if (order.outcome !== "accepted") return;
  assert.equal((await f.adapter.generate(identity, order.value)).outcome, "unknown"); assert.equal((await f.adapter.generate(identity, order.value)).outcome, "unknown"); assert.equal(posts(f).filter(call => call.url.endsWith("/gerar-nfe")).length, 1);
});
test("Bling authenticated XML supplies issuer environment number key protocol and authorization time", async () => {
  const f = setup(); const result = await f.adapter.query(identity, "501"); assert.equal(result.found, true);
  if (result.found) { assert.equal(result.document.status, "authorized"); if (result.document.status === "authorized") assert.deepEqual(result.document.authorization, { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-14T15:00:00Z" }); }
  assert.ok(f.calls[1]!.url.endsWith(`/nfe/documento/${key}?formato=xml`));
});
test("Bling authorized JSON alone cannot bypass missing XML protocol evidence", async () => { const f = setup(url => url.includes("/nfe/documento/") ? compressed("<NFe/>") : undefined); await assert.rejects(f.adapter.query(identity, "501"), /evidence|authorization/); });
test("Bling rejects another reference issuer or environment in authenticated query", async () => {
  for (const bad of ["reference", "issuer", "environment"]) { const f = setup(url => bad === "reference" && url.endsWith("/nfe/501") ? Response.json({ data: { id: 501, numeroPedidoLoja: "other", situacao: 5, chaveAcesso: key } }) : url.includes("/nfe/documento/") ? compressed(xml(bad === "environment" ? "1" : "2", bad === "issuer" ? "52998224725" : identity.issuerTaxId)) : undefined); await assert.rejects(f.adapter.query(identity, "501"), /identity|environment/); }
});
test("Bling documents decode the official gzip base64 envelope privately", async () => { const f = setup(); const result = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml" }); assert.equal(new TextDecoder().decode(result.bytes), xml()); assert.equal(result.mimeType, "application/xml"); });
test("Bling rejects XML with DTD or expanded content above the storage ceiling", async () => {
  for (const content of ['<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]>' + xml(), "x".repeat(20 * 1024 * 1024 + 1)]) {
    const f = setup(url => url.includes("/nfe/documento/") ? compressed(content) : undefined); await assert.rejects(f.adapter.query(identity, "501"), /evidence|artifact/);
  }
});
test("Bling refuses fiscal cancellation through API and never deletes drafts or cancels a sale", async () => { const f = setup(); const result = await f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento solicitado", requestedAt: "2026-11-14T16:00:00Z", restoreStock: false, reverseAccounts: false, cancelSale: false }); assert.deepEqual(result, { outcome: "not_accepted", reasonCode: "fiscal_cancellation_requires_erp_panel" }); assert.equal(f.calls.length, 0); });
test("Bling missing safe account defaults stays pending and prevents every write", async () => { const f = setup(undefined, { evidence: false }); const readiness = await f.adapter.inspectConnection(identity); assert.ok(readiness.some(check => check.status === "pending")); assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "not_accepted"); assert.equal(posts(f).length, 0); });
test("Bling readiness labels responsible confirmation separately from actual issuer API evidence", async () => { const f = setup(); const readiness = await f.adapter.inspectConnection(identity); assert.equal(readiness.some(check => check.status !== "verified"), false); assert.ok(readiness.some(check => check.evidenceReference?.startsWith("responsible_confirmation:"))); assert.ok(readiness.some(check => check.evidenceReference?.startsWith("bling:company:"))); });
test("Bling contact reconciliation queries contact code rather than an unrelated invoice", async () => { const f = setup(url => url.includes("/contatos?") ? Response.json({ data: [{ id: 301, codigo: identity.reference + ":contact" }] }) : undefined); const result = await f.adapter.reconcileStage(identity, { identity, stage: "contact.create", reference: identity.reference + ":contact", outcome: "unknown" }); assert.deepEqual(result, { found: true, remoteId: "301" }); assert.equal(posts(f).length, 0); assert.ok(f.calls[0]!.url.includes("/contatos?pesquisa=")); });
test("Bling order reconciliation uses the original store reference and exact order identity", async () => { const f = setup(url => url.includes("/pedidos/vendas?") ? Response.json({ data: [{ id: 401 }] }) : url.endsWith("/pedidos/vendas/401") ? Response.json({ data: { id: 401, numeroLoja: identity.reference } }) : undefined); assert.deepEqual(await f.adapter.reconcileStage(identity, { identity, stage: "order.create", reference: identity.reference, outcome: "unknown" }), { found: true, remoteId: "401" }); assert.ok(f.calls[0]!.url.includes("numerosLojas%5B%5D=")); });
test("Bling product drift fails before contact order or invoice writes", async () => { const f = setup(url => url.includes("/produtos/101") ? Response.json({ data: { id: 101, codigo: "other", tributacao: { ncm: "00000000", origem: 0 } } }) : undefined); await assert.rejects(f.adapter.ensureOrder(identity, payload()), /product/); assert.equal(posts(f).length, 0); });
test("Bling interleaved merchant adapter instances never share a bearer token", async () => { const a = setup(undefined, { token: "a_token" }); const b = setup(undefined, { token: "b_token", scope: { ...identity, merchantId: "merchant_b", connectionId: "connection_b" } }); await a.adapter.inspectConnection(identity); await b.adapter.inspectConnection(b.scope); assert.equal(new Headers(a.calls[0]!.init.headers).get("authorization"), "Bearer a_token"); assert.equal(new Headers(b.calls[0]!.init.headers).get("authorization"), "Bearer b_token"); await assert.rejects(b.adapter.ensureOrder(identity, payload()), /identity/); assert.equal(posts(b).length, 0); });
test("Bling wrong tenant expired evidence wrong policy and missing grant cannot authorize a write", async () => {
  for (const patch of [{ scope: { ...identity, merchantId: "other" } }, { expiresAt: "2020-01-01" }, { policyVersion: "changed" }, { profileVersionId: "changed" }, { confirmationPermission: "public" }]) {
    const f = setup(undefined, { evidencePatch: patch }); assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "not_accepted"); assert.equal(posts(f).length, 0);
  }
  const f = setup(undefined, { authorization: false }); assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "not_accepted"); assert.equal(posts(f).length, 0);
});
test("Bling actual nature tax calculation must match the frozen approved profile before any entity write", async () => {
  const f = setup(url => url.endsWith("/naturezas-operacoes/201/obter-tributacao") ? Response.json({ data: { cfop: 6102, simples: { cst: "900" }, pis: { cst: "01" }, cofins: { cst: "01" } } }) : undefined);
  await assert.rejects(f.adapter.ensureOrder(identity, payload()), /tax.*mismatch/); assert.equal(posts(f).length, 0);
  const query = f.calls.find(call => call.url.endsWith("/naturezas-operacoes/201/obter-tributacao"))!; const body = JSON.parse(query.init.body as string);
  assert.equal(body.municipio.id, 3550308); assert.equal(body.produto.valorUnitario, 10); assert.equal(body.produto.quantidade, 2); assert.equal(body.crt, 1);
});
test("Bling malformed comment CDATA duplicate evidence and NFCe model65 cannot authorize", async () => {
  const inner = xml().slice(xml().indexOf(">") + 1).replace("</nfeProc>", "");
  for (const content of [xml().replace("</nfeProc>", ""), `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><!--${inner}--></nfeProc>`,
    `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><![CDATA[${inner}]]></nfeProc>`, xml().replace("<nProt>", "<nProt>151260029467289</nProt><nProt>"), xml().replace("<mod>55</mod>", "<mod>65</mod>")]) {
    const f = setup(url => url.includes("/nfe/documento/") ? compressed(content) : undefined); await assert.rejects(f.adapter.query(identity, "501"), /evidence|authorization|identity|environment/);
  }
});
test("Bling an existing pending draft does not reconcile an uncertain SEFAZ submission", async () => {
  const f = setup(url => url.endsWith("/nfe/501") ? Response.json({ data: { id: 501, numeroPedidoLoja: identity.reference, situacao: 1 } }) : undefined);
  assert.deepEqual(await f.adapter.reconcileStage(identity, { identity, stage: "invoice.submit", reference: identity.reference, remoteId: "501", outcome: "unknown" }), { found: false });
  assert.equal(posts(f).length, 0);
});
test("Bling repeat purchase reuses an authenticated matching CPF contact when duplicates are disabled", async () => {
  let contactWrites = 0; let orderWrites = 0;
  const firstContact = { id: 301, ...payload().contact, nome: "EMPRESA COMPRADORA", numeroDocumento: "12.ABC.345/01DE-35" };
  const handler = (url: string, init: RequestInit) => {
    if (url.includes("/contatos?numeroDocumento=")) return Response.json({ data: contactWrites ? [{ id: 301, numeroDocumento: "12ABC34501DE35" }] : [] });
    if (url.endsWith("/contatos/301")) return Response.json({ data: firstContact });
    if (url.endsWith("/contatos") && init.method === "POST") { contactWrites++; return contactWrites === 1 ? Response.json({ data: { id: 301 } }, { status: 201 }) : Response.json({ error: "duplicate_document_disabled" }, { status: 400 }); }
    if (url.endsWith("/pedidos/vendas") && init.method === "POST") return Response.json({ data: { id: 400 + ++orderWrites } }, { status: 201 });
    return undefined;
  };
  const a = setup(handler); const b = setup(handler, { scope: { ...identity, reference: "zyon-order-repeat" } });
  assert.equal((await a.adapter.ensureOrder(identity, payload())).outcome, "accepted");
  assert.equal((await b.adapter.ensureOrder(b.scope, payload(b.scope))).outcome, "accepted");
  assert.equal(contactWrites, 1); assert.equal(orderWrites, 2);
  assert.equal(b.records.get("contact.create")!.remoteId, "301"); assert.equal(b.records.get("contact.create")!.reference, b.scope.reference + ":contact");
  assert.equal(b.records.get("contact.create")!.relatedIds!.source, "tax_id_match");
});
test("Bling divergent existing CPF contact remains review-required without global updates or duplicate POST", async () => {
  const f = setup(url => url.includes("/contatos?numeroDocumento=") ? Response.json({ data: [{ id: 301, numeroDocumento: "12ABC34501DE35" }] })
    : url.endsWith("/contatos/301") ? Response.json({ data: { id: 301, ...payload().contact, nome: "Different recipient" } }) : undefined);
  assert.deepEqual(await f.adapter.ensureOrder(identity, payload()), { outcome: "not_accepted", reasonCode: "fiscal_contact_reuse_requires_review" });
  assert.equal(posts(f).length, 0); assert.equal(f.calls.some(call => call.init.method === "PUT" || call.init.method === "DELETE"), false);
});
test("Bling ambiguous existing CPF contacts require review without any entity write", async () => {
  const f = setup(url => url.includes("/contatos?numeroDocumento=") ? Response.json({ data: [{ id: 301 }, { id: 302 }] }) : undefined);
  assert.deepEqual(await f.adapter.ensureOrder(identity, payload()), { outcome: "not_accepted", reasonCode: "fiscal_contact_reuse_requires_review" }); assert.equal(posts(f).length, 0);
});
test("Bling uncertain reused-contact persistence reconciles only its known remote ID and fingerprint", async () => {
  const f = setup(url => url.includes("/contatos?numeroDocumento=") ? Response.json({ data: [{ id: 301 }] })
    : url.endsWith("/contatos/301") ? Response.json({ data: { id: 301, ...payload().contact, codigo: "existing_buyer" } }) : undefined, { finish: false });
  assert.equal((await f.adapter.ensureOrder(identity, payload())).outcome, "unknown"); const record = f.records.get("contact.create")!; const before = f.calls.length;
  assert.equal(record.remoteId, "301"); assert.equal(record.outcome, "started");
  assert.deepEqual(await f.adapter.reconcileStage(identity, record), { found: true, remoteId: "301" });
  assert.equal(f.calls.length, before + 1); assert.ok(f.calls.at(-1)!.url.endsWith("/contatos/301")); assert.equal(posts(f).length, 0);
});
test("Bling frozen buyer email is distinct from company recipient and unsafe existing-contact email only suppresses delivery", async () => {
  const data = payload(identity, { emailOwner: "provider", buyerEmail: "buyer@example.test", recipientEmail: "company@example.test" });
  assert.equal(data.contact.emailNotaFiscal, "buyer@example.test");
  const f = setup(url => url.includes("/contatos?numeroDocumento=") ? Response.json({ data: [{ id: 301 }] }) : url.endsWith("/contatos/301")
    ? Response.json({ data: { id: 301, ...data.contact, codigo: "existing_buyer", emailNotaFiscal: "company@example.test" } }) : undefined, { emailOwner: "provider" });
  const order = await f.adapter.ensureOrder(identity, data); assert.equal(order.outcome, "accepted"); if (order.outcome !== "accepted") return;
  await f.adapter.generate(identity, order.value); const result = await f.adapter.submit(identity, { remoteInvoiceId: "501", payload: {}, sendEmail: true });
  assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") { assert.equal(result.value.status, "processing"); assert.deepEqual(result.value.providerEmailRequest, { requested: true, included: false, reasonCode: "fiscal_provider_email_destination_mismatch" }); }
  assert.ok(f.calls.find(call => call.url.includes("/enviar?"))!.url.endsWith("enviarEmail=false")); assert.equal(f.calls.some(call => call.init.method === "PUT"), false);
});

test("FISCAL-23 Bling authenticated payment mapping sends actual paid parcel and cAut without launching accounts", async () => {
  const body = { ...payload(), payment: { id: 701, code: "03", caut: "AUTH_original", acquirerTaxId: "12345678000195", brandCode: "01" }, order: { ...payload().order, parcelas: [{ dataVencimento: "2026-11-14", valor: 21.01, caut: "AUTH_original", formaPagamento: { id: 701 } }] } };
  const f = setup(url => url.endsWith("/formas-pagamentos/701") ? Response.json({ data: { id: 701, situacao: 1, finalidade: 2, tipoPagamento: 3, dadosCartao: { tipo: 1, autoLiquidacao: 0, cnpjCredenciadora: "12345678000195", bandeira: 1 } } }) : undefined);
  assert.equal((await f.adapter.ensureOrder(identity, body)).outcome, "accepted");
  const sent = JSON.parse(posts(f).find(c => c.url.endsWith("/pedidos/vendas"))!.init.body as string); assert.deepEqual(sent.parcelas, body.order.parcelas);
  assert.ok(!f.calls.some(c => c.url.includes("lancar-contas"))); assert.equal(sent.parcelas[0].valor, 21.01); assert.equal(sent.parcelas[0].caut, "AUTH_original");
});
test("FISCAL-23 Bling mismatched debit, acquirer or unsafe automatic liquidation blocks all entity writes", async () => {
  for (const patch of [{ tipoPagamento: 4 }, { dadosCartao: { tipo: 2, autoLiquidacao: 1 } }]) {
    const body = { ...payload(), payment: { id: 701, code: "03", caut: "AUTH_original", acquirerTaxId: "12345678000195", brandCode: "01" }, order: { ...payload().order, parcelas: [{ valor: 21.01, caut: "AUTH_original", formaPagamento: { id: 701 } }] } };
    const f = setup(url => url.endsWith("/formas-pagamentos/701") ? Response.json({ data: { id: 701, situacao: 1, finalidade: 2, tipoPagamento: 3, ...patch } }) : undefined);
    await assert.rejects(f.adapter.ensureOrder(identity, body), /fiscal_payment_mapping_mismatch/); assert.equal(posts(f).length, 0);
  }
});

test("FISCAL-66 Bling original authorized XML remains recoverable after ERP-panel cancellation without inferring cancellation status", async () => {
  const f = setup(url => url.endsWith("/nfe/501") ? Response.json({ data: { id: 501, numeroPedidoLoja: identity.reference, situacao: 2, chaveAcesso: key } }) : undefined);
  const artifact = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml", authorization: { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-14T15:00:00.000Z" } });
  assert.equal(new TextDecoder().decode(artifact.bytes), xml()); assert.ok(f.calls.some(c => c.url.endsWith("/nfe/documento/" + key + "?formato=xml"))); assert.equal(posts(f).length, 0); assert.equal((await f.adapter.query(identity, "501")).found, true); const queried = await f.adapter.query(identity, "501"); assert.equal(queried.found && queried.document.status, "processing");
});


test("ERP-CONTRACT-01 Bling binds the sales order to the tax calculation store", () => {
  const value = payload();
  assert.deepEqual(value.order.loja, { id: 601 });
  assert.equal(value.products.length, 1);
  assert.deepEqual(value.products[0]!.taxQuery.loja, { id: 601 });
});

test("ERP-CONTRACT-02 Bling transmits the original store with original sale and recipient", async () => {
  const f = setup();
  const result = await f.adapter.ensureOrder(identity, payload());
  assert.equal(result.outcome, "accepted");
  const create = f.calls.find(call => call.url.endsWith("/pedidos/vendas") && call.init.method === "POST");
  assert.ok(create);
  const sale = JSON.parse(String(create.init.body));
  assert.deepEqual(sale.loja, { id: 601 });
  const calculation = f.calls.find(call => call.url.endsWith("/naturezas-operacoes/201/obter-tributacao"));
  assert.ok(calculation);
  assert.deepEqual(JSON.parse(String(calculation.init.body)).loja, { id: 601 });
  assert.equal(sale.numeroLoja, identity.reference);
  assert.deepEqual(sale.contato, { id: 301 });
  assert.equal(sale.itens[0].produto.id, 101);
  assert.equal(sale.itens[0].quantidade, 2);
  assert.equal(sale.itens[0].valor, 10);
  assert.equal(sale.desconto.valor, 1.01);
  assert.equal(sale.transporte.frete, 2.02);
  assert.deepEqual(sale.parcelas, []);
  assert.equal(posts(f).length, 2);
});


function contractStorePayload(storeId: number, scope = identity, delivery: { emailOwner?: string; buyerEmail?: string; recipientEmail?: string } = {}) { return buildBlingFiscalPayload({ identity: scope, issuedAt: "2026-11-15T10:00:00Z", snapshot: {
  merchantId: identity.merchantId, environment: identity.environment, currency: "BRL", completedAt: new Date("2026-11-14T12:00:00Z"), recipient: {
    name: "Empresa Compradora", taxId: "12ABC34501DE35", ...(delivery.recipientEmail ? { email: delivery.recipientEmail } : {}), address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } },
  items: { version: 1, profileVersionId: "profile1", buyerContacts: { email: delivery.buyerEmail }, commercialLines: [], excludedLines: [], pendingLines: [], policy: { stockOwner: "zyon", emailOwner: delivery.emailOwner ?? "zyon", whatsappOwner: "zyon" },
    lines: [{ sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }], fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 } } } as never,
  profile: { id: "profile1", merchantId: identity.merchantId, environment: identity.environment, provider: "bling", confirmedBy: "accountant", confirmedAt: new Date(), itemRules: {
    currency: "BRL", supportedProductTypes: ["physical"], operation: { departureDateBasis: "issued_at", expectedDateBasis: "issued_at", fretePorConta: 0, indicadorIe: 9, lojaId: storeId, crt: 1, cupomFiscal: 0,
      products: { shirt: { productId: 101, naturezaOperacaoId: 201 } } }, items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { "simples.cst": "102", "pis.cst": "07", "cofins.cst": "07" } } } } } as never }); }

test("ERP-CONTRACT-02 Bling transmits each configured store instead of a fixture constant", async t => {
  for (const storeId of [42017, 805]) await t.test(String(storeId), async () => {
    const input = contractStorePayload(storeId);
    assert.deepEqual(input.order.loja, { id: storeId });
    assert.deepEqual(input.products[0]!.taxQuery.loja, { id: storeId });
    const f = setup();
    assert.equal((await f.adapter.ensureOrder(identity, input)).outcome, "accepted");
    const order = f.calls.find(call => call.url.endsWith("/pedidos/vendas") && call.init.method === "POST");
    const calculation = f.calls.find(call => call.url.endsWith("/naturezas-operacoes/201/obter-tributacao"));
    assert.ok(order); assert.ok(calculation);
    const sent = JSON.parse(String(order.init.body));
    assert.deepEqual(sent.loja, { id: storeId });
    assert.deepEqual(JSON.parse(String(calculation.init.body)).loja, { id: storeId });
    assert.equal(sent.numeroLoja, identity.reference);
    assert.deepEqual(sent.contato, { id: 301 });
    assert.equal(sent.desconto.valor, 1.01);
    assert.equal(sent.transporte.frete, 2.02);
    assert.equal(posts(f).length, 2);
  });
});
