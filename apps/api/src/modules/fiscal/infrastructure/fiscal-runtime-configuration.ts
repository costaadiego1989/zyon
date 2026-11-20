import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  FiscalConnectionRecord,
  FiscalCredentialCipherPort,
  FiscalConnectionInspectorPort,
} from "../domain/fiscal-configuration.port.js";
import type {
  FiscalScope,
  FiscalReadinessCheck,
} from "../domain/fiscal-provider.js";
import {
  validErpAccountEvidence,
  type FiscalCredentialAuthorization,
  type FiscalErpAccountEvidencePort,
} from "../domain/fiscal-erp-account-evidence.port.js";
import {
  FiscalErpCredentials,
  type FiscalGrantProof,
  type FiscalGrantPolicyPort,
} from "./fiscal-erp-credentials.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import { FocusFiscalAdapter } from "./providers/focus-fiscal.adapter.js";
import { BlingFiscalAdapter } from "./providers/bling-fiscal.adapter.js";
import { OmieFiscalAdapter } from "./providers/omie-fiscal.adapter.js";
import { OlistFiscalAdapter } from "./providers/olist-fiscal.adapter.js";
/** Reviewed server-side grant bindings. A merchant's request or a decoded token cannot create permissions. */
interface GrantBinding {
  scope: FiscalScope;
  credentialHash: string;
  clientFingerprint: string;
  scopeIds: string[];
  permissions: FiscalCredentialAuthorization["permissions"];
  reference: string;
}
export class FiscalRuntimeConfiguration
  implements FiscalConnectionInspectorPort, FiscalGrantPolicyPort
{
  readonly credentials: FiscalErpCredentials;
  readonly accountEvidence: FiscalErpAccountEvidencePort;
  constructor(
    private readonly prisma: PrismaClient,
    cipher: FiscalCredentialCipherPort,
    readonly setup: FiscalSetupService,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.credentials = new FiscalErpCredentials(prisma, cipher, this, fetcher);
    this.accountEvidence = {
      read: async (scope) =>
        (
          await setup.read(
            { merchantId: scope.merchantId, environment: scope.environment },
            scope.connectionId
          )
        )?.accountEvidence ?? null,
    };
  }
  private continuitySignature(scope: FiscalScope, proof: FiscalGrantProof, initialCredentialHash: string) {
    const key = this.env.AACP_PII_ENC_KEY;
    if (!key?.trim()) return null;
    return createHmac("sha256", key).update(JSON.stringify(["fiscal_authenticated_refresh_v1", scope.merchantId, scope.connectionId, scope.provider, scope.environment, scope.issuerTaxId, proof.clientFingerprint, initialCredentialHash, proof.credentialHash])).digest("hex");
  }
  private initialCredentialHash(scope: FiscalScope, proof: FiscalGrantProof) {
    if (!proof.continuity || proof.source !== "protected_credential_binding") return proof.credentialHash;
    const { initialCredentialHash, signature } = proof.continuity;
    const expected = this.continuitySignature(scope, proof, initialCredentialHash);
    if (!expected || !/^[a-f0-9]{64}$/.test(initialCredentialHash) || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return proof.credentialHash;
    return initialCredentialHash;
  }
  async authorizeRefresh(scope: FiscalScope, previous: FiscalGrantProof, next: FiscalGrantProof) {
    if (previous.source !== "protected_credential_binding" || next.source !== previous.source || previous.clientFingerprint !== next.clientFingerprint || !await this.resolve(scope, previous)) return null;
    const initialCredentialHash = this.initialCredentialHash(scope, previous);
    const signature = this.continuitySignature(scope, next, initialCredentialHash);
    return signature ? { initialCredentialHash, signature } : null;
  }
  async resolve(scope: FiscalScope, proof: FiscalGrantProof) {
    if (
      scope.provider === "bling" &&
      proof.source === "authenticated_token_response"
    ) {
      let mapping: Record<string, FiscalCredentialAuthorization["permissions"]>;
      try {
        mapping = JSON.parse(this.env.FISCAL_BLING_SCOPE_PERMISSIONS ?? "{}");
      } catch {
        throw new Error("fiscal_grant_configuration_invalid");
      }
      const permissions = [
        ...new Set(
          proof.scopeIds.flatMap((id) =>
            Array.isArray(mapping[id]) ? mapping[id] : []
          )
        ),
      ];
      if (
        permissions.length &&
        permissions.every((p) =>
          [
            "fiscal_read",
            "fiscal_write",
            "order_write",
            "contact_write",
          ].includes(p)
        )
      )
        return {
          permissions,
          evidenceReference: "authenticated_grant:bling:reviewed_scope_policy",
        };
    }
    let bindings: GrantBinding[];
    try {
      bindings = JSON.parse(this.env.FISCAL_CREDENTIAL_GRANTS ?? "[]");
    } catch {
      throw new Error("fiscal_grant_configuration_invalid");
    }
    if (!Array.isArray(bindings))
      throw new Error("fiscal_grant_configuration_invalid");
    const b = bindings.find(
      (b) =>
        b &&
        b.scope &&
        (
          [
            "merchantId",
            "connectionId",
            "provider",
            "environment",
            "issuerTaxId",
          ] as const
        ).every((k) => b.scope[k] === scope[k]) &&
        b.credentialHash === this.initialCredentialHash(scope, proof) &&
        b.clientFingerprint === proof.clientFingerprint &&
        Array.isArray(b.scopeIds) &&
        b.scopeIds.every((id) => proof.scopeIds.includes(id))
    );
    if (
      !b ||
      !Array.isArray(b.permissions) ||
      b.permissions.some(
        (p) =>
          ![
            "fiscal_read",
            "fiscal_write",
            "order_write",
            "contact_write",
          ].includes(p)
      ) ||
      !/^authenticated_grant:[A-Za-z0-9_.:-]{1,150}$/.test(b.reference)
    )
      return null;
    return { permissions: b.permissions, evidenceReference: b.reference };
  }
  async stockOrigin(scope: FiscalScope) {
    let rows: Array<{ scope: FiscalScope; objectType: string; source: string; evidenceReference: string }>;
    try { rows = JSON.parse(this.env.FISCAL_OLIST_STOCK_ORIGINS ?? "[]"); } catch { throw new Error("fiscal_stock_origin_configuration_invalid"); }
    if (!Array.isArray(rows)) throw new Error("fiscal_stock_origin_configuration_invalid");
    const matches = rows.filter(row => row?.scope && (["merchantId", "connectionId", "provider", "environment", "issuerTaxId"] as const).every(k => row.scope[k] === scope[k]));
    const row = matches.length === 1 ? matches[0] : undefined;
    return scope.provider === "tiny" && row?.source === "verified_provider_contract" && /^[A-Za-z0-9_.-]{1,80}$/.test(row.objectType) && /^verified_provider_contract:[A-Za-z0-9_.:-]{1,150}$/.test(row.evidenceReference) ? { objectType: row.objectType, source: "verified_provider_contract" as const, evidenceReference: row.evidenceReference } : null;
  }
  async inspect(
    connection: FiscalConnectionRecord,
    _credential: string
  ): Promise<readonly FiscalReadinessCheck[]> {
    const scope: FiscalScope = {
      merchantId: connection.merchantId,
      environment: connection.environment,
      connectionId: connection.id,
      provider: connection.provider,
      issuerTaxId: connection.issuerTaxId,
    };
    // Authentication uses the real original credential bridge, including shared Bling app/grant preflight.
    await this.credentials.credential(scope);
    const setup = await this.setup.read(
      { merchantId: scope.merchantId, environment: scope.environment },
      connection.id
    );
    const evidence = setup?.accountEvidence;
    const policy = {
      stockOwner: connection.stockOwner,
      emailOwner: connection.emailOwner,
      whatsappOwner: connection.whatsappOwner,
      version: evidence?.policyVersion ?? "",
      profileVersionId: evidence?.profileVersionId ?? "",
    };
    const options = {
      scope,
      credential: () => this.credentials.credential(scope),
      fetch: this.fetcher,
      companyId: setup?.companyId,
      policy,
      authorization: {
        read: (s: FiscalScope) => this.credentials.authorization(s),
      },
      accountEvidence: this.accountEvidence,
    };
    const adapter =
      scope.provider === "focus"
        ? new FocusFiscalAdapter(options)
        : scope.provider === "bling"
        ? new BlingFiscalAdapter(options)
        : scope.provider === "omie"
        ? new OmieFiscalAdapter(options)
        : new OlistFiscalAdapter({ ...options, credentialVersion: "v3" });
    const checks = await adapter.inspectConnection(scope);
    const read = (code: string) => checks.find((c) => c.code === code);
    const result = (code: string, source: string) =>
      ({
        code,
        status: read(source)?.status ?? "pending",
        ...(read(source)?.evidenceReference
          ? { evidenceReference: read(source)!.evidenceReference }
          : {}),
      } as FiscalReadinessCheck);
    const issuer = result("issuer", "issuer"),
      permission = result("permissions", "fiscal_permission");
    const configured =
      scope.provider !== "focus" &&
      validErpAccountEvidence(evidence ?? null, scope, policy);
    const stockOriginReady = scope.provider !== "tiny" || connection.stockOwner !== "provider" || !!await this.stockOrigin(scope);
    return [
      {
        code: "authentication",
        status: issuer.status === "verified" ? "verified" : "pending",
        ...(issuer.evidenceReference
          ? { evidenceReference: issuer.evidenceReference }
          : {}),
      },
      issuer,
      result("certificate", "certificate"),
      permission,
      result("environment", "environment"),
      scope.provider === "focus"
        ? {
            code: "stock_policy",
            status:
              connection.stockOwner === "zyon" ? "verified" : "unsupported",
            evidenceReference: "focus:company:no_inventory_effect",
          }
        : {
            code: "stock_policy",
            status: configured && stockOriginReady ? "verified" : "pending",
            ...(evidence
              ? {
                  evidenceReference:
                    "responsible_confirmation:" + evidence.confirmedAt,
                }
              : {}),
          },
      scope.provider === "focus"
        ? result("email_policy", "email_ownership")
        : {
            code: "email_policy",
            status: configured ? "verified" : "pending",
            ...(evidence
              ? {
                  evidenceReference:
                    "responsible_confirmation:" + evidence.confirmedAt,
                }
              : {}),
          },
      {
        code: "whatsapp_policy",
        status:
          connection.whatsappOwner === "zyon" ? "verified" : "unsupported",
      },
    ];
  }
}
