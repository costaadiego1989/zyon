import { fiscalProviderCapabilities, type FiscalIdentity, type FiscalProviderDocument, type FiscalProviderPort, type FiscalReadinessCheck, type FiscalScope } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStageRecord, FiscalStageReconciliationPort } from "../../domain/fiscal-provider-stage.port.js";
import { assertScope, FiscalHttpTransport, remoteId, type FiscalHttpOptions } from "./provider-http.transport.js";
import { assertOriginalFiscalAuthorization, authorizedNfe, cancelledNfeEvent, safeXml } from "./provider-xml-evidence.js";
import { isFiscalAccessKey } from "../../domain/fiscal-access-key.js";
import { isFiscalProtocol } from "../../domain/fiscal-protocol.js";
import { createHash } from "node:crypto";

interface FocusOptions extends FiscalHttpOptions {
  companyId?: string; policy: { stockOwner: string; emailOwner: string; whatsappOwner: string };
}
export class FocusFiscalAdapter implements FiscalProviderPort, FiscalStageReconciliationPort {
  readonly provider = "focus" as const;
  readonly capabilities = fiscalProviderCapabilities(this.provider);
  private readonly http: FiscalHttpTransport;
  constructor(private readonly options: FocusOptions) {
    if (options.scope.provider !== "focus" || !["homologation", "production"].includes(options.scope.environment)) throw new Error("fiscal_environment_required");
    this.http = new FiscalHttpTransport(options, options.scope.environment === "production" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br", "basic");
  }
  private path(identity: FiscalIdentity) { this.http.assert(identity); return "/v2/nfe/" + encodeURIComponent(identity.reference); }
  private document(identity: FiscalIdentity, data: Record<string, unknown>): FiscalProviderDocument {
    if (data.cnpj_emitente !== identity.issuerTaxId && data.cpf_emitente !== identity.issuerTaxId || data.ref !== identity.reference) throw new Error("fiscal_identity_mismatch");
    const base = { identity, remoteInvoiceId: identity.reference, providerStatus: String(data.status), verifiedBy: "authenticated_query" as const };
    if (data.status === "autorizado") {
      const protocol = data.protocolo_nota_fiscal as Record<string, unknown> | undefined;
      const protocolNumber = typeof protocol?.numero_protocolo === "string" ? protocol.numero_protocolo
        : typeof protocol?.numero_protocolo === "number" && Number.isSafeInteger(protocol.numero_protocolo) ? String(protocol.numero_protocolo) : "";
      if (String(protocol?.ambiente) !== (identity.environment === "production" ? "1" : "2")) throw new Error("fiscal_environment_mismatch");
      const accessKey = String(data.chave_nfe ?? "").replace(/^NFe/, "");
      if (!isFiscalAccessKey(accessKey) || accessKey.slice(20, 22) !== "55" || !/^\d{1,9}$/.test(String(data.numero)) || !/^\d{1,3}$/.test(String(data.serie))
        || !isFiscalProtocol(protocolNumber) || !Number.isFinite(Date.parse(String(protocol?.data_recebimento)))) throw new Error("fiscal_authorization_incomplete");
      return { ...base, status: "authorized", authorization: { number: String(data.numero), series: String(data.serie), accessKey,
        protocol: protocolNumber, authorizedAt: String(protocol!.data_recebimento) } };
    }
    if (data.status === "erro_autorizacao") return { ...base, status: "rejected", reasonCode: /^\d{3}$/.test(String(data.status_sefaz)) ? "sefaz_" + data.status_sefaz : "fiscal_provider_rejected" };
    // Cancellation acceptance/basic status alone does not prove the SEFAZ event protocol.
    return { ...base, status: "processing" };
  }
  private async complete(identity: FiscalIdentity, remoteInvoiceId?: string) {
    if (remoteInvoiceId !== undefined && remoteInvoiceId !== identity.reference) throw new Error("fiscal_identity_mismatch");
    return this.http.json(this.path(identity) + "?completa=1");
  }
  async query(identity: FiscalIdentity, remoteInvoiceId?: string) {
    const data = await this.complete(identity, remoteInvoiceId);
    if (!data) return { found: false as const };
    const document = this.document(identity, data);
    if (data.status === "cancelado" && typeof data.caminho_xml_cancelamento === "string") {
      const artifact = await this.http.artifact(data.caminho_xml_cancelamento, "xml");
      const key = String(data.chave_nfe ?? "").replace(/^NFe/, "");
      return { found: true as const, document: { ...document, status: "cancelled" as const,
        cancellation: cancelledNfeEvent(artifact.bytes, identity, key) } };
    }
    return { found: true as const, document };
  }
  findByReference(identity: FiscalIdentity) { return this.query(identity); }
  async ensureOrder(identity: FiscalIdentity) { this.http.assert(identity); return { outcome: "not_accepted" as const, reasonCode: "fiscal_provider_direct_issuance" }; }
  async generate(identity: FiscalIdentity) { this.http.assert(identity); return { outcome: "not_accepted" as const, reasonCode: "fiscal_provider_direct_issuance" }; }
  async submit(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["submit"]>[1]) {
    this.path(identity);
    if (input.remoteInvoiceId && input.remoteInvoiceId !== identity.reference) throw new Error("fiscal_identity_mismatch");
    if (input.sendEmail && this.options.policy.emailOwner !== "provider") throw new Error("fiscal_email_ownership_mismatch");
    if ((input.payload.cnpj_emitente ?? input.payload.cpf_emitente) !== identity.issuerTaxId) throw new Error("fiscal_identity_mismatch");
    const { __zyonFiscalDelivery, ...fiscalBody } = input.payload;
    const body: Record<string, unknown> = fiscalBody;
    const delivery = __zyonFiscalDelivery as { emailOwner?: string; buyerEmail?: string } | undefined;
    if (delivery?.emailOwner && delivery.emailOwner !== this.options.policy.emailOwner) throw new Error("fiscal_email_ownership_mismatch");
    delete body.email_destinatario;
    const included = Boolean(input.sendEmail && delivery?.buyerEmail);
    if (included) body.email_destinatario = delivery!.buyerEmail;
    const metadata = { emailOwner: this.options.policy.emailOwner, sendEmail: String(input.sendEmail), includedEmail: String(included),
      buyerEmailHash: createHash("sha256").update(delivery?.buyerEmail ?? "").digest("hex") };
    return this.http.write(identity, "invoice.submit", identity.reference, "/v2/nfe?ref=" + encodeURIComponent(identity.reference), body,
      record => ({ identity, remoteInvoiceId: record.remoteId!, status: "processing" as const, providerStatus: "processando_autorizacao", verifiedBy: "request_response" as const,
        ...(input.sendEmail ? { providerEmailRequest: { requested: true, included, ...(!included ? { reasonCode: "fiscal_email_destination_unavailable" } : {}) } } : {}) }),
      () => ({ remoteId: identity.reference }), "POST", metadata);
  }
  async download(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["download"]>[1]) {
    const data = await this.complete(identity, input.remoteInvoiceId);
    const document = data ? this.document(identity, data) : undefined;
    const original = document?.status === "authorized" ? document.authorization : data?.status === "cancelado" ? input.authorization : undefined;
    if (!data || !original || String(data.chave_nfe ?? "").replace(/^NFe/, "") !== original.accessKey) throw new Error("fiscal_artifact_not_authorized");
    if (input.authorization && document?.status === "authorized") assertOriginalFiscalAuthorization(input.authorization, document.authorization);
    const path = data[input.kind === "xml" ? "caminho_xml_nota_fiscal" : "caminho_danfe"];
    if (typeof path !== "string" || !path) throw new Error("fiscal_artifact_unavailable");
    const artifact = await this.http.artifact(path, input.kind);
    if (input.kind === "xml") {
      const authorization = authorizedNfe(safeXml(artifact.bytes), identity, original.accessKey);
      if (Object.entries(original).some(([key, value]) => key === "authorizedAt" ? Date.parse(authorization.authorizedAt) !== Date.parse(value) : authorization[key as keyof typeof authorization] !== value)) throw new Error("fiscal_artifact_authorization_mismatch");
    }
    return artifact;
  }
  async requestCancellation(identity: FiscalIdentity, input: Parameters<FiscalProviderPort["requestCancellation"]>[1]) {
    const path = this.path(identity);
    if (input.remoteInvoiceId !== identity.reference || input.restoreStock !== false || input.reverseAccounts !== false || input.cancelSale !== false) throw new Error("fiscal_cancellation_effects_forbidden");
    if (typeof input.justification !== "string" || input.justification.trim().length < 15 || input.justification.length > 255 || /[\u0000-\u001f]/.test(input.justification)) throw new Error("fiscal_cancellation_justification_invalid");
    if (!Number.isFinite(Date.parse(input.requestedAt))) throw new Error("fiscal_cancellation_time_invalid");
    return this.http.write(identity, "invoice.cancel", identity.reference, path, { justificativa: input.justification },
      record => ({ identity, remoteInvoiceId: record.remoteId!, status: "processing" as const, providerStatus: "cancelamento_solicitado", verifiedBy: "request_response" as const }),
      () => ({ remoteId: identity.reference }), "DELETE");
  }
  async reconcileStage(identity: FiscalIdentity, record: FiscalProviderStageRecord) {
    this.http.assert(identity); assertScope(identity, record.identity);
    if (record.identity.reference !== identity.reference || record.reference !== identity.reference || !["invoice.submit", "invoice.cancel"].includes(record.stage)) throw new Error("fiscal_stage_identity_mismatch");
    const result = await this.query(identity);
    if (record.stage === "invoice.cancel" && (!result.found || result.document.status !== "cancelled")) return { found: false as const };
    return result.found ? { found: true as const, remoteId: result.document.remoteInvoiceId } : { found: false as const };
  }
  async inspectConnection(scope: FiscalScope): Promise<readonly FiscalReadinessCheck[]> {
    assertScope(this.options.scope, scope);
    const pending = (): FiscalReadinessCheck[] => ["issuer", "certificate", "fiscal_permission", "email_ownership"].map(code => ({ code, status: "pending" }));
    if (!this.options.companyId) return pending();
    try {
      const companyId = remoteId(this.options.companyId);
      // Company management is production-host GET only, independently of the invoice environment.
      const management = new FiscalHttpTransport(this.options, "https://api.focusnfe.com.br", "basic");
      const data = await management.json("/v2/empresas/" + companyId);
      if (!data) return pending();
      const evidenceReference = "focus:company:" + companyId;
      const check = (code: string, verified: boolean): FiscalReadinessCheck => ({ code, status: verified ? "verified" : "pending", evidenceReference });
      const now = Date.now();
      const credential = await this.options.credential();
      const tokenMatches = data[scope.environment === "homologation" ? "token_homologacao" : "token_producao"] === credential;
      const companyMatches = String(data.id) === companyId;
      return [check("issuer", companyMatches && (data.cnpj === scope.issuerTaxId || data.cpf === scope.issuerTaxId)),
        check("certificate", data.certificado_cnpj === scope.issuerTaxId && Date.parse(String(data.certificado_valido_de)) <= now && Date.parse(String(data.certificado_valido_ate)) > now),
        check("fiscal_permission", companyMatches && tokenMatches && data.habilita_nfe === true),
        check("email_ownership", (this.options.policy.emailOwner === "provider" || data.enviar_email_destinatario === false) && data.enviar_email_homologacao === false),
        check("environment", companyMatches && tokenMatches)];
    } catch { return pending(); }
  }
}
