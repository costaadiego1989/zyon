import { assertFiscalIdentity, fiscalProviderCapabilities, type FiscalIdentity, type FiscalProviderDocument, type FiscalProviderPort, type FiscalQueryResult, type FiscalReadinessCheck, type FiscalRemoteOrder, type FiscalScope } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageRecord, FiscalStageQueryResult, FiscalStageReconciliationPort } from "../../domain/fiscal-provider-stage.port.js";
import type { FiscalCredentialAuthorizationPort, FiscalErpAccountEvidencePort, FiscalErpEffectPolicy } from "../../domain/fiscal-erp-account-evidence.port.js";
import { validErpAccountEvidenceBinding } from "../../domain/fiscal-erp-account-evidence.port.js";
import { assertScope, FiscalHttpTransport, remoteId, safeArtifactUrl, type FiscalHttpOptions } from "./provider-http.transport.js";
import { assertOriginalFiscalAuthorization, authorizedNfe, cancelledNfeEvent, safeXml } from "./provider-xml-evidence.js";
import { fiscalObjectFingerprint, omieDate, type OmieFiscalPayload } from "./omie-fiscal.payload.js";
import { isFiscalAccessKey } from "../../domain/fiscal-access-key.js";
interface OmieOptions extends FiscalHttpOptions {
  expectedPayload?: OmieFiscalPayload; companyId?: string; policy?: FiscalErpEffectPolicy; authorization: FiscalCredentialAuthorizationPort;
  accountEvidence?: FiscalErpAccountEvidencePort;
  /** Exact origins from reviewed server wiring, never public caller input. */
  artifactOrigins?: readonly string[];
}
const paths = { clients: "/api/v1/geral/clientes/", products: "/api/v1/geral/produtos/", orders: "/api/v1/produtos/pedido/",
  billing: "/api/v1/produtos/pedidovendafat/", notes: "/api/v1/produtos/nf/", consult: "/api/v1/produtos/nfconsultar/", documents: "/api/v1/produtos/notafiscalutil/", dfe: "/api/v1/produtos/dfedocs/", companies: "/api/v1/geral/empresas/" } as const;
const unknown = () => ({ outcome: "unknown" as const, reasonCode: "fiscal_write_outcome_unknown" });
function subset(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((value, index) => subset(value, actual[index]));
  if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => value === undefined || subset(value, (actual as Record<string, unknown>)[key]));
  return expected === actual;
}
function customerFingerprint(value: Record<string, unknown>) {
  const text = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
  return fiscalObjectFingerprint([text(value.cnpj_cpf).replace(/[^A-Z0-9]/g, ""), ...["razao_social", "contribuinte", "endereco", "endereco_numero", "complemento", "bairro", "estado", "cidade_ibge", "codigo_pais"].map(key => text(value[key])), text(value.cep).replace(/\D/g, "")]);
}
export class OmieFiscalAdapter implements FiscalProviderPort, FiscalStageReconciliationPort {
  readonly provider = "omie" as const; readonly capabilities = fiscalProviderCapabilities(this.provider); private readonly http: FiscalHttpTransport;
  constructor(private readonly options: OmieOptions) {
    if (options.scope.provider !== "omie" || !["homologation", "production"].includes(options.scope.environment)) throw new Error("fiscal_environment_required");
    this.http = new FiscalHttpTransport(options, "https://app.omie.com.br", "bearer");
  }
  private get payload() { if (!this.options.expectedPayload) throw new Error("fiscal_sale_context_required"); return this.options.expectedPayload; }
  private get policy() { if (!this.options.policy) throw new Error("fiscal_sale_context_required"); return this.options.policy; }
  private sale(identity: FiscalIdentity) {
    const payload = this.payload; const policy = this.policy;
    if (payload.reference !== identity.reference || payload.profileVersionId !== policy.profileVersionId || payload.stockOwner !== policy.stockOwner || payload.emailOwner !== policy.emailOwner) throw new Error("fiscal_sale_context_required");
    return payload;
  }
  private async authorized() {
    const grant = await this.options.authorization.read(this.options.scope); if (!grant) return false; assertScope(this.options.scope, grant.scope);
    return ["fiscal_read", "fiscal_write", "contact_write", "order_write"].every(value => grant.permissions.includes(value as typeof grant.permissions[number]));
  }
  private async rpc(path: string, call: string, param: Record<string, unknown>, absentReference?: string): Promise<Record<string, unknown>> {
    const response = await this.http.request(path, { method: "POST", body: JSON.stringify({ call, param: [param] }) });
    if (response.status === 500 && absentReference && path === paths.orders && call === "ConsultarPedido"
      && Object.keys(param).length === 1 && param.codigo_pedido_integracao === absentReference) {
      const fault = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (fault?.faultcode === "SOAP-ENV:Client-103" && fault.faultstring === `ERROR: Pedido não cadastrado para o Código de Integração [${absentReference}] !`)
        throw new Error("fiscal_provider_order_reference_absent");
    }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "fiscal_reauthorization_required" : "fiscal_provider_query_failed");
    const data = await response.json() as Record<string, unknown>;
    if (!data || data.faultcode || data.faultstring) throw new Error("fiscal_provider_query_failed"); return data;
  }
  private body(call: string, param: Record<string, unknown>) { return { call, param: [param] }; }
  private async orderId(identity: FiscalIdentity, initialDiscovery = false) {
    const stage = await this.http.journal.read(identity, "order.create");
    if (stage) assertFiscalIdentity(identity, stage.identity);
    if (stage?.remoteId) return remoteId(stage.remoteId);
    let data: Record<string, unknown>;
    try { data = await this.rpc(paths.orders, "ConsultarPedido", { codigo_pedido_integracao: identity.reference }, initialDiscovery && (!stage || stage.outcome === "not_accepted") ? identity.reference : undefined); }
    catch (error) { if (error instanceof Error && error.message === "fiscal_provider_order_reference_absent") return null; throw error; }
    const head = (data.pedido_venda_produto as { cabecalho?: Record<string, unknown> } | undefined)?.cabecalho;
    if (head?.codigo_pedido_integracao !== identity.reference) throw new Error("fiscal_identity_mismatch"); return remoteId(head.codigo_pedido);
  }
  private async remoteOrder(identity: FiscalIdentity, id: string) {
    const expected = this.sale(identity);
    const value = await this.rpc(paths.orders, "ConsultarPedido", { codigo_pedido: Number(remoteId(id)) });
    const data = value.pedido_venda_produto as Record<string, unknown> | undefined; const head = data?.cabecalho as Record<string, unknown> | undefined;
    if (!data || String(head?.codigo_pedido) !== id || head?.codigo_pedido_integracao !== identity.reference) throw new Error("fiscal_identity_mismatch");
    const clientId = remoteId(head.codigo_cliente);
    if (!/^[1-9]\d*$/.test(clientId) || !Number.isSafeInteger(Number(clientId))) throw new Error("fiscal_identity_mismatch");
    const client = await this.rpc(paths.clients, "ConsultarCliente", { codigo_cliente_omie: Number(clientId) });
    if (remoteId(client.codigo_cliente_omie) !== clientId) throw new Error("fiscal_identity_mismatch");
    if (customerFingerprint(client) !== customerFingerprint(expected.contact)) throw new Error("fiscal_contact_content_mismatch");
    const request = { ...expected.order, cabecalho: { ...expected.order.cabecalho as object, codigo_cliente: Number(clientId) } };
    const receipt = await this.http.journal.read(identity, "order.create");
    if (receipt) assertFiscalIdentity(identity, receipt.identity);
    const trustDefaults = receipt?.outcome === "accepted" && receipt.remoteId === id && receipt.reference === identity.reference
      && receipt.relatedIds?.orderFingerprint === fiscalObjectFingerprint(request);
    // Omie documents these as request defaults for parcelas, not durable header fields.
    // https://app.omie.com.br/api/v1/produtos/pedido/ (cabecalho, informacoes_adicionais, parcela)
    const normalized = structuredClone(data); const normalizedHead = normalized.cabecalho as Record<string, unknown>;
    const expectedHead = expected.order.cabecalho as Record<string, unknown>;
    if (typeof normalizedHead.codigo_cenario_impostos === "string" && typeof expectedHead.codigo_cenario_impostos === "number"
      && Number.isSafeInteger(expectedHead.codigo_cenario_impostos) && expectedHead.codigo_cenario_impostos > 0
      && normalizedHead.codigo_cenario_impostos === String(expectedHead.codigo_cenario_impostos)) normalizedHead.codigo_cenario_impostos = expectedHead.codigo_cenario_impostos;
    for (const line of Array.isArray(normalized.det) ? normalized.det as { produto?: Record<string, unknown> }[] : []) {
      if (typeof line.produto?.ncm === "string" && /^\d{4}\.\d{2}\.\d{2}$/.test(line.produto.ncm)) line.produto.ncm = line.produto.ncm.replaceAll(".", "");
      if (typeof line.produto?.cfop === "string" && /^\d\.\d{3}$/.test(line.produto.cfop)) line.produto.cfop = line.produto.cfop.replace(".", "");
    }
    const freight = normalized.frete as Record<string, unknown> | undefined;
    if (freight && !Object.hasOwn(freight, "valor_frete") && (expected.order.frete as Record<string, unknown>)?.valor_frete === 0) freight.valor_frete = 0;
    const additional = normalized.informacoes_adicionais as Record<string, unknown> | undefined;
    const expectedAdditional = expected.order.informacoes_adicionais as Record<string, unknown>;
    if (trustDefaults) {
      if (!Object.hasOwn(normalizedHead, "nao_gerar_boleto") && expectedHead.nao_gerar_boleto === "S") normalizedHead.nao_gerar_boleto = "S";
      for (const key of ["meio_pagamento", "descr_meio_pagamento"]) if (additional && !Object.hasOwn(additional, key) && expectedAdditional[key] !== undefined) additional[key] = expectedAdditional[key];
    }
    const installments = normalized.lista_parcelas as { parcela?: Record<string, unknown>[] } | undefined;
    if (installments !== undefined && (!installments || !Array.isArray(installments.parcela))) throw new Error("fiscal_order_content_or_effects_mismatch");
    for (const installment of installments?.parcela ?? []) {
      if (!installment || typeof installment !== "object") throw new Error("fiscal_order_content_or_effects_mismatch");
      for (const [key, expectedValue] of Object.entries({ nao_gerar_boleto: expectedHead.nao_gerar_boleto, meio_pagamento: expectedAdditional.meio_pagamento, descr_meio_pagamento: expectedAdditional.descr_meio_pagamento, nsu: expectedAdditional.nsu }))
        if (Object.hasOwn(installment, key) && installment[key] !== expectedValue) throw new Error("fiscal_order_content_or_effects_mismatch");
    }
    if (!subset(expected.order, normalized)) throw new Error("fiscal_order_content_or_effects_mismatch");
    const total = (data.total_pedido as Record<string, unknown> | undefined)?.valor_total_pedido;
    if (total !== undefined && Math.round(Number(total) * 100) !== expected.totalCents) throw new Error("fiscal_order_content_mismatch");
    return normalized;
  }
  async ensureOrder(identity: FiscalIdentity, raw: Readonly<Record<string, unknown>>) {
    this.http.assert(identity); const expected = this.sale(identity); if (!await this.http.journal.check(identity)) return unknown();
    if (!await this.authorized()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_reauthorization_required" };
    if (raw.kind !== "omie_order_v1" || fiscalObjectFingerprint(raw) !== fiscalObjectFingerprint(expected)) throw new Error("fiscal_payload_configuration_required");
    const savedOrder = await this.http.journal.read(identity, "order.create");
    if (savedOrder) { assertFiscalIdentity(identity, savedOrder.identity); if (savedOrder.outcome === "accepted") return { outcome: "accepted" as const, value: { id: savedOrder.remoteId!, reference: identity.reference } }; if (savedOrder.outcome !== "not_accepted") return unknown(); }
    const old = await this.http.journal.read(identity, "contact.create"); if (old) assertFiscalIdentity(identity, old.identity);
    if (old && old.outcome !== "accepted" && old.outcome !== "not_accepted") return unknown();
    for (const product of expected.products) {
      const found = await this.rpc(paths.products, "ConsultarProduto", { codigo_produto: product.id });
      const ncm = typeof found.ncm === "string" && /^(?:\d{8}|\d{4}\.\d{2}\.\d{2})$/.test(found.ncm) ? found.ncm.replaceAll(".", "") : undefined;
      const origin = (found.recomendacoes_fiscais as { origem_mercadoria?: unknown } | undefined)?.origem_mercadoria;
      if (String(found.codigo_produto) !== String(product.id) || found.codigo !== product.sku || ncm !== product.ncm || found.unidade !== product.unit || origin !== product.origin || found.inativo !== "N") throw new Error("fiscal_product_configuration_mismatch");
    }
    const fingerprint = customerFingerprint(expected.contact); let clientId = old?.outcome === "accepted" ? old.remoteId : undefined;
    if (!clientId) {
      const listed = await this.rpc(paths.clients, "ListarClientes", { pagina: 1, registros_por_pagina: 100, clientesFiltro: { cnpj_cpf: expected.contact.cnpj_cpf } });
      if (!Array.isArray(listed.clientes_cadastro) || Number(listed.total_de_paginas) > 1 || listed.clientes_cadastro.length > 1) return { outcome: "not_accepted" as const, reasonCode: "fiscal_contact_reuse_requires_review" };
      if (listed.clientes_cadastro.length) {
        const candidate = listed.clientes_cadastro[0] as Record<string, unknown>; if (customerFingerprint(candidate) !== fingerprint) return { outcome: "not_accepted" as const, reasonCode: "fiscal_contact_reuse_requires_review" };
        clientId = remoteId(candidate.codigo_cliente_omie);
        if (!await this.http.recover(identity, "contact.create", identity.reference + ":contact", clientId, { source: "tax_id_match", recipientFingerprint: fingerprint })) return unknown();
      } else {
        const result = await this.http.write(identity, "contact.create", identity.reference + ":contact", paths.clients, this.body("IncluirCliente", expected.contact), record => ({ id: record.remoteId! }),
          value => { if (value.codigo_cliente_integracao !== identity.reference + ":contact" || String(value.codigo_status) !== "0") throw new Error("fiscal_provider_response_invalid"); return { remoteId: remoteId(value.codigo_cliente_omie) }; }, "POST", { source: "sale_reference", recipientFingerprint: fingerprint });
        if (result.outcome !== "accepted") return result; clientId = result.value.id;
      }
    }
    const requestedClientId = remoteId(clientId);
    if (!/^[1-9]\d*$/.test(requestedClientId) || !Number.isSafeInteger(Number(requestedClientId))) throw new Error("fiscal_identity_mismatch");
    const client = await this.rpc(paths.clients, "ConsultarCliente", { codigo_cliente_omie: Number(requestedClientId) });
    if (remoteId(client.codigo_cliente_omie) !== requestedClientId) throw new Error("fiscal_identity_mismatch");
    if (customerFingerprint(client) !== fingerprint) throw new Error("fiscal_contact_content_mismatch");
    let cursor = await this.http.journal.read(identity, "contact.create");
    if (!cursor || cursor.outcome !== "accepted") return unknown();
    let page = Number(cursor.relatedIds?.orderLookupPage ?? "1"); if (!Number.isSafeInteger(page) || page < 1) throw new Error("fiscal_discovery_cursor_invalid");
    let complete = cursor.relatedIds?.orderLookupComplete === "true";
    for (let budget = 0; !complete && budget < 10; budget++) {
      if (!await this.http.journal.check(identity)) return unknown();
      const orders = await this.rpc(paths.orders, "ListarPedidos", { pagina: page, registros_por_pagina: 100, filtrar_por_cliente: Number(clientId), apenas_resumo: "N" });
      const total = Number(orders.total_de_paginas);
      if (!Array.isArray(orders.pedido_venda_produto) || !Number.isSafeInteger(total) || total < 0 || Number(orders.pagina) !== page) throw new Error("fiscal_provider_response_invalid");
      const matching = (orders.pedido_venda_produto as { cabecalho?: Record<string, unknown> }[]).filter(order => order.cabecalho?.codigo_pedido_integracao === identity.reference);
      if (matching.length > 1) throw new Error("fiscal_provider_discovery_ambiguous");
      if (matching.length) {
        const id = remoteId(matching[0]!.cabecalho!.codigo_pedido); await this.remoteOrder(identity, id);
        if (!await this.http.recover(identity, "order.create", identity.reference, id)) return unknown(); return { outcome: "accepted" as const, value: { id, reference: identity.reference } };
      }
      complete = page >= total; page++;
      cursor = { ...cursor, relatedIds: { ...cursor.relatedIds, orderLookupPage: String(page), orderLookupComplete: String(complete) } };
      if (!await this.http.journal.finish(cursor)) return unknown();
    }
    if (!complete) return { outcome: "not_accepted" as const, reasonCode: "fiscal_order_discovery_in_progress", retryAfterMs: 1000 };
    const head = expected.order.cabecalho as Record<string, unknown>;
    const request = { ...expected.order, cabecalho: { ...head, codigo_cliente: Number(clientId) } };
    return this.http.write(identity, "order.create", identity.reference, paths.orders, this.body("IncluirPedido", request),
      record => ({ id: record.remoteId!, reference: identity.reference }), value => {
        if (value.codigo_pedido_integracao !== identity.reference || String(value.codigo_status) !== "0") throw new Error("fiscal_provider_response_invalid"); return { remoteId: remoteId(value.codigo_pedido) };
      }, "POST", { stockSuppressed: expected.stockOwner === "zyon" ? "true" : "false", financialSuppressed: "true", profileVersionId: expected.profileVersionId, orderFingerprint: fiscalObjectFingerprint(request) });
  }
  async generate(identity: FiscalIdentity, order: FiscalRemoteOrder) {
    this.http.assert(identity); const expected = this.sale(identity); if (order.reference !== identity.reference) throw new Error("fiscal_identity_mismatch"); if (!await this.http.journal.check(identity)) return unknown();
    const fingerprint = fiscalObjectFingerprint(expected.order); const saved = await this.http.journal.read(identity, "invoice.validate");
    if (saved?.outcome === "accepted") {
      assertFiscalIdentity(identity, saved.identity); if (saved.remoteId !== order.id || saved.relatedIds?.orderFingerprint !== fingerprint) throw new Error("fiscal_stage_content_immutable");
      return { outcome: "accepted" as const, value: { remoteOrderId: order.id } };
    }
    await this.remoteOrder(identity, remoteId(order.id));
    const validation = await this.rpc(paths.billing, "ValidarPedidoVenda", { nCodPed: Number(order.id), cCodIntPed: identity.reference });
    if (String(validation.nCodPed) !== order.id || validation.cCodIntPed !== identity.reference || String(validation.cCodStatus) !== "0") return { outcome: "not_accepted" as const, reasonCode: "fiscal_order_validation_failed" };
    if (!await this.http.recover(identity, "invoice.validate", identity.reference, order.id, { order: order.id, orderFingerprint: fingerprint, profileVersionId: expected.profileVersionId })) return unknown();
    return { outcome: "accepted" as const, value: { remoteOrderId: order.id } };
  }
  async submit(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["submit"]>[1]) {
    this.http.assert(identity); const expected = this.sale(identity); if (!await this.http.journal.check(identity)) return unknown(); if (!await this.authorized()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_reauthorization_required" };
    const id = remoteId(input.remoteOrderId); const validated = await this.http.journal.read(identity, "invoice.validate");
    if (!validated || validated.outcome !== "accepted" || validated.remoteId !== id) throw new Error("fiscal_order_validation_required"); assertFiscalIdentity(identity, validated.identity);
    if (input.sendEmail && this.policy.emailOwner !== "provider" || input.sendEmail !== expected.sendEmail) throw new Error("fiscal_email_ownership_mismatch");
    const write = () => this.http.write(identity, "invoice.submit", identity.reference, paths.billing, this.body("FaturarPedidoVenda", { nCodPed: Number(id), cCodIntPed: identity.reference }),
      () => ({ identity, remoteOrderId: id, status: "processing" as const, providerStatus: "faturamento_solicitado", verifiedBy: "request_response" as const }), value => {
        if (String(value.nCodPed) !== id || value.cCodIntPed !== identity.reference || String(value.cCodStatus) !== "0") throw new Error("fiscal_provider_response_invalid"); return { remoteId: id, relatedIds: { order: id } };
      }, "POST", { emailOwner: this.policy.emailOwner, sendEmail: String(input.sendEmail), orderFingerprint: fiscalObjectFingerprint(expected.order),
        buyerEmailHash: fiscalObjectFingerprint((expected.order.informacoes_adicionais as Record<string, unknown>).utilizar_emails ?? "") });
    const previous = await this.http.journal.read(identity, "invoice.submit");
    if (previous && previous.outcome !== "not_accepted") return write();
    await this.remoteOrder(identity, id);
    return write();
  }
  private async artifactUrl(url: string, kind: "xml" | "danfe") {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(this.options.artifactOrigins ?? ["https://app.omie.com.br"]).includes(parsed.origin)) throw new Error("fiscal_artifact_origin_invalid");
    safeArtifactUrl(parsed.origin, url);
    return new FiscalHttpTransport(this.options, parsed.origin, "none").artifact(url, kind);
  }
  private async queried(identity: FiscalIdentity, expectedInvoiceId?: string, initialDiscovery = false) {
    this.http.assert(identity); const expected = this.sale(identity); const orderId = await this.orderId(identity, initialDiscovery && !expectedInvoiceId);
    if (!orderId) return null;
    const status = await this.rpc(paths.orders, "StatusPedido", { codigo_pedido: Number(orderId), codigo_pedido_integracao: identity.reference });
    if (String(status.codigo_pedido) !== orderId || status.codigo_pedido_integracao !== identity.reference) throw new Error("fiscal_identity_mismatch");
    if (!Array.isArray(status.ListaNfe) || !status.ListaNfe.length) return null; if (status.ListaNfe.length !== 1) throw new Error("fiscal_provider_discovery_ambiguous");
    const note = status.ListaNfe[0] as Record<string, unknown>; const key = note.chave_nfe;
    if (!isFiscalAccessKey(key) || key.slice(20, 22) !== "55") throw new Error("fiscal_authorization_evidence_invalid");
    const nf = await this.rpc(paths.consult, "ConsultarNF", { cChaveNFe: key, nIdPedido: Number(orderId), tpAmb: identity.environment === "production" ? "1" : "2", cDetalhesPedido: "S" });
    const compl = nf.compl as Record<string, unknown> | undefined; const ide = nf.ide as Record<string, unknown> | undefined; const issuer = nf.nfEmitInt as Record<string, unknown> | undefined;
    const id = remoteId(compl?.nIdNF);
    if (String(compl?.nIdPedido) !== orderId || compl?.cChaveNFe !== key || expectedInvoiceId && expectedInvoiceId !== id || this.options.companyId && String(issuer?.nCodEmp) !== this.options.companyId) throw new Error("fiscal_identity_mismatch");
    if (ide?.mod !== "55" || ide.tpAmb !== (identity.environment === "production" ? "1" : "2")) throw new Error("fiscal_environment_mismatch");
    const fiscal = await this.rpc(paths.notes, "NotaFiscalStatus", { codigo_nf: Number(id) });
    const integration = fiscal.integracao as Record<string, unknown> | undefined; const lot = fiscal.dados_lote as Record<string, unknown> | undefined; const info = fiscal.dados_nota_fiscal as Record<string, unknown> | undefined;
    if (String(integration?.codigo_nf) !== id || this.options.companyId && String(integration?.codigo_empresa) !== this.options.companyId || info?.chave_nfe !== key) throw new Error("fiscal_identity_mismatch");
    if (lot?.ambiente !== (identity.environment === "production" ? "P" : "H")) throw new Error("fiscal_environment_mismatch");
    const base = { identity, remoteInvoiceId: id, remoteOrderId: orderId, providerStatus: String(info.status_sefaz ?? "processing"), verifiedBy: "authenticated_query" as const };
    let artifact: { bytes: Uint8Array; mimeType: string } | undefined;
    if (typeof note.xml_distr === "string" && note.xml_distr.trimStart().startsWith("<")) artifact = { bytes: new TextEncoder().encode(note.xml_distr), mimeType: "application/xml" };
    const cancelled = (fiscal.dados_cancelamento as Record<string, unknown> | undefined)?.nfCanc === "S";
    if (cancelled) {
      if (!artifact) return { document: { ...base, status: "processing" } as FiscalProviderDocument };
      return { document: { ...base, status: "cancelled", cancellation: cancelledNfeEvent(artifact.bytes, identity, key) } as FiscalProviderDocument };
    }
    if (info.faturada !== "S") return { document: (/^\d{3}$/.test(String(info.status_sefaz)) && !["100", "150"].includes(String(info.status_sefaz))
      ? { ...base, status: "rejected", reasonCode: "sefaz_" + info.status_sefaz } : { ...base, status: "processing" }) as FiscalProviderDocument };
    if (!artifact) {
      const document = await this.rpc(paths.dfe, "ObterNfe", { nIdNfe: Number(id) });
      if (document.nChaveNfe !== key || typeof document.cXmlNfe !== "string" || String(document.cCodStatus) !== "0") throw new Error("fiscal_artifact_unavailable");
      artifact = { bytes: new TextEncoder().encode(document.cXmlNfe), mimeType: "application/xml" };
    }
    const authorization = authorizedNfe(safeXml(artifact.bytes), identity, key);
    //17digit JSON integers cannot be represented exactly; the authenticated XML string is authoritative.
    if ((typeof info.protocolo === "string" || typeof info.protocolo === "number" && Number.isSafeInteger(info.protocolo)) && String(info.protocolo) !== authorization.protocol
      || Math.round(Number((nf.total as { ICMSTot?: { vNF?: number } } | undefined)?.ICMSTot?.vNF) * 100) !== expected.totalCents) throw new Error("fiscal_authorization_evidence_invalid");
    return { document: { ...base, status: "authorized", authorization } as FiscalProviderDocument, artifact };
  }
  async query(identity: FiscalIdentity, id?: string): Promise<FiscalQueryResult> { const result = await this.queried(identity, id); return result ? { found: true, document: result.document } : { found: false }; }
  async findByReference(identity: FiscalIdentity): Promise<FiscalQueryResult> { const result = await this.queried(identity, undefined, true); return result ? { found: true, document: result.document } : { found: false }; }
  async download(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["download"]>[1]) {
    const result = await this.queried(identity, remoteId(input.remoteInvoiceId)); if (!result) throw new Error("fiscal_artifact_not_authorized");
    let artifact = result.document.status === "authorized" ? result.artifact : undefined;
    const original = result.document.status === "authorized" ? result.document.authorization : input.authorization;
    if (!original) throw new Error("fiscal_artifact_not_authorized");
    if (input.authorization && result.document.status === "authorized") assertOriginalFiscalAuthorization(input.authorization, result.document.authorization);
    if (!artifact) {
      const data = await this.rpc(paths.dfe, "ObterNfe", { nIdNfe: Number(input.remoteInvoiceId) });
      if (data.nChaveNfe !== original.accessKey || typeof data.cXmlNfe !== "string" || String(data.cCodStatus) !== "0") throw new Error("fiscal_artifact_unavailable");
      artifact = { bytes: new TextEncoder().encode(data.cXmlNfe), mimeType: "application/xml" };
      assertOriginalFiscalAuthorization(original, authorizedNfe(safeXml(artifact.bytes), identity, original.accessKey));
    }
    if (input.kind === "xml") return artifact!;
    const data = await this.rpc(paths.documents, "GetUrlDanfe", { nCodNF: Number(input.remoteInvoiceId) }); if (typeof data.cUrlDanfe !== "string") throw new Error("fiscal_artifact_unavailable"); return this.artifactUrl(data.cUrlDanfe, "danfe");
  }
  async requestCancellation(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["requestCancellation"]>[1]) {
    this.http.assert(identity); this.sale(identity); if (input.restoreStock !== false || input.reverseAccounts !== false || input.cancelSale !== false) throw new Error("fiscal_cancellation_effects_forbidden");
    if (this.policy.stockOwner !== "zyon") return { outcome: "not_accepted" as const, reasonCode: "fiscal_cancellation_effect_control_unverified" };
    if (input.justification.trim().length < 15 || input.justification.length > 255) throw new Error("fiscal_cancellation_justification_invalid");
    if (!await this.http.journal.check(identity)) return unknown(); if (!await this.authorized()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_reauthorization_required" };
    const orderId = await this.orderId(identity); if (!orderId) throw new Error("fiscal_provider_query_failed"); const original = await this.remoteOrder(identity, orderId);
    if ((original.cabecalho as Record<string, unknown>).nao_gerar_boleto !== "S" || !(original.det as { inf_adic?: Record<string, unknown> }[]).every(line => line.inf_adic?.nao_movimentar_estoque === "S" && line.inf_adic.nao_gerar_financeiro === "S")) return { outcome: "not_accepted" as const, reasonCode: "fiscal_cancellation_effect_control_unverified" };
    const note = await this.query(identity, input.remoteInvoiceId); if (!note.found || note.document.status !== "authorized") return { outcome: "not_accepted" as const, reasonCode: "fiscal_document_not_authorized" };
    return this.http.write(identity, "invoice.cancel", identity.reference, paths.notes, this.body("NotaFiscalCancelar", { codigo_nf: Number(remoteId(input.remoteInvoiceId)), dtCanc: omieDate(input.requestedAt, this.payload.timeZone), xJust: input.justification }),
      () => ({ identity, remoteInvoiceId: input.remoteInvoiceId, remoteOrderId: orderId, status: "processing" as const, providerStatus: "cancelamento_solicitado", verifiedBy: "request_response" as const }), value => { if (String(value.codigo_nf) !== input.remoteInvoiceId || String(value.codigo_status) !== "0") throw new Error("fiscal_provider_response_invalid"); return { remoteId: input.remoteInvoiceId }; });
  }
  async reconcileStage(identity: FiscalIdentity, record: FiscalProviderStageRecord): Promise<FiscalStageQueryResult> {
    this.http.assert(identity); assertFiscalIdentity(identity, record.identity);
    if (record.stage === "contact.create") {
      if (record.reference !== identity.reference + ":contact") throw new Error("fiscal_stage_identity_mismatch");
      const data = await this.rpc(paths.clients, "ConsultarCliente", record.remoteId ? { codigo_cliente_omie: Number(record.remoteId) } : { codigo_cliente_integracao: record.reference });
      if (!record.remoteId && data.codigo_cliente_integracao !== record.reference || customerFingerprint(data) !== customerFingerprint(this.payload.contact)) return { found: false };
      return { found: true, remoteId: remoteId(data.codigo_cliente_omie) };
    }
    if (record.reference !== identity.reference) throw new Error("fiscal_stage_identity_mismatch"); const id = await this.orderId(identity); if (!id) throw new Error("fiscal_provider_query_failed");
    if (record.stage === "order.create") { await this.remoteOrder(identity, id); return { found: true, remoteId: id }; }
    if (record.stage === "invoice.validate") {
      if (!await this.http.journal.check(identity)) return { found: false }; const data = await this.rpc(paths.billing, "ValidarPedidoVenda", { nCodPed: Number(id), cCodIntPed: identity.reference });
      return String(data.nCodPed) === id && data.cCodIntPed === identity.reference && String(data.cCodStatus) === "0" ? { found: true, remoteId: id } : { found: false };
    }
    const result = await this.query(identity, record.stage === "invoice.cancel" ? record.remoteId : undefined);
    if (!result.found || record.stage === "invoice.cancel" && result.document.status !== "cancelled") return { found: false };
    return record.stage === "invoice.submit" ? { found: true, remoteId: id, relatedIds: { invoice: result.document.remoteInvoiceId, order: id } } : { found: true, remoteId: result.document.remoteInvoiceId };
  }
  async inspectConnection(scope: FiscalScope): Promise<readonly FiscalReadinessCheck[]> {
    assertScope(this.options.scope, scope); const checks: FiscalReadinessCheck[] = [];
    if (this.options.companyId) {
      try { const data = await this.rpc(paths.companies, "ConsultarEmpresa", { codigo_empresa: Number(remoteId(this.options.companyId)) });
        checks.push({ code: "issuer", status: String(data.codigo_empresa) === this.options.companyId && String(data.cnpj).replace(/[^A-Za-z0-9]/g, "").toUpperCase() === scope.issuerTaxId ? "verified" : "pending", evidenceReference: "omie:company:authenticated" }); }
      catch { checks.push({ code: "issuer", status: "pending" }); }
    } else checks.push({ code: "issuer", status: "pending" });
    const evidence = await this.options.accountEvidence?.read(scope);
    const bound = this.options.policy && validErpAccountEvidenceBinding(evidence ?? null, scope, this.options.policy);
    if (evidence) assertScope(scope, evidence.scope);
    checks.push({ code: "certificate", status: bound && Date.parse(evidence!.certificateValidUntil) > Date.now() ? "verified" : "pending", evidenceReference: bound ? "responsible_confirmation:" + evidence!.confirmedAt : undefined },
      { code: "environment", status: bound ? "verified" : "pending", evidenceReference: bound ? "responsible_confirmation:" + evidence!.confirmedAt : undefined },
      { code: "effect_ownership", status: this.options.expectedPayload && this.options.policy && this.options.expectedPayload.stockOwner === this.options.policy.stockOwner ? "verified" : "pending", evidenceReference: "omie:documented_item_flags" });
    const grant = await this.options.authorization.read(scope); if (grant) assertScope(scope, grant.scope);
    checks.push({ code: "fiscal_permission", status: grant?.permissions.includes("fiscal_read") && grant.permissions.includes("fiscal_write") ? "verified" : "pending", evidenceReference: grant?.evidenceReference }); return checks;
  }
}
