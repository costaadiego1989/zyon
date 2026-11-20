import assert from "node:assert/strict";
import test from "node:test";
import { FocusFiscalAdapter } from "./focus-fiscal.adapter.js";
import { buildFocusFiscalPayload } from "./focus-fiscal.payload.js";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageJournal, FiscalProviderStageRecord } from "../../domain/fiscal-provider-stage.port.js";

const identity: FiscalIdentity = { merchantId: "m1", connectionId: "c1", provider: "focus", environment: "homologation", issuerTaxId: "12ABC34501DE35", reference: "zyon-nfe-original-sale" };
const key = "35" + "1".repeat(18) + "55" + "1".repeat(22);
const authorized = { cnpj_emitente: identity.issuerTaxId, ref: identity.reference, status: "autorizado", numero: "22", serie: "1", chave_nfe: "NFe" + key,
  protocolo_nota_fiscal: { ambiente: "2", numero_protocolo: "151260029467289", data_recebimento: "2026-11-14T12:00:00-03:00" }, caminho_xml_nota_fiscal: "/arquivos/nfe.xml", caminho_danfe: "/arquivos/nfe.pdf" };
function authorizedXml(change: { accessKey?: string; protocol?: string; issuer?: string; environment?: string } = {}) {
  const accessKey = change.accessKey ?? key; const environment = change.environment ?? "2";
  return `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${accessKey}"><ide><tpAmb>${environment}</tpAmb><mod>55</mod><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${change.issuer ?? identity.issuerTaxId}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>${environment}</tpAmb><chNFe>${accessKey}</chNFe><cStat>100</cStat><nProt>${change.protocol ?? authorized.protocolo_nota_fiscal.numero_protocolo}</nProt><dhRecbto>${authorized.protocolo_nota_fiscal.data_recebimento}</dhRecbto></infProt></protNFe></nfeProc>`;
}
function payload(delivery: { emailOwner?: string; buyerEmail?: string; recipientEmail?: string } = {}) {
  return buildFocusFiscalPayload({ snapshot: { merchantId: "m1", environment: "homologation", currency: "BRL", completedAt: new Date("2026-11-14T12:00:00Z"),
    recipient: { name: "Empresa Compradora", taxId: "12ABC34501DE35", ...(delivery.recipientEmail ? { email: delivery.recipientEmail } : {}), address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308" } },
    items: { version: 1, profileVersionId: "profile_original", buyerContacts: { email: delivery.buyerEmail }, commercialLines: [], pendingLines: [], excludedLines: [], policy: { stockOwner: "zyon", emailOwner: delivery.emailOwner ?? "zyon", whatsappOwner: "zyon" },
      fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 },
      lines: [{ sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }] } } as never,
    profile: { id: "profile_original", merchantId: "m1", environment: "homologation", provider: "focus", confirmedBy: "accountant", confirmedAt: new Date(),
      itemRules: { currency: "BRL", supportedProductTypes: ["physical"], operation: { natureza_operacao: "Venda de mercadoria", tipo_documento: 1, finalidade_emissao: 1, local_destino: 1, consumidor_final: 1,
        presenca_comprador: 2, modalidade_frete: 0, indicador_inscricao_estadual_destinatario: 9 }, items: { shirt: {
        productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { icms_situacao_tributaria: "102", pis_situacao_tributaria: "07", cofins_situacao_tributaria: "07" } } } } } as never,
    issuerTaxId: identity.issuerTaxId, issuedAt: "2026-11-14T15:00:00.000Z" });
}
function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response>, options: { token?: string; environment?: "production" | "homologation"; fence?: boolean; finish?: boolean; companyId?: string; emailOwner?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = []; const records = new Map<string, FiscalProviderStageRecord>();
  const journal: FiscalProviderStageJournal = { check: async () => options.fence !== false, read: async (_id, stage) => records.get(stage) ?? null,
    begin: async record => { if (options.fence === false) return false; records.set(record.stage, { ...record, outcome: "started" }); return true; },
    finish: async record => { if (options.finish === false) return false; records.set(record.stage, record); return true; } };
  const scope = { ...identity, environment: options.environment ?? "homologation" };
  const adapter = new FocusFiscalAdapter({ scope, credential: async () => options.token ?? "company_token_a", journal,
    companyId: options.companyId, policy: { stockOwner: "zyon", emailOwner: options.emailOwner ?? "zyon", whatsappOwner: "zyon" },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return handler(String(url), init ?? {}); }) as typeof fetch });
  return { adapter, calls, records, scope };
}
test("FISCAL-19 Focus submits original sale using company Basic and a stable reference", async () => {
  const f = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }));
  const body = payload(); const result = await f.adapter.submit(identity, { payload: body, sendEmail: false });
  assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") assert.equal(result.value.status, "processing");
  assert.equal(f.calls[0]!.url, "https://homologacao.focusnfe.com.br/v2/nfe?ref=" + identity.reference);
  assert.equal(new Headers(f.calls[0]!.init.headers).get("authorization"), "Basic " + Buffer.from("company_token_a:").toString("base64"));
  const sent = JSON.parse(f.calls[0]!.init.body as string); assert.equal(sent.valor_total, 21.01); assert.equal(sent.items[0].quantidade_comercial, 2);
  assert.equal(sent.items[0].valor_unitario_comercial, 10); assert.equal(sent.items[0].valor_desconto, 1.01); assert.equal(sent.items[0].valor_frete, 2.02);
  assert.equal(sent.cnpj_destinatario, "12ABC34501DE35"); assert.equal(sent.data_emissao, "2026-11-14T15:00:00.000Z");
});
test("Focus interleaved tenants and environments never share company credentials", async () => {
  const a = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }), { token: "company_a" });
  const b = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }), { token: "company_b", environment: "production" });
  await a.adapter.submit(identity, { payload: payload(), sendEmail: false }); await b.adapter.submit(b.scope, { payload: payload(), sendEmail: false });
  assert.equal(new Headers(a.calls[0]!.init.headers).get("authorization"), "Basic " + Buffer.from("company_a:").toString("base64"));
  assert.equal(new Headers(b.calls[0]!.init.headers).get("authorization"), "Basic " + Buffer.from("company_b:").toString("base64"));
  assert.ok(b.calls[0]!.url.startsWith("https://api.focusnfe.com.br/"));
});
test("Focus request response claiming authorized is still processing until authenticated query", async () => {
  const f = setup(() => Response.json(authorized, { status: 201 })); const result = await f.adapter.submit(identity, { payload: payload(), sendEmail: false });
  assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") { assert.equal(result.value.status, "processing"); assert.equal(result.value.verifiedBy, "request_response"); }
});
test("Focus authenticated complete query maps actual protocol time environment and identifiers", async () => {
  const f = setup(() => Response.json(authorized)); const result = await f.adapter.query(identity);
  assert.equal(f.calls[0]!.url, "https://homologacao.focusnfe.com.br/v2/nfe/" + identity.reference + "?completa=1");
  assert.deepEqual(result, { found: true, document: { identity, remoteInvoiceId: identity.reference, providerStatus: "autorizado", verifiedBy: "authenticated_query", status: "authorized",
    authorization: { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-14T12:00:00-03:00" } } });
});
test("Focus query refuses another issuer reference or fiscal environment", async () => {
  for (const change of [{ cnpj_emitente: "52998224725" }, { ref: "other_sale" }, { protocolo_nota_fiscal: { ...authorized.protocolo_nota_fiscal, ambiente: "1" } }]) {
    const f = setup(() => Response.json({ ...authorized, ...change })); await assert.rejects(f.adapter.query(identity), /identity|environment/);
  }
});
test("Focus rejected status exposes only safe fiscal reason code", async () => {
  const f = setup(() => Response.json({ cnpj_emitente: identity.issuerTaxId, ref: identity.reference, status: "erro_autorizacao", status_sefaz: "598", mensagem_sefaz: "secret-token full recipient" }));
  const result = await f.adapter.query(identity); assert.equal(result.found, true);
  if (result.found) assert.deepEqual(result.document, { identity, remoteInvoiceId: identity.reference, providerStatus: "erro_autorizacao", verifiedBy: "authenticated_query", status: "rejected", reasonCode: "sefaz_598" });
});
test("Focus query 404 is absent evidence and never writes or marks a connection ready", async () => {
  const f = setup(() => Response.json({ codigo: "nao_encontrado" }, { status: 404 })); assert.deepEqual(await f.adapter.findByReference(identity), { found: false });
  const readiness = await f.adapter.inspectConnection(identity); assert.ok(readiness.some(check => check.status === "pending")); assert.equal(f.calls.length, 1);
});
test("Focus started timeout remains uncertain and cannot repeat POST on another call", async () => {
  const f = setup(() => { throw new Error("network lost with token secret"); });
  assert.deepEqual(await f.adapter.submit(identity, { payload: payload(), sendEmail: false }), { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" });
  assert.equal((await f.adapter.submit(identity, { payload: payload(), sendEmail: false })).outcome, "unknown"); assert.equal(f.calls.length, 1);
  assert.equal(f.records.get("invoice.submit")!.outcome, "unknown");
});
test("Focus failed persisted fence permits zero provider IO", async () => {
  const f = setup(() => Response.json({}), { fence: false }); assert.equal((await f.adapter.submit(identity, { payload: payload(), sendEmail: false })).outcome, "unknown"); assert.equal(f.calls.length, 0);
});
test("Focus accepted remote write with failed local finish remains uncertain", async () => {
  const f = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }), { finish: false });
  assert.equal((await f.adapter.submit(identity, { payload: payload(), sendEmail: false })).outcome, "unknown");
  assert.equal((await f.adapter.submit(identity, { payload: payload(), sendEmail: false })).outcome, "unknown"); assert.equal(f.calls.length, 1);
});
test("Focus rate rejection carries bounded Retry-After without automatic retry", async () => {
  const f = setup(() => Response.json({ codigo: "limite_requisicoes" }, { status: 429, headers: { "retry-after": "7" } }));
  assert.deepEqual(await f.adapter.submit(identity, { payload: payload(), sendEmail: false }), { outcome: "not_accepted", reasonCode: "fiscal_provider_rate_limited", retryAfterMs: 7000 }); assert.equal(f.calls.length, 1);
});
test("Focus invalid credentials request reauthorization and redact the provider response", async () => {
  const f = setup(() => new Response("secret provider token", { status: 401 }));
  assert.deepEqual(await f.adapter.submit(identity, { payload: payload(), sendEmail: false }), { outcome: "not_accepted", reasonCode: "fiscal_reauthorization_required" });
});
test("Focus downloads authorized private XML from the same explicit environment", async () => {
  const f = setup(url => url.includes("/v2/nfe/") ? Response.json(authorized) : new Response(authorizedXml(), { headers: { "content-type": "application/xml" } }));
  const document = await f.adapter.download(identity, { remoteInvoiceId: identity.reference, kind: "xml" }); assert.equal(new TextDecoder().decode(document.bytes), authorizedXml());
  assert.equal(f.calls[1]!.url, "https://homologacao.focusnfe.com.br/arquivos/nfe.xml"); assert.equal(f.calls[1]!.init.redirect, "manual");
});
test("Focus refuses off-origin document paths before sending any credential to them", async () => {
  const f = setup(() => Response.json({ ...authorized, caminho_danfe: "https://evil.example/private" }));
  await assert.rejects(f.adapter.download(identity, { remoteInvoiceId: identity.reference, kind: "danfe" }), /artifact_origin/); assert.equal(f.calls.length, 1);
});
test("Focus cancellation validates justification and never restores stock accounts or sale", async () => {
  const f = setup(() => Response.json({ status: "cancelado" }));
  const input = { remoteInvoiceId: identity.reference, justification: "Cancelamento confirmado pelo lojista", requestedAt: "2026-11-14T12:00:00Z", restoreStock: false as const, reverseAccounts: false as const, cancelSale: false as const };
  assert.equal((await f.adapter.requestCancellation(identity, input)).outcome, "accepted");
  assert.equal(f.calls[0]!.init.method, "DELETE"); assert.deepEqual(JSON.parse(f.calls[0]!.init.body as string), { justificativa: input.justification });
  await assert.rejects(f.adapter.requestCancellation(identity, { ...input, justification: "curta" }), /justification/); assert.equal(f.calls.length, 1);
});
test("Focus company readiness reads documented company ID and never returns company tokens", async () => {
  const f = setup(() => Response.json({ id: "company_123", cnpj: identity.issuerTaxId, habilita_nfe: true, certificado_cnpj: identity.issuerTaxId,
    certificado_valido_de: "2020-01-01T00:00:00Z", certificado_valido_ate: "2099-01-01T00:00:00Z", enviar_email_destinatario: false, enviar_email_homologacao: false, token_producao: "never expose", token_homologacao: "company_token_a" }), { companyId: "company_123" });
  const result = await f.adapter.inspectConnection(identity); assert.equal(f.calls[0]!.url, "https://api.focusnfe.com.br/v2/empresas/company_123");
  assert.equal(result.filter(check => check.status !== "verified").length, 0); assert.equal(JSON.stringify(result).includes("never expose"), false);
});
test("Focus payload producer requires explicit confirmed operation and preserves every fiscal cent", () => {
  const data = payload(); assert.equal(data.valor_produtos, 20); assert.equal(data.valor_desconto, 1.01); assert.equal(data.valor_frete, 2.02); assert.equal(data.valor_total, 21.01);
  assert.equal((data.items as Record<string, unknown>[])[0]!.icms_situacao_tributaria, "102");
  assert.throws(() => buildFocusFiscalPayload({ snapshot: {} as never, profile: { confirmedAt: null } as never, issuerTaxId: identity.issuerTaxId }), /profile|configuration/);
});
test("Focus same-entity stage reconciliation finds the original reference without a new POST", async () => {
  const f = setup(() => Response.json(authorized));
  const result = await f.adapter.reconcileStage(identity, { identity, stage: "invoice.submit", reference: identity.reference, outcome: "unknown" });
  assert.deepEqual(result, { found: true, remoteId: identity.reference }); assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.init.method, "GET");
});

test("Focus confirmed cancellation requires the authenticated same-key SEFAZ event protocol", async () => {
  const f = setup(url => url.includes("/v2/nfe/") ? Response.json({ ...authorized, status: "cancelado", caminho_xml_cancelamento: "/arquivos/cancelamento.xml" })
    : new Response(`<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>151260029467290</nProt><dhRegEvento>2026-11-14T13:00:00-03:00</dhRegEvento></infEvento></retEvento></procEventoNFe>`, { headers: { "content-type": "application/xml" } }));
  const result = await f.adapter.query(identity); assert.equal(result.found, true);
  if (result.found) { assert.equal(result.document.status, "cancelled"); if (result.document.status === "cancelled") assert.deepEqual(result.document.cancellation, { protocol: "151260029467290", cancelledAt: "2026-11-14T13:00:00-03:00" }); }
  assert.equal(f.calls.length, 2);
});

test("Focus basic cancelled status without event evidence never confirms cancellation", async () => {
  const f = setup(() => Response.json({ ...authorized, status: "cancelado" })); const result = await f.adapter.query(identity);
  assert.equal(result.found && result.document.status, "processing"); assert.equal(f.calls.length, 1);
});

test("Focus cancellation reconciliation cannot accept an unchanged authorized invoice as the cancellation", async () => {
  const f = setup(() => Response.json(authorized));
  assert.deepEqual(await f.adapter.reconcileStage(identity, { identity, stage: "invoice.cancel", reference: identity.reference, outcome: "unknown" }), { found: false });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.init.method, "GET");
});
test("Focus malformed comment CDATA and duplicate event evidence cannot confirm cancellation", async () => {
  const event = `<retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>151260029467290</nProt><dhRegEvento>2026-11-14T13:00:00-03:00</dhRegEvento></infEvento></retEvento>`;
  const root = '<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe">';
  for (const content of [root + event, root + `<!--${event}-->` + "</procEventoNFe>", root + `<![CDATA[${event}]]>` + "</procEventoNFe>", root + event + event + "</procEventoNFe>"]) {
    const f = setup(url => url.includes("/v2/nfe/") ? Response.json({ ...authorized, status: "cancelado", caminho_xml_cancelamento: "/arquivos/cancelamento.xml" }) : new Response(content, { headers: { "content-type": "application/xml" } }));
    await assert.rejects(f.adapter.query(identity), /evidence|cancellation/);
  }
});
test("Focus downloaded XML with another key protocol issuer or environment cannot replace confirmed authorization", async () => {
  for (const change of [{ accessKey: key.slice(0, -1) + "2" }, { protocol: "151260029467290" }, { issuer: "52998224725" }, { environment: "1" }]) {
    const f = setup(url => url.includes("/v2/nfe/") ? Response.json(authorized) : new Response(authorizedXml(change), { headers: { "content-type": "application/xml" } }));
    await assert.rejects(f.adapter.download(identity, { remoteInvoiceId: identity.reference, kind: "xml" }), /identity|environment|authorization|artifact/);
    const retained = await f.adapter.query(identity); assert.equal(retained.found && retained.document.status, "authorized");
    if (retained.found && retained.document.status === "authorized") assert.equal(retained.document.authorization.protocol, authorized.protocolo_nota_fiscal.numero_protocolo);
  }
});
test("Focus authenticated alpha-CNPJ key remains valid without relaxing model or forbidden letter positions", async () => {
  const alpha = "35261112ABC34501DE35550010000000221123456780";
  const f = setup(() => Response.json({ ...authorized, chave_nfe: "NFe" + alpha })); const result = await f.adapter.query(identity);
  assert.equal(result.found && result.document.status, "authorized"); if (result.found && result.document.status === "authorized") assert.equal(result.document.authorization.accessKey, alpha);
  for (const index of [0, 5, 18, 43]) { const bad = setup(() => Response.json({ ...authorized, chave_nfe: alpha.slice(0, index) + "A" + alpha.slice(index + 1) })); await assert.rejects(bad.adapter.query(identity), /authorization/); }
});
test("Focus protocol query preserves15or17digit strings and refuses14,16,18", async () => {
  for (const length of [15, 17]) { const protocol = "1".repeat(length); const f = setup(() => Response.json({ ...authorized, protocolo_nota_fiscal: { ...authorized.protocolo_nota_fiscal, numero_protocolo: protocol } })); const result = await f.adapter.query(identity); assert.equal(result.found && result.document.status, "authorized"); if (result.found && result.document.status === "authorized") assert.equal(result.document.authorization.protocol, protocol); }
  for (const length of [14, 16, 18]) { const f = setup(() => Response.json({ ...authorized, protocolo_nota_fiscal: { ...authorized.protocolo_nota_fiscal, numero_protocolo: "1".repeat(length) } })); await assert.rejects(f.adapter.query(identity), /authorization/); }
});
test("Focus provider email true includes only frozen buyer contact while false suppresses fiscal-company email", async () => {
  for (const sendEmail of [false, true]) {
    const f = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }), { emailOwner: "provider" });
    await f.adapter.submit(identity, { payload: payload({ emailOwner: "provider", buyerEmail: "buyer@example.test", recipientEmail: "company@example.test" }), sendEmail });
    const body = JSON.parse(f.calls[0]!.init.body as string); assert.equal(body.email_destinatario, sendEmail ? "buyer@example.test" : undefined);
    assert.equal(JSON.stringify(body).includes("company@example.test"), false); assert.equal("__zyonFiscalDelivery" in body, false);
    assert.equal(f.records.get("invoice.submit")!.relatedIds!.emailOwner, "provider");
  }
});
test("Focus an accepted retry cannot change frozen email owner or destination even when delivery was suppressed", async () => {
  const f = setup(() => Response.json({ status: "processando_autorizacao" }, { status: 202 }), { emailOwner: "provider" });
  await f.adapter.submit(identity, { payload: payload({ emailOwner: "provider", buyerEmail: "buyer@example.test" }), sendEmail: false });
  await assert.rejects(f.adapter.submit(identity, { payload: payload({ emailOwner: "provider", buyerEmail: "different@example.test" }), sendEmail: false }), /immutable/); assert.equal(f.calls.length, 1);
});

test("FISCAL-66 Focus retrieves original authorized XML after cancellation using the stored original authorization", async () => {
  const f = setup(url => url.includes("/v2/nfe/") ? Response.json({ ...authorized, status: "cancelado" }) : new Response(authorizedXml(), { headers: { "content-type": "application/xml" } }));
  const authorization = { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-14T15:00:00.000Z" };
  const artifact = await f.adapter.download(identity, { remoteInvoiceId: identity.reference, kind: "xml", authorization }); assert.equal(new TextDecoder().decode(artifact.bytes), authorizedXml()); assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => c.init.method === "GET"));
  await assert.rejects(f.adapter.download(identity, { remoteInvoiceId: identity.reference, kind: "xml", authorization: { ...authorization, protocol: "151260029467299" } }), /authorization_mismatch/);
});
