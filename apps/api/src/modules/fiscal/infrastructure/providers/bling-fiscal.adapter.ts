import { assertFiscalIdentity, fiscalProviderCapabilities, type FiscalIdentity, type FiscalProviderDocument, type FiscalProviderPort, type FiscalQueryResult, type FiscalReadinessCheck, type FiscalRemoteOrder, type FiscalScope } from "../../domain/fiscal-provider.js";
import { validErpAccountEvidence, type FiscalCredentialAuthorizationPort, type FiscalErpAccountEvidencePort, type FiscalErpEffectPolicy } from "../../domain/fiscal-erp-account-evidence.port.js";
import type { FiscalProviderStageRecord, FiscalStageQueryResult, FiscalStageReconciliationPort } from "../../domain/fiscal-provider-stage.port.js";
import { assertScope, FiscalHttpTransport, remoteId, type FiscalHttpOptions } from "./provider-http.transport.js";
import { assertOriginalFiscalAuthorization, authorizedNfe, decodeBlingDocument, safeXml } from "./provider-xml-evidence.js";
import type { BlingFiscalPayload } from "./bling-fiscal.payload.js";
import { createHash } from "node:crypto";
import { isFiscalAccessKey } from "../../domain/fiscal-access-key.js";
interface BlingOptions extends FiscalHttpOptions {
  policy: FiscalErpEffectPolicy; accountEvidence: FiscalErpAccountEvidencePort; authorization: FiscalCredentialAuthorizationPort;
}
const unknown = () => ({ outcome: "unknown" as const, reasonCode: "fiscal_write_outcome_unknown" });
function contactFingerprint(contact: Record<string, unknown>) {
  const a = (contact.endereco as { geral?: Record<string, unknown> } | undefined)?.geral ?? {};
  const text = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().replace(/\s+/g, " ");
  return createHash("sha256").update(JSON.stringify([text(contact.numeroDocumento).replace(/[^A-Za-z0-9]/g, "").toUpperCase(), text(contact.nome),
    text(contact.tipo), text(contact.situacao), text(contact.indicadorIe),
    ...["endereco", "numero", "complemento", "bairro", "municipio", "uf"].map(key => text(a[key])), text(a.cep).replace(/\D/g, "")])).digest("hex");
}
export class BlingFiscalAdapter implements FiscalProviderPort, FiscalStageReconciliationPort {
  readonly provider = "bling" as const; readonly capabilities = fiscalProviderCapabilities(this.provider); private readonly http: FiscalHttpTransport;
  constructor(private readonly options: BlingOptions) { if (options.scope.provider !== "bling") throw new Error("fiscal_provider_mismatch"); this.http = new FiscalHttpTransport(options, "https://api.bling.com.br/Api/v3", "bearer"); }
  private async policyReady() {
    const evidence = await this.options.accountEvidence.read(this.options.scope); const auth = await this.options.authorization.read(this.options.scope);
    if (auth) assertScope(this.options.scope, auth.scope);
    return validErpAccountEvidence(evidence, this.options.scope, this.options.policy) && auth?.permissions.length
      && ["fiscal_read", "fiscal_write", "order_write", "contact_write"].every(permission => auth.permissions.includes(permission as typeof auth.permissions[number]));
  }
  private async list(path: string): Promise<Record<string, unknown>[]> {
    const data = await this.http.json(path); if (!data || !Array.isArray(data.data)) throw new Error("fiscal_provider_response_invalid");
    if (data.data.length >= 100) throw new Error("fiscal_provider_discovery_ambiguous"); return data.data as Record<string, unknown>[];
  }
  private async orderByReference(identity: FiscalIdentity) {
    const orders = await this.list("/pedidos/vendas?" + new URLSearchParams({ "numerosLojas[]": identity.reference, limite: "100", pagina: "1" }));
    if (orders.length > 1) throw new Error("fiscal_provider_discovery_ambiguous"); if (!orders.length) return null;
    const data = (await this.http.json("/pedidos/vendas/" + remoteId(orders[0]!.id)))?.data as Record<string, unknown> | undefined;
    if (!data || data.numeroLoja !== identity.reference) throw new Error("fiscal_identity_mismatch"); return data;
  }
  private async contactByReference(reference: string) {
    const contacts = await this.list("/contatos?" + new URLSearchParams({ pesquisa: reference, criterio: "1", limite: "100", pagina: "1" }));
    const matches = contacts.filter(value => value.codigo === reference);
    if (matches.length > 1) throw new Error("fiscal_provider_discovery_ambiguous"); return matches[0] ?? null;
  }
  async ensureOrder(identity: FiscalIdentity, raw: Readonly<Record<string, unknown>>) {
    this.http.assert(identity); if (!await this.http.journal.check(identity)) return unknown();
    if (!await this.policyReady()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_account_policy_unverified" };
    const payload = raw as BlingFiscalPayload;
    if (payload.kind !== "bling_order_v1" || payload.reference !== identity.reference || payload.profileVersionId !== this.options.policy.profileVersionId || payload.emailOwner !== this.options.policy.emailOwner) throw new Error("fiscal_payload_configuration_required");
    if (payload.payment) {
      const payment = payload.payment; const data = (await this.http.json("/formas-pagamentos/" + remoteId(payment.id)))?.data as Record<string, unknown> | undefined;
      const card = data?.dadosCartao as Record<string, unknown> | undefined;
      const parts = payload.order.parcelas as { valor?: number; caut?: string; formaPagamento?: { id?: number } }[] | undefined;
      if (!data || String(data.id) !== String(payment.id) || data.situacao !== 1 || Number(data.tipoPagamento) !== Number(payment.code) || ![2, 3].includes(Number(data.finalidade))
        || ["03", "04", "17", "20"].includes(payment.code) && !payment.caut
        || !parts || parts.length !== 1 || Math.round(Number(parts[0]?.valor) * 100) !== payload.totalCents || parts[0]?.caut !== payment.caut || parts[0]?.formaPagamento?.id !== payment.id
        || ["03", "04"].includes(payment.code) && (!card || card.tipo !== 1 || card.autoLiquidacao !== 0 || card.cnpjCredenciadora !== payment.acquirerTaxId || Number(card.bandeira) !== Number(payment.brandCode))) throw new Error("fiscal_payment_mapping_mismatch");
    }
    const orderStage = await this.http.journal.read(identity, "order.create");
    if (orderStage) { assertFiscalIdentity(identity, orderStage.identity); if (orderStage.outcome === "accepted") return { outcome: "accepted" as const, value: { id: orderStage.remoteId!, reference: identity.reference, ...(orderStage.relatedIds?.invoice ? { invoiceId: orderStage.relatedIds.invoice } : {}) } }; if (orderStage.outcome !== "not_accepted") return unknown(); }
    const existing = await this.orderByReference(identity);
    if (existing) {
      if (Math.round(Number(existing.total) * 100) !== payload.totalCents || (existing.contato as Record<string, unknown> | undefined)?.numeroDocumento !== payload.recipientTaxId) throw new Error("fiscal_order_content_mismatch");
      const id = remoteId(existing.id); const invoice = (existing.notaFiscal as Record<string, unknown> | undefined)?.id;
      const related = invoice ? { invoice: remoteId(invoice) } : undefined;
      if (!await this.http.recover(identity, "order.create", identity.reference, id, related)) return unknown();
      return { outcome: "accepted" as const, value: { id, reference: identity.reference, ...(related ? { invoiceId: related.invoice } : {}) } };
    }
    for (const product of payload.products) {
      const data = (await this.http.json("/produtos/" + remoteId(product.id)))?.data as Record<string, unknown> | undefined;
      const tax = data?.tributacao as Record<string, unknown> | undefined;
      if (!data || String(data.id) !== String(product.id) || data.codigo !== product.sku || data.tipo !== "P" || data.situacao !== "A" || data.unidade !== product.unit
        || tax?.ncm !== product.ncm || String(tax?.origem) !== product.origin) throw new Error("fiscal_product_configuration_mismatch");
      if (!await this.http.journal.check(identity)) return unknown();
      const calculated = await this.http.request("/naturezas-operacoes/" + remoteId(product.natureId) + "/obter-tributacao", { method: "POST", body: JSON.stringify(product.taxQuery) });
      if (!calculated.ok) throw new Error("fiscal_tax_configuration_unavailable");
      const rules = (await calculated.json() as { data?: Record<string, unknown> }).data;
      for (const [path, expected] of Object.entries(product.expectedTax)) {
        let actual: unknown = rules; for (const key of path.split(".")) actual = actual && typeof actual === "object" ? (actual as Record<string, unknown>)[key] : undefined;
        if (actual !== expected) throw new Error("fiscal_tax_configuration_mismatch");
      }
    }
    const contactReference = identity.reference + ":contact";
    const fingerprint = contactFingerprint(payload.contact);
    const buyerEmailHash = createHash("sha256").update(String(payload.contact.emailNotaFiscal ?? "").trim().toLowerCase()).digest("hex");
    const priorContact = await this.http.journal.read(identity, "contact.create");
    if (priorContact) assertFiscalIdentity(identity, priorContact.identity);
    if (priorContact && priorContact.outcome !== "accepted" && priorContact.outcome !== "not_accepted") return unknown();
    let contactId = priorContact?.outcome === "accepted" ? priorContact.remoteId : undefined;
    if (!contactId) {
      const contact = await this.contactByReference(contactReference);
      if (contact) {
        contactId = remoteId(contact.id); if (!await this.http.recover(identity, "contact.create", contactReference, contactId, { source: "sale_reference", recipientFingerprint: fingerprint })) return unknown();
      } else {
        const candidates = await this.list("/contatos?" + new URLSearchParams({ numeroDocumento: payload.recipientTaxId, criterio: "1", limite: "100", pagina: "1" }));
        if (candidates.length > 1) return { outcome: "not_accepted" as const, reasonCode: "fiscal_contact_reuse_requires_review" };
        if (candidates.length) {
          const candidateId = remoteId(candidates[0]!.id); const data = (await this.http.json("/contatos/" + candidateId))?.data as Record<string, unknown> | undefined;
          if (!data || contactFingerprint(data) !== fingerprint) return { outcome: "not_accepted" as const, reasonCode: "fiscal_contact_reuse_requires_review" };
          contactId = candidateId;
          if (!await this.http.recover(identity, "contact.create", contactReference, contactId, { source: "tax_id_match", recipientFingerprint: fingerprint })) return unknown();
        } else {
          const result = await this.http.write(identity, "contact.create", contactReference, "/contatos", payload.contact,
            record => ({ id: record.remoteId! }), value => ({ remoteId: remoteId((value.data as Record<string, unknown>)?.id) }), "POST", { source: "sale_reference", recipientFingerprint: fingerprint, buyerEmailHash, emailOwner: this.options.policy.emailOwner });
          if (result.outcome !== "accepted") return result; contactId = result.value.id;
        }
      }
    }
    const contact = (await this.http.json("/contatos/" + remoteId(contactId)))?.data as Record<string, unknown> | undefined;
    const acceptedContact = await this.http.journal.read(identity, "contact.create");
    if (!contact || acceptedContact?.relatedIds?.source !== "tax_id_match" && contact.codigo !== contactReference || contactFingerprint(contact) !== fingerprint) throw new Error("fiscal_contact_content_mismatch");
    if (!await this.http.recover(identity, "contact.create", contactReference, remoteId(contactId), { buyerEmailHash, emailOwner: this.options.policy.emailOwner })) return unknown();
    return this.http.write(identity, "order.create", identity.reference, "/pedidos/vendas", { ...payload.order, contato: { id: Number(remoteId(contactId)) } },
      record => ({ id: record.remoteId!, reference: identity.reference }), value => ({ remoteId: remoteId((value.data as Record<string, unknown>)?.id) }));
  }
  async generate(identity: FiscalIdentity, order: FiscalRemoteOrder) {
    this.http.assert(identity); if (order.reference !== identity.reference) throw new Error("fiscal_identity_mismatch");
    if (!await this.http.journal.check(identity)) return unknown(); if (!await this.policyReady()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_account_policy_unverified" };
    const persisted = await this.http.journal.read(identity, "order.create");
    if (persisted) assertFiscalIdentity(identity, persisted.identity);
    if (persisted?.outcome !== "accepted" || persisted.remoteId !== order.id) throw new Error("fiscal_order_stage_required");
    if (order.invoiceId) {
      if (!await this.http.recover(identity, "invoice.generate", identity.reference, remoteId(order.invoiceId), { order: order.id })) return unknown();
      return { outcome: "accepted" as const, value: { remoteInvoiceId: order.invoiceId } };
    }
    return this.http.write(identity, "invoice.generate", identity.reference, "/pedidos/vendas/" + remoteId(order.id) + "/gerar-nfe", {},
      record => ({ remoteInvoiceId: record.remoteId! }), value => ({ remoteId: remoteId(value.idNotaFiscal), relatedIds: { order: order.id } }));
  }
  async submit(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["submit"]>[1]) {
    this.http.assert(identity); if (!await this.http.journal.check(identity)) return unknown(); if (!await this.policyReady()) return { outcome: "not_accepted" as const, reasonCode: "fiscal_account_policy_unverified" };
    const id = remoteId(input.remoteInvoiceId); const generated = await this.http.journal.read(identity, "invoice.generate");
    if (generated) assertFiscalIdentity(identity, generated.identity);
    if (generated?.outcome !== "accepted" || generated.remoteId !== id) throw new Error("fiscal_invoice_stage_required");
    if (input.sendEmail && this.options.policy.emailOwner !== "provider") throw new Error("fiscal_email_ownership_mismatch");
    const contactStage = await this.http.journal.read(identity, "contact.create"); if (contactStage) assertFiscalIdentity(identity, contactStage.identity);
    const buyerEmailHash = contactStage?.relatedIds?.buyerEmailHash ?? ""; let included = false;
    if (input.sendEmail && contactStage?.remoteId && buyerEmailHash && buyerEmailHash !== createHash("sha256").update("").digest("hex")) {
      const contact = (await this.http.json("/contatos/" + remoteId(contactStage.remoteId)))?.data as Record<string, unknown> | undefined;
      const email = String(contact?.emailNotaFiscal ?? "").trim().toLowerCase(); included = Boolean(email) && createHash("sha256").update(email).digest("hex") === buyerEmailHash;
    }
    return this.http.write(identity, "invoice.submit", identity.reference, "/nfe/" + id + "/enviar?enviarEmail=" + included, {},
      () => ({ identity, remoteInvoiceId: id, status: "processing" as const, providerStatus: "enviado", verifiedBy: "request_response" as const,
        ...(input.sendEmail ? { providerEmailRequest: { requested: true, included, ...(!included ? { reasonCode: "fiscal_provider_email_destination_mismatch" } : {}) } } : {}) }), () => ({ remoteId: id }), "POST",
      { emailOwner: this.options.policy.emailOwner, sendEmail: String(input.sendEmail), includedEmail: String(included), buyerEmailHash });
  }
  private async queried(identity: FiscalIdentity, id: string) {
    this.http.assert(identity); const raw = (await this.http.json("/nfe/" + remoteId(id)))?.data as Record<string, unknown> | undefined;
    if (!raw) return null; if (String(raw.id) !== id || raw.numeroPedidoLoja !== identity.reference) throw new Error("fiscal_identity_mismatch");
    const base = { identity, remoteInvoiceId: id, providerStatus: String(raw.situacao), verifiedBy: "authenticated_query" as const };
    if (raw.situacao === 5 || raw.situacao === 6) {
      const key = String(raw.chaveAcesso); if (!isFiscalAccessKey(key)) throw new Error("fiscal_authorization_evidence_invalid");
      const compressed = await this.http.json("/nfe/documento/" + key + "?formato=xml"); if (!compressed) throw new Error("fiscal_authorization_evidence_invalid");
      const artifact = decodeBlingDocument(compressed, "xml"); const authorization = authorizedNfe(safeXml(artifact.bytes), identity, key);
      return { document: { ...base, status: "authorized", authorization } as FiscalProviderDocument, artifact };
    }
    return { document: (raw.situacao === 4 || raw.situacao === 9 ? { ...base, status: "rejected", reasonCode: "bling_status_" + raw.situacao }
      : { ...base, status: "processing" }) as FiscalProviderDocument };
  }
  async query(identity: FiscalIdentity, remoteInvoiceId?: string): Promise<FiscalQueryResult> {
    if (!remoteInvoiceId) return this.findByReference(identity); const result = await this.queried(identity, remoteId(remoteInvoiceId));
    return result ? { found: true as const, document: result.document } : { found: false as const };
  }
  async findByReference(identity: FiscalIdentity): Promise<FiscalQueryResult> {
    this.http.assert(identity); let notes = await this.list("/nfe?" + new URLSearchParams({ numeroLoja: identity.reference, limite: "100", pagina: "1" }));
    if (!notes.length) notes = await this.list("/nfe?" + new URLSearchParams({ numeroLoja: identity.reference, situacao: "2", limite: "100", pagina: "1" }));
    if (notes.length > 1) throw new Error("fiscal_provider_discovery_ambiguous"); return notes.length ? this.query(identity, remoteId(notes[0]!.id)) : { found: false as const };
  }
  async download(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["download"]>[1]) {
    const result = await this.queried(identity, remoteId(input.remoteInvoiceId)); if (!result) throw new Error("fiscal_artifact_not_authorized");
    let artifact = result.document.status === "authorized" ? result.artifact : undefined;
    const original = result.document.status === "authorized" ? result.document.authorization : input.authorization;
    if (!original) throw new Error("fiscal_artifact_not_authorized");
    if (input.authorization && result.document.status === "authorized") assertOriginalFiscalAuthorization(input.authorization, result.document.authorization);
    if (!artifact) {
      const raw = (await this.http.json("/nfe/" + remoteId(input.remoteInvoiceId)))?.data as Record<string, unknown> | undefined;
      if (!raw || String(raw.id) !== input.remoteInvoiceId || raw.numeroPedidoLoja !== identity.reference || String(raw.chaveAcesso).replace(/^NFe/, "") !== original.accessKey) throw new Error("fiscal_identity_mismatch");
      const data = await this.http.json("/nfe/documento/" + original.accessKey + "?formato=xml"); if (!data) throw new Error("fiscal_artifact_unavailable");
      artifact = decodeBlingDocument(data, "xml"); assertOriginalFiscalAuthorization(original, authorizedNfe(safeXml(artifact.bytes), identity, original.accessKey));
    }
    if (input.kind === "xml") return artifact!;
    const data = await this.http.json("/nfe/documento/" + original.accessKey + "?formato=pdf"); if (!data) throw new Error("fiscal_artifact_unavailable"); return decodeBlingDocument(data, "danfe");
  }
  async requestCancellation(identity: FiscalIdentity, _input: Parameters<FiscalProviderPort["requestCancellation"]>[1]) { this.http.assert(identity); return { outcome: "not_accepted" as const, reasonCode: "fiscal_cancellation_requires_erp_panel" }; }
  async reconcileStage(identity: FiscalIdentity, record: FiscalProviderStageRecord): Promise<FiscalStageQueryResult> {
    this.http.assert(identity); assertFiscalIdentity(identity, record.identity);
    if (record.stage === "contact.create") {
      if (record.reference !== identity.reference + ":contact") throw new Error("fiscal_stage_identity_mismatch");
      if (record.remoteId && record.relatedIds?.source === "tax_id_match") {
        const data = (await this.http.json("/contatos/" + remoteId(record.remoteId)))?.data as Record<string, unknown> | undefined;
        if (!data || contactFingerprint(data) !== record.relatedIds.recipientFingerprint) return { found: false as const };
        return { found: true as const, remoteId: remoteId(data.id) };
      }
      const contact = await this.contactByReference(record.reference);
      if (contact && record.relatedIds?.recipientFingerprint) {
        const data = (await this.http.json("/contatos/" + remoteId(contact.id)))?.data as Record<string, unknown> | undefined;
        if (!data || contactFingerprint(data) !== record.relatedIds.recipientFingerprint) return { found: false as const };
      }
      return contact ? { found: true as const, remoteId: remoteId(contact.id) } : { found: false as const };
    }
    if (record.reference !== identity.reference) throw new Error("fiscal_stage_identity_mismatch");
    if (record.stage === "order.create" || record.stage === "invoice.generate") {
      const order = await this.orderByReference(identity); if (!order) return { found: false as const };
      const invoice = (order.notaFiscal as Record<string, unknown> | undefined)?.id;
      if (record.stage === "invoice.generate") return invoice ? { found: true as const, remoteId: remoteId(invoice), relatedIds: { order: remoteId(order.id) } } : { found: false as const };
      return { found: true as const, remoteId: remoteId(order.id), ...(invoice ? { relatedIds: { invoice: remoteId(invoice) } } : {}) };
    }
    if (record.stage === "invoice.submit") {
      const note = await this.query(identity, record.remoteId);
      return note.found && ["3", "4", "5", "6", "8", "9", "10"].includes(note.document.providerStatus)
        ? { found: true as const, remoteId: note.document.remoteInvoiceId } : { found: false as const };
    }
    throw new Error("fiscal_stage_unsupported");
  }
  async inspectConnection(scope: FiscalScope): Promise<readonly FiscalReadinessCheck[]> {
    assertScope(this.options.scope, scope); const checks: FiscalReadinessCheck[] = [];
    try { const data = (await this.http.json("/empresas/me/dados-basicos"))?.data as Record<string, unknown> | undefined;
      checks.push({ code: "issuer", status: String(data?.cnpj).replace(/[^A-Za-z0-9]/g, "").toUpperCase() === scope.issuerTaxId ? "verified" : "pending", evidenceReference: "bling:company:authenticated" }); }
    catch { checks.push({ code: "issuer", status: "pending" }); }
    const evidence = await this.options.accountEvidence.read(scope); const ready = validErpAccountEvidence(evidence, scope, this.options.policy);
    const reference = evidence ? "responsible_confirmation:" + evidence.policyVersion + ":" + evidence.confirmedAt : undefined;
    checks.push({ code: "effect_ownership", status: ready ? "verified" : "pending", evidenceReference: reference },
      { code: "environment", status: ready ? "verified" : "pending", evidenceReference: reference },
      { code: "certificate", status: ready && Date.parse(evidence!.certificateValidUntil) > Date.now() ? "verified" : "pending", evidenceReference: reference });
    const auth = await this.options.authorization.read(scope); if (auth) assertScope(scope, auth.scope);
    checks.push({ code: "fiscal_permission", status: auth?.permissions.includes("fiscal_read") && auth.permissions.includes("fiscal_write") ? "verified" : "pending", evidenceReference: auth?.evidenceReference });
    return checks;
  }
}
