import assert from "node:assert/strict";
import test from "node:test";
import { OlistFiscalAdapter } from "./olist-fiscal.adapter.js";
import { buildOlistFiscalPayload } from "./olist-fiscal.payload.js";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageRecord } from "../../domain/fiscal-provider-stage.port.js";

const identity: FiscalIdentity = { merchantId: "m_a", connectionId: "c_a", provider: "tiny", environment: "homologation", issuerTaxId: "12345678000195", reference: "zyon-sale-a" };
const key = "35" + "1".repeat(18) + "55" + "1".repeat(22);
const xml = (issuer = identity.issuerTaxId, env = "2") => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><tpAmb>${env}</tpAmb><nNF>22</nNF><serie>1</serie></ide><emit><CNPJ>${issuer}</CNPJ></emit></infNFe></NFe><protNFe><infProt><tpAmb>${env}</tpAmb><chNFe>${key}</chNFe><cStat>100</cStat><nProt>151260029467289</nProt><dhRecbto>2026-11-15T10:00:00-03:00</dhRecbto></infProt></protNFe></nfeProc>`;
function payload(scope = identity) { return buildOlistFiscalPayload({ identity: scope, issuedAt: "2026-11-15T13:00:00Z", fiscalPayment: { formaRecebimentoId: 71, meioPagamentoId: 81 }, snapshot: {
  merchantId: scope.merchantId, environment: scope.environment, currency: "BRL", completedAt: new Date("2026-11-14T12:00:00Z"), recipient: { name: "Compradora", taxId: "52998224725", address: { street: "Rua Um", number: "12", neighborhood: "Centro", city: "Sao Paulo", state: "SP", postalCode: "01001000", cityCode: "3550308", countryCode: "1058" } },
  items: { version: 1, profileVersionId: "p1", buyerContacts: { email: "buyer@example.test" }, commercialLines: [], excludedLines: [], pendingLines: [], policy: { stockOwner: "zyon", emailOwner: "provider", whatsappOwner: "zyon" },
    lines: [{ sku: "shirt", name: "Camiseta", quantity: 2, unitPriceCents: 1000, grossCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 }], fiscalTotals: { subtotalCents: 2000, discountCents: 101, shippingCents: 202, totalCents: 2101 } } } as never,
  profile: { id: "p1", merchantId: scope.merchantId, environment: scope.environment, provider: "tiny", confirmedBy: "accountant", confirmedAt: new Date(), itemRules: { currency: "BRL", supportedProductTypes: ["physical"],
    operation: { naturezaOperacaoId: 91, ecommerceId: 61, consumidorFinal: true, countryName: "Brasil", timeZone: "America/Sao_Paulo", products: { shirt: { productId: 101 } } },
    items: { shirt: { productType: "physical", ncm: "61091000", cfop: "5102", origin: "0", unit: "UN", taxes: { cst: "102", pisCst: "07", cofinsCst: "07" } } } } } as never }); }
type Override = (path: string, init: RequestInit, body: Record<string, unknown>) => Response | undefined | Promise<Response | undefined>;
function fixture(override?: Override, options: { scope?: FiscalIdentity; fence?: boolean; token?: string; v2?: boolean; evidence?: boolean; grant?: boolean } = {}) {
  const scope = options.scope ?? identity; const data = payload(scope); const calls: { path: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const records = new Map<string, FiscalProviderStageRecord>(); let contact: Record<string, unknown> | undefined; let order: Record<string, unknown> | undefined;
  const draft = () => ({ id: 501, situacao: 1, tipo: "S", numero: "22", serie: "1", chaveAcesso: key, dataEmissao: "2026-11-15", origem: { id: "401", tipo: "venda" }, ecommerce: { id: 61, numeroPedidoEcommerce: scope.reference }, valor: 21.01, valorProdutos: 20, valorFrete: 2.02, valorDesconto: 1.01, idNaturezaOperacao: 91, idFormaPagamento: 71, idMeioPagamento: 81,
    itens: [{ idProduto: 101, codigo: "shirt", ncm: "61091000", cfop: "5102", unidade: "UN", quantidade: 2, valorUnitario: 10 }] });
  const adapter = new OlistFiscalAdapter({ scope, credential: async () => options.token ?? "oauth_v3_a", credentialVersion: options.v2 ? "v2" : "v3", expectedPayload: data,
    policy: { version: "policy1", profileVersionId: "p1", stockOwner: "zyon", emailOwner: "provider", whatsappOwner: "zyon" },
    journal: { check: async () => options.fence !== false, read: async (_id, stage) => records.get(stage) ?? null, begin: async record => { if (options.fence === false) return false; records.set(record.stage, record); return true; }, finish: async record => { records.set(record.stage, record); return true; } },
    authorization: { read: async () => options.grant === false ? null : ({ scope, evidenceReference: "authenticated_oauth_grant", permissions: ["fiscal_read", "fiscal_write", "order_write", "contact_write"] }) },
    accountEvidence: { read: async () => options.evidence === false ? null : ({ scope, policyVersion: "policy1", profileVersionId: "p1", source: "responsible_confirmation", confirmedBy: "actor", confirmationPermission: "fiscal.configure", confirmedAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", certificateValidUntil: "2099-01-01T00:00:00Z", fiscalConfigurationFingerprint: data.configurationFingerprint,
      effects: { stockOnSave: false, stockOnAuthorize: false, stockOnCancel: false, accountsOnSave: false, accountsOnAuthorize: false, accountsOnCancel: false, automaticEmail: false, automaticInvoiceGeneration: false, automaticInvoiceAuthorization: false } }) },
    fetch: (async (raw: string | URL | Request, init: RequestInit = {}) => {
      assert.ok(String(raw).startsWith("https://api.tiny.com.br/public-api/v3/")); const url = new URL(String(raw)); const path = url.pathname.replace("/public-api/v3", "") + url.search; const body = init.body ? JSON.parse(String(init.body)) : {}; calls.push({ path, init, body }); const custom = await override?.(path, init, body); if (custom) return custom;
      if (path === "/info") return Response.json({ cpfCnpj: scope.issuerTaxId });
      if (path.startsWith("/contatos?") || path.startsWith("/pedidos?") || path.startsWith("/notas?")) return Response.json({ itens: [], paginacao: { total: 0, offset: 0, limit: 100 } });
      if (path === "/produtos/101") return Response.json({ id: 101, sku: "shirt", ncm: "61091000", origem: "0", unidade: "UN", situacao: "A" });
      if (path === "/contatos" && init.method === "POST") { contact = { ...body, id: 301 }; return Response.json({ id: 301 }); }
      if (path === "/contatos/301") return Response.json(contact ?? { ...data.contact, id: 301 });
      if (path === "/pedidos" && init.method === "POST") { order = { ...body, id: 401, cliente: { id: 301 }, valorTotalPedido: 21.01 }; return Response.json({ id: 401, numeroPedido: "44" }); }
      if (path === "/pedidos/401") return Response.json(order ?? { ...data.order, id: 401, cliente: { id: 301 }, valorTotalPedido: 21.01 });
      if (path === "/pedidos/401/gerar-nota-fiscal") return Response.json({ id: 501, numero: 22, serie: 1 });
      if (path === "/notas/501/emitir") return Response.json({ id: 501, situacao: 4, chaveAcesso: key });
      if (path === "/notas/501/cancelar") return Response.json({ situacao: 3, cStat: 135, motivo: "aceito" });
      if (path === "/notas/501") return Response.json(draft());
      if (path === "/notas/501/xml") return Response.json({ xmlNfe: xml(scope.issuerTaxId), xmlCancelamento: "" });
      if (path === "/notas/501/comprovante?format=pdf") return new Response("%PDF-1.7 synthetic", { headers: { "content-type": "application/pdf" } });
      throw new Error("unexpected_call " + path);
    }) as typeof fetch });
  const writes = () => calls.filter(call => call.init.method === "POST");
  const prepare = async () => { const order = await adapter.ensureOrder(scope, data); assert.equal(order.outcome, "accepted"); if (order.outcome !== "accepted") throw new Error("order_required"); assert.deepEqual(await adapter.generate(scope, order.value), { outcome: "accepted", value: { remoteInvoiceId: "501" } }); };
  const submit = (sendEmail = false) => adapter.submit(scope, { remoteInvoiceId: "501", payload: {}, sendEmail });
  return { adapter, data, scope, calls, records, writes, prepare, submit, draft };
}
test("Olist v3 real producer preserves goods cents, paid metadata and staged identities", async () => { const f = fixture(); await f.prepare(); const result = await f.submit(); assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") assert.equal(result.value.status, "processing"); assert.deepEqual(f.writes().map(call => call.path), ["/contatos", "/pedidos", "/pedidos/401/gerar-nota-fiscal", "/notas/501/emitir"]); const body = f.writes()[1]!.body; assert.equal(body.valorDesconto, 1.01); assert.equal(body.valorFrete, 2.02); assert.equal((body.itens as { quantidade: number; valorUnitario: number }[])[0]!.quantidade, 2); assert.equal((body.itens as { valorUnitario: number }[])[0]!.valorUnitario, 10); assert.equal((body.pagamento as { meioPagamento: { id: number } }).meioPagamento.id, 81); assert.equal(f.records.get("invoice.generate")?.remoteId, "501"); });
test("Olist refuses inventory v2 tokens before any IO", async () => { assert.throws(() => fixture(undefined, { v2: true }), /v3_authorization/); });
test("Olist two account tokens remain isolated when interleaved", async () => { const a = fixture(undefined, { token: "a" }); const b = fixture(undefined, { token: "b", scope: { ...identity, merchantId: "m_b", connectionId: "c_b" } }); await a.adapter.inspectConnection(identity); await b.adapter.inspectConnection(b.scope); assert.equal(new Headers(a.calls[0]!.init.headers).get("authorization"), "Bearer a"); assert.equal(new Headers(b.calls[0]!.init.headers).get("authorization"), "Bearer b"); await assert.rejects(b.adapter.ensureOrder(identity, a.data), /identity/); });
test("Olist failed lease performs zero provider IO", async () => { const f = fixture(undefined, { fence: false }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal(f.calls.length, 0); });
test("Olist contact timeout never repeats contact or uses note absence as its reconciliation", async () => { const f = fixture(path => { if (path === "/contatos") throw new Error("timeout secret"); }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal(f.writes().length, 1); assert.deepEqual(await f.adapter.reconcileStage(identity, f.records.get("contact.create")!), { found: false }); assert.equal(f.writes().length, 1); assert.ok(f.calls.at(-1)!.path.includes("codigo=")); });
test("Olist order timeout never repeats contact or order", async () => { const f = fixture(path => { if (path === "/pedidos") throw new Error("timeout"); }); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "unknown"); assert.equal(f.writes().length, 2); assert.equal(f.records.get("contact.create")?.remoteId, "301"); });
test("Olist repeat buyer reuses matching existing contact without global edit", async () => { const f = fixture(path => path.startsWith("/contatos?cpfCnpj=") ? Response.json({ itens: [{ id: 301 }], paginacao: { total: 1, offset: 0, limit: 100 } }) : undefined); assert.equal((await f.adapter.ensureOrder(identity, f.data)).outcome, "accepted"); assert.equal(f.writes().filter(call => call.path === "/contatos").length, 0); assert.equal(f.records.get("contact.create")?.relatedIds?.source, "tax_id_match"); });
test("Olist divergent existing contact requires review without mutation", async () => { const f = fixture(path => path.startsWith("/contatos?cpfCnpj=") ? Response.json({ itens: [{ id: 301 }], paginacao: { total: 1, offset: 0, limit: 100 } }) : path === "/contatos/301" ? Response.json({ ...payload().contact, id: 301, nome: "Outra pessoa" }) : undefined); assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "not_accepted", reasonCode: "fiscal_contact_reuse_requires_review" }); assert.equal(f.writes().length, 0); });
test("Olist configuration and credential evidence are mandatory independently", async () => { for (const option of [{ evidence: false }, { grant: false }]) { const f = fixture(undefined, option); const result = await f.adapter.ensureOrder(identity, f.data); assert.equal(result.outcome, "not_accepted"); assert.equal(f.calls.length, 0); } });
test("Olist product mismatch stops before creating any entity", async () => { const f = fixture(path => path === "/produtos/101" ? Response.json({ id: 101, sku: "foreign", ncm: "61091000", origem: "0", unidade: "UN" }) : undefined); await assert.rejects(f.adapter.ensureOrder(identity, f.data), /product_configuration/); assert.equal(f.writes().length, 0); });
test("Olist draft fiscal mismatch stops before SEFAZ submit", async () => { const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), valor: 99 }) : undefined); await f.prepare(); await assert.rejects(f.submit(), /content/); assert.equal(f.writes().some(call => call.path.endsWith("/emitir")), false); });
test("Olist authenticated XML establishes authorization rather than emit response", async () => { const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 6 }) : undefined); await f.prepare(); const result = await f.adapter.query(identity, "501"); assert.equal(result.found && result.document.status, "authorized"); if (result.found && result.document.status === "authorized") { assert.equal(result.document.authorization.protocol, "151260029467289"); assert.equal(result.document.authorization.accessKey, key); } });
test("Olist XML from another issuer or environment cannot authorize", async () => { for (const source of [xml("99999999000199"), xml(identity.issuerTaxId, "1")]) { const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 6 }) : path.endsWith("/xml") ? Response.json({ xmlNfe: source }) : undefined); await f.prepare(); await assert.rejects(f.adapter.query(identity, "501"), /identity|environment/); } });
test("Olist private XML and DANFE are retrieved from fixed authenticated endpoints", async () => { const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 6 }) : undefined); await f.prepare(); assert.equal(new TextDecoder().decode((await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml" })).bytes), xml()); assert.ok(new TextDecoder().decode((await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "danfe" })).bytes).startsWith("%PDF-")); assert.equal(f.calls.some(call => call.path.includes("/link")), false); });
test("Olist cancellation explicitly suppresses stock/accounts/commercial cancellation and remains processing", async () => { const f = fixture(); await f.prepare(); const result = await f.adapter.requestCancellation(identity, { remoteInvoiceId: "501", justification: "Cancelamento fiscal solicitado", requestedAt: "2026-11-15T16:00:00Z", restoreStock: false, reverseAccounts: false, cancelSale: false }); assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") assert.equal(result.value.status, "processing"); assert.deepEqual(f.writes().at(-1)!.body, { justificativa: "Cancelamento fiscal solicitado", estornarEstoque: false, estornarContas: false, cancelarVenda: false }); });
test("Olist generic cancelled status without event never confirms cancellation", async () => { const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 3 }) : undefined); await f.prepare(); const result = await f.adapter.query(identity, "501"); assert.equal(result.found && result.document.status, "processing"); });
test("Olist safe buyer email is used only when existing contact matches", async () => { const f = fixture(path => path === "/contatos/301" ? Response.json({ ...payload().contact, id: 301, emailNfe: "other@example.test" }) : undefined); await f.prepare(); const result = await f.submit(true); assert.equal(result.outcome, "accepted"); assert.equal(f.writes().at(-1)!.body.enviarEmail, false); if (result.outcome === "accepted") assert.equal(result.value.providerEmailRequest?.included, false); });
test("Olist rate limit stays retryable without an automatic second write", async () => { const f = fixture(path => path === "/contatos" ? new Response("", { status: 429, headers: { "retry-after": "7" } }) : undefined); assert.deepEqual(await f.adapter.ensureOrder(identity, f.data), { outcome: "not_accepted", reasonCode: "fiscal_provider_rate_limited", retryAfterMs: 7000 }); assert.equal(f.writes().length, 1); });
test("Olist uncertain generation and submission resume without another POST", async () => {
  for (const target of ["/pedidos/401/gerar-nota-fiscal", "/notas/501/emitir"]) {
    const f = fixture(path => { if (path === target) throw new Error("lost response"); });
    const order = await f.adapter.ensureOrder(identity, f.data); assert.equal(order.outcome, "accepted"); if (order.outcome !== "accepted") throw new Error("order_required");
    if (target.endsWith("gerar-nota-fiscal")) { assert.equal((await f.adapter.generate(identity, order.value)).outcome, "unknown"); assert.equal((await f.adapter.generate(identity, order.value)).outcome, "unknown"); }
    else { assert.equal((await f.adapter.generate(identity, order.value)).outcome, "accepted"); assert.equal((await f.submit()).outcome, "unknown"); assert.equal((await f.submit()).outcome, "unknown"); }
    assert.equal(f.writes().filter(call => call.path === target).length, 1);
  }
});
test("Olist cancellation confirms only the same scoped SEFAZ event", async () => {
  const event = `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>12345678901234567</nProt><dhRegEvento>2026-11-15T16:00:00-03:00</dhRegEvento></infEvento></retEvento></procEventoNFe>`;
  const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 3 }) : path.endsWith("/xml") ? Response.json({ xmlNfe: xml(), xmlCancelamento: event }) : undefined);
  await f.prepare(); const result = await f.adapter.query(identity, "501"); assert.equal(result.found && result.document.status, "cancelled");
  if (result.found && result.document.status === "cancelled") { assert.equal(result.document.cancellation.protocol, "12345678901234567"); assert.equal(result.document.authorization?.accessKey, key); }
});
test("Olist read-only onboarding uses the actual info endpoint without a sale or fake journal", async () => {
  const calls: string[] = []; const adapter = new OlistFiscalAdapter({ scope: identity, credentialVersion: "v3", credential: async () => "token", authorization: { read: async () => null }, fetch: (async url => { calls.push(String(url)); return Response.json({ cpfCnpj: identity.issuerTaxId, token: "do_not_expose" }); }) as typeof fetch });
  const result = await adapter.inspectConnection(identity); assert.equal(result.find(check => check.code === "issuer")?.status, "verified"); assert.equal(result.find(check => check.code === "certificate")?.status, "pending"); assert.equal(JSON.stringify(result).includes("do_not_expose"), false); assert.deepEqual(calls, ["https://api.tiny.com.br/public-api/v3/info"]);
});

test("FISCAL-66 Olist original XML after confirmed cancellation preserves stored authorization and never emits again", async () => {
  const cancelled = `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><retEvento><infEvento><tpAmb>2</tpAmb><chNFe>${key}</chNFe><tpEvento>110111</tpEvento><cStat>135</cStat><nProt>151260029467299</nProt><dhRegEvento>2026-11-15T15:00:00Z</dhRegEvento></infEvento></retEvento></procEventoNFe>`;
  const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 3 }) : path === "/notas/501/xml" ? Response.json({ xmlNfe: xml(), xmlCancelamento: cancelled }) : undefined);
  await f.prepare(); const before = f.writes().length; const artifact = await f.adapter.download(identity, { remoteInvoiceId: "501", kind: "xml", authorization: { number: "22", series: "1", accessKey: key, protocol: "151260029467289", authorizedAt: "2026-11-15T13:00:00.000Z" } });
  assert.equal(new TextDecoder().decode(artifact.bytes), xml()); assert.equal(f.writes().length, before); assert.equal(f.calls.some(c => c.path.endsWith("/emitir")), false);
});


test("ERP-CONTRACT-03 Olist refuses a contradictory optional client before fiscal submission", async t => {
  for (const client of [{ id: 999, cpfCnpj: "52998224725" }, { id: 301, cpfCnpj: "11144477735" }, { id: 999, cpfCnpj: null }, { id: null, cpfCnpj: "11144477735" }]) {
    await t.test(JSON.stringify(client), async () => {
      const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), cliente: client }) : undefined);
      await f.prepare();
      await assert.rejects(f.submit(), /fiscal_identity_mismatch/);
      assert.equal(f.writes().filter(call => call.path === "/notas/501/emitir").length, 0);
      assert.equal(f.records.has("invoice.submit"), false);
      assert.equal(f.writes().length, 3);
    });
  }
});

test("ERP-CONTRACT-04 Olist rejects contradictory authorized-looking notes before returning documents", async t => {
  for (const client of [{ id: 999, cpfCnpj: "52998224725" }, { id: 301, cpfCnpj: "11144477735" }]) {
    for (const kind of ["query", "xml", "danfe"] as const) await t.test(kind + JSON.stringify(client), async () => {
      const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), situacao: 6, cliente: client }) : undefined);
      await f.prepare();
      await assert.rejects(kind === "query" ? f.adapter.query(identity, "501") : f.adapter.download(identity, { remoteInvoiceId: "501", kind }), /fiscal_identity_mismatch/);
      assert.equal(f.calls.filter(call => call.path === "/notas/501/xml" || call.path.startsWith("/notas/501/comprovante")).length, 0);
      assert.equal(f.writes().length, 3);
    });
  }
});

test("ERP-CONTRACT-05 Olist preserves documented optional and format-equivalent client fields", async t => {
  const clients = [undefined, null, {}, { id: 301 }, { cpfCnpj: "529.982.247-25" }, { id: 301, cpfCnpj: null }, { id: null, cpfCnpj: "52998224725" }, { id: 301, cpfCnpj: "" }];
  for (const client of clients) await t.test(String(JSON.stringify(client)), async () => {
    const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), ...(client === undefined ? {} : { cliente: client }) }) : undefined);
    await f.prepare();
    assert.equal((await f.submit()).outcome, "accepted");
    assert.equal(f.writes().filter(call => call.path === "/notas/501/emitir").length, 1);
  });
  await t.test("formatted lowercase alphanumeric CNPJ", async () => {
    const f = fixture(path => path === "/notas/501" ? Response.json({ ...f.draft(), cliente: { id: 301, cpfCnpj: "12.abc.345/01de-35" } }) : undefined);
    f.data.contact.cpfCnpj = "12ABC34501DE35";
    await f.prepare();
    assert.equal((await f.submit()).outcome, "accepted");
    assert.equal(f.writes().filter(call => call.path === "/notas/501/emitir").length, 1);
  });
});


test("ERP-CONTRACT-03 Olist binds each actual journal contact instead of a fixture constant", async t => {
  for (const selectedId of [80713, 9901]) for (const invoiceClientId of [selectedId, 301]) {
    await t.test(JSON.stringify({ selectedId, invoiceClientId }), async () => {
      const f = fixture((path, init) => {
        if (path === "/contatos" && init.method === "POST") return Response.json({ id: selectedId });
        if (path === "/contatos/" + selectedId) return Response.json({ ...f.data.contact, id: selectedId });
        if (path === "/pedidos/401") return Response.json({ ...f.data.order, id: 401, cliente: { id: selectedId }, valorTotalPedido: 21.01 });
        if (path === "/notas/501") return Response.json({ ...f.draft(), cliente: { id: invoiceClientId, cpfCnpj: "52998224725" } });
        return undefined;
      });
      await f.prepare();
      assert.equal(f.records.get("contact.create")?.remoteId, String(selectedId));
      assert.equal(f.writes().find(call => call.path === "/pedidos")?.body.idContato, selectedId);
      if (invoiceClientId === selectedId) {
        assert.equal((await f.submit()).outcome, "accepted");
        assert.equal(f.writes().filter(call => call.path === "/notas/501/emitir").length, 1);
      } else {
        await assert.rejects(f.submit(), /fiscal_identity_mismatch/);
        assert.equal(f.writes().filter(call => call.path === "/notas/501/emitir").length, 0);
        assert.equal(f.records.has("invoice.submit"), false);
      }
    });
  }
});
