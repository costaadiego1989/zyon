import { listFiscalProviders, type FiscalReadinessCheck } from "../domain/fiscal-provider.js";
import { normalizeFiscalTaxId } from "../domain/fiscal-recipient.js";
import type { FiscalConfigurationStore, FiscalConnectionInput, FiscalConnectionRecord, FiscalCredentialCipherPort,
  FiscalConnectionInspectorPort } from "../domain/fiscal-configuration.port.js";
import type { FiscalActor, FiscalTenant } from "../domain/fiscal-repository.port.js";

export const FISCAL_READINESS_CODES = ["authentication", "certificate", "permissions", "issuer", "environment", "stock_policy", "email_policy", "whatsapp_policy"] as const;
function publicConnection(value: FiscalConnectionRecord) {
  return { id: value.id, merchantId: value.merchantId, provider: value.provider, environment: value.environment,
    issuerTaxId: value.issuerTaxId, erpConnectionId: value.erpConnectionId, readiness: value.readiness, isActive: value.isActive,
    activatedAt: value.activatedAt, disconnectedAt: value.disconnectedAt, stockOwner: value.stockOwner, emailOwner: value.emailOwner, whatsappOwner: value.whatsappOwner };
}
export class FiscalConnectionService {
  constructor(private readonly store: FiscalConfigurationStore, private readonly cipher: FiscalCredentialCipherPort,
    private readonly inspector: FiscalConnectionInspectorPort, private readonly onReady?: (scope: FiscalTenant, connectionId: string, actor: FiscalActor) => Promise<void>) {}
  providers() { return listFiscalProviders(); }
  connect(input: FiscalConnectionInput, actor: FiscalActor) {
    const issuerTaxId = normalizeFiscalTaxId(input.issuerTaxId);
    if (!input.merchantId?.trim() || !["homologation", "production"].includes(input.environment)
      || !this.providers().some(provider => provider.id === input.provider) || issuerTaxId?.length !== 14
      || !actor.actorId?.trim() || (input.provider !== "bling" && !input.credential?.secret?.trim()) || (input.credential?.secret?.length ?? 0) > 16000
      || [input.stockOwner, input.emailOwner, input.whatsappOwner].some(owner => !["zyon", "provider"].includes(owner))) {
      throw new Error("fiscal_connection_invalid");
    }
    const kind = { focus: "company_token", bling: "oauth", tiny: "oauth", omie: "app_credentials" }[input.provider];
    if (input.provider === "bling" ? !input.erpConnectionId || !!input.credential : input.credential?.kind !== kind) throw new Error("fiscal_company_credential_required");
    return this.store.create({ merchantId: input.merchantId, environment: input.environment, provider: input.provider,
      issuerTaxId, credentialCipher: input.provider === "bling" ? null : this.cipher.encrypt(input.credential!.secret), erpConnectionId: input.erpConnectionId,
      stockOwner: input.stockOwner, emailOwner: input.emailOwner, whatsappOwner: input.whatsappOwner }, actor).then(publicConnection);
  }
  async current(scope: FiscalTenant) { const value = await this.store.latest?.(scope) ?? await this.store.active(scope); return value ? publicConnection(value) : null; }
  async reconnect(scope: FiscalTenant, id: string, credential: FiscalConnectionInput["credential"], actor: FiscalActor) {
    const original = await this.store.find(scope, id); if (!original || !this.store.reconnect) throw new Error("fiscal_connection_not_found");
    if (!actor.actorId?.trim()) throw new Error("fiscal_actor_required");
    const kind = { focus: "company_token", bling: "oauth", tiny: "oauth", omie: "app_credentials" }[original.provider];
    if (original.provider === "bling" ? !!credential : credential?.kind !== kind || !credential.secret?.trim() || credential.secret.length > 16000) throw new Error("fiscal_company_credential_required");
    await this.store.reconnect(scope, id, credential ? this.cipher.encrypt(credential.secret) : undefined, actor);
    const result = await this.inspect(scope, id);
    if ((result.readiness as FiscalReadinessCheck[]).every(check => check.status === "verified")) await this.onReady?.(scope, id, actor);
    return result;
  }
  private async required(scope: FiscalTenant, id: string) {
    const value = await this.store.find(scope, id);
    if (!value) throw new Error("fiscal_connection_not_found");
    if (value.disconnectedAt) throw new Error("fiscal_connection_disconnected");
    return value;
  }
  private async check(connection: FiscalConnectionRecord): Promise<readonly FiscalReadinessCheck[]> {
    if (!connection.credentialCipher && connection.provider !== "bling") return FISCAL_READINESS_CODES.map(code => ({ code, status: "pending" }));
    try {
      const found = await this.inspector.inspect(connection, connection.credentialCipher ? this.cipher.decrypt(connection.credentialCipher) : "");
      return FISCAL_READINESS_CODES.map(code => { const check = found.find(check => check.code === code);
        const reference = check?.evidenceReference && /^(focus:company:|bling:company:|omie:company:|olist:|responsible_confirmation:|authenticated_grant:|credential_binding:)[A-Za-z0-9_.:-]{1,200}$/.test(check.evidenceReference) ? check.evidenceReference : undefined;
        return { code, status: check?.status ?? "pending", ...(reference ? { evidenceReference: reference } : {}) };
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const reauthorize = /^(?:fiscal_reauthorization_required|erp_bling_(?:reauthorization_required|app_changed|app_configuration_invalid))$/.test(raw);
      return FISCAL_READINESS_CODES.map(code => ({ code, status: "pending", reasonCode: reauthorize ? "fiscal_erp_reconnect_required" : "fiscal_provider_unavailable", ...(reauthorize ? { action: "reconnect" as const } : {}) }));
    }
  }
  async inspect(scope: FiscalTenant, id: string) {
    const checks = await this.check(await this.required(scope, id));
    return publicConnection(await this.store.recordReadiness(scope, id, checks));
  }
  async activate(scope: FiscalTenant, id: string, actor: FiscalActor) {
    if (!actor.actorId?.trim()) throw new Error("fiscal_actor_required");
    const checks = await this.check(await this.required(scope, id));
    const pending = checks.filter(check => check.status !== "verified").map(check => check.code);
    if (pending.length) {
      await this.store.recordReadiness(scope, id, checks);
      throw Object.assign(new Error("fiscal_connection_not_ready"), { code: "fiscal_connection_not_ready", pending });
    }
    const result = publicConnection(await this.store.activate(scope, id, checks, actor));
    await this.onReady?.(scope, id, actor);
    return result;
  }
  async disconnect(scope: FiscalTenant, id: string, actor: FiscalActor) {
    if (!actor.actorId?.trim()) throw new Error("fiscal_actor_required");
    if (!await this.store.find(scope, id)) throw new Error("fiscal_connection_not_found");
    return publicConnection(await this.store.disconnect(scope, id, actor));
  }
}
