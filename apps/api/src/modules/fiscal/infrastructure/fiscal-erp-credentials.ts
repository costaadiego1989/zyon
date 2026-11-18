import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import type { FiscalScope } from "../domain/fiscal-provider.js";
import type { FiscalCredentialAuthorization } from "../domain/fiscal-erp-account-evidence.port.js";
import { readBlingCredential } from "../../../shared/integrations/bling-credentials.js";
import { blingClientFingerprint } from "../../../shared/integrations/bling-token-identity.js";
export interface FiscalGrantProof { source: "authenticated_token_response" | "protected_credential_binding"; credentialHash: string; clientFingerprint: string; scopeIds: readonly string[]; continuity?: { initialCredentialHash: string; signature: string } }
/** A protected reviewed mapping/evidence store, never a public connect payload or decoded JWT. */
export interface FiscalGrantPolicyPort { authorizeRefresh?(scope: FiscalScope, previous: FiscalGrantProof, next: FiscalGrantProof): Promise<FiscalGrantProof["continuity"] | null>; resolve(scope: FiscalScope, proof: FiscalGrantProof): Promise<Pick<FiscalCredentialAuthorization, "permissions" | "evidenceReference"> | null> }
interface AppCredential { contract: "omie_app_v1" | "olist_oauth_v3"; environment: string; issuerTaxId: string; token: string; refreshToken: string; expiresAt: string; appHash?: string; clientId?: string; clientSecret?: string; revoked?: boolean; grantContinuity?: FiscalGrantProof["continuity"]; refreshUnknown?: boolean; refreshRetryAt?: string }
export class FiscalErpCredentials {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: FiscalCredentialCipherPort, private readonly grants: FiscalGrantPolicyPort, private readonly fetcher: typeof fetch = fetch) {}
  private async connection(scope: FiscalScope) { const value = await this.prisma.fiscalConnection.findFirst({ where: { id: scope.connectionId, merchantId: scope.merchantId, provider: scope.provider, environment: scope.environment, issuerTaxId: scope.issuerTaxId, disconnectedAt: null } }); if (!value) throw new Error("fiscal_credential_scope_or_connection_invalid"); return value; }
  private async read(scope: FiscalScope): Promise<{ token: string; proof: FiscalGrantProof | null }> {
    const connection = await this.connection(scope);
    if (scope.provider === "bling") {
      if (!connection.erpConnectionId) throw new Error("fiscal_erp_connection_required");
      const credential = await readBlingCredential(this.prisma, { id: connection.erpConnectionId, merchantId: scope.merchantId }, this.fetcher); const config = credential.config as Record<string, unknown> | null; const hash = createHash("sha256").update(credential.token).digest("hex");
      const valid = config?.blingGrantSource === "authenticated_token_response" && config.blingGrantTokenHash === hash && config.blingClientFingerprint === blingClientFingerprint() && Array.isArray(config.blingGrantedScopes) && config.blingGrantedScopes.every(id => typeof id === "string");
      return { token: credential.token, proof: valid ? { source: "authenticated_token_response", credentialHash: hash, clientFingerprint: blingClientFingerprint(), scopeIds: config!.blingGrantedScopes as string[] } : null };
    }
    if (scope.provider === "focus") { if (!connection.credentialCipher) throw new Error("fiscal_reauthorization_required"); const token = this.cipher.decrypt(connection.credentialCipher); return { token, proof: null }; }
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM fiscal_connections WHERE id = ${scope.connectionId} AND merchant_id = ${scope.merchantId} AND environment = ${scope.environment}::"FiscalEnvironment" FOR UPDATE`;
      const fresh = await tx.fiscalConnection.findFirst({ where: { id: scope.connectionId, merchantId: scope.merchantId, provider: scope.provider, environment: scope.environment, issuerTaxId: scope.issuerTaxId, disconnectedAt: null } });
      if (!fresh?.credentialCipher) throw new Error("fiscal_reauthorization_required"); let value: AppCredential;
      try { value = JSON.parse(this.cipher.decrypt(fresh.credentialCipher)) as AppCredential; } catch { throw new Error("fiscal_reauthorization_required"); }
      if (value.contract !== (scope.provider === "omie" ? "omie_app_v1" : "olist_oauth_v3") || value.environment !== scope.environment || value.issuerTaxId !== scope.issuerTaxId || !value.token || !value.refreshToken || value.revoked || !Number.isFinite(Date.parse(value.expiresAt)) || scope.provider === "omie" && !/^[A-Za-z0-9_-]{1,128}$/.test(value.appHash ?? "") || scope.provider === "tiny" && (!value.clientId || !value.clientSecret)) throw new Error("fiscal_reauthorization_required");
      if (value.refreshUnknown) return { error: "fiscal_credential_refresh_unknown_reauthorization_required" } as const;
      if (value.refreshRetryAt && Date.parse(value.refreshRetryAt) > Date.now()) return { error: "fiscal_credential_refresh_temporarily_unavailable" } as const;
      const proofOf = (credential: AppCredential): FiscalGrantProof => ({ source: "protected_credential_binding", credentialHash: createHash("sha256").update(credential.token).digest("hex"), clientFingerprint: createHash("sha256").update(credential.appHash ?? credential.clientId ?? "").digest("hex"), scopeIds: [], ...(credential.grantContinuity ? { continuity: credential.grantContinuity } : {}) });
      if (Date.parse(value.expiresAt) <= Date.now() + 60_000) {
        try {
          const omie = scope.provider === "omie"; const response = await this.fetcher(omie ? `https://app.omie.com.br/api/portal/apps/${value.appHash}/refresh-token/` : "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "content-type": omie ? "application/json" : "application/x-www-form-urlencoded" }, body: omie ? JSON.stringify({ token: value.token, refresh_token: value.refreshToken }) : new URLSearchParams({ grant_type: "refresh_token", refresh_token: value.refreshToken, client_id: value.clientId!, client_secret: value.clientSecret! }).toString() });
          if (response.status === 429 || response.status === 503) {
            const retry = Number(response.headers.get("retry-after"));
            const next = { ...value, refreshRetryAt: new Date(Date.now() + Math.max(1000, Math.min(Number.isFinite(retry) && retry > 0 ? retry * 1000 : 30000, 300000))).toISOString() };
            await tx.fiscalConnection.update({ where: { id: fresh.id }, data: { credentialCipher: this.cipher.encrypt(JSON.stringify(next)) } });
            return { error: "fiscal_credential_refresh_temporarily_unavailable" } as const;
          }
          const data = await response.json() as Record<string, unknown>; const token = omie ? data.token : data.access_token;
          if ([400, 401, 403].includes(response.status) && ["invalid_grant", "invalid_token", "access_denied"].includes(String(data.error))) {
            value = { ...value, revoked: true };
            await tx.fiscalConnection.update({ where: { id: fresh.id }, data: { credentialCipher: this.cipher.encrypt(JSON.stringify(value)), readiness: [] } });
            return { error: "fiscal_reauthorization_required" } as const;
          }
          if (!response.ok || typeof token !== "string" || !token || typeof data.refresh_token !== "string" || !data.refresh_token || !omie && (!Number.isSafeInteger(data.expires_in) || Number(data.expires_in) <= 0)) throw new Error("refresh_failed");
          const prior = proofOf(value);
          const rotated = { ...value, token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (omie ? 24 * 3600 : Number(data.expires_in)) * 1000).toISOString() };
          let continuity: FiscalGrantProof["continuity"] | null | undefined;
          // A known accepted rotating pair must survive even a local grant-policy configuration failure.
          try { continuity = await this.grants.authorizeRefresh?.(scope, prior, proofOf(rotated)); } catch { continuity = null; }
          value = { ...rotated, grantContinuity: continuity ?? undefined, refreshRetryAt: undefined, refreshUnknown: undefined };
        } catch { value = { ...value, refreshUnknown: true }; await tx.fiscalConnection.update({ where: { id: fresh.id }, data: { credentialCipher: this.cipher.encrypt(JSON.stringify(value)), readiness: [] } }); return { error: "fiscal_credential_refresh_unknown_reauthorization_required" } as const; }
        await tx.fiscalConnection.update({ where: { id: fresh.id }, data: { credentialCipher: this.cipher.encrypt(JSON.stringify(value)) } });
      }
      return value;
    }, { maxWait: 30_000, timeout: 30_000 });
    if ("error" in result) throw new Error(result.error);
    return { token: result.token, proof: { source: "protected_credential_binding", credentialHash: createHash("sha256").update(result.token).digest("hex"), clientFingerprint: createHash("sha256").update(result.appHash ?? result.clientId ?? "").digest("hex"), scopeIds: [], ...(result.grantContinuity ? { continuity: result.grantContinuity } : {}) } };
  }
  /** Server-only credential callback for a single adapter instance. Never return from a controller. */
  async credential(scope: FiscalScope) { return (await this.read(scope)).token; }
  async authorization(scope: FiscalScope): Promise<FiscalCredentialAuthorization | null> { const { proof } = await this.read(scope); if (!proof) return null; const value = await this.grants.resolve(scope, proof); if (!value || !value.evidenceReference?.trim()) return null; return { scope, permissions: [...value.permissions], evidenceReference: value.evidenceReference }; }
}
