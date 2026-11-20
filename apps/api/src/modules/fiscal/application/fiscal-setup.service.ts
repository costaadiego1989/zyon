import { supportsFiscalOrderScope } from "./fiscal-order-scope.reader.js";
import { FISCAL_ORDER_SCOPE_UNSUPPORTED } from "../domain/fiscal-order-scope.js";
import { fiscalCryptoAccountFingerprint } from "../domain/fiscal-crypto-account.js";
import type { PrivateCryptoReceipt } from "../../payment/domain/ports/crypto-verifier.port.js";
import { normalizeFiscalTaxId } from "../domain/fiscal-recipient.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import type { CreateProviderPaymentInput } from "../../payment/domain/ports/payment-provider.port.js";
import type { PrismaClient } from "@prisma/client";
import type { FiscalCredentialCipherPort } from "../domain/fiscal-configuration.port.js";
import type {
  FiscalActor,
  FiscalTenant,
} from "../domain/fiscal-repository.port.js";
import type { FiscalErpAccountEvidence } from "../domain/fiscal-erp-account-evidence.port.js";
export interface FiscalProtectedPaymentConfiguration {
  provider: string; accountFingerprint: string; environment: string; acquirerTaxId?: string; providerTimeZone?: string; cryptoDescription?: string;
  source: "responsible_confirmation"; confirmedBy: string; confirmedAt: string;
}
export interface FiscalProtectedSetup {
  paymentConfigurations?: FiscalProtectedPaymentConfiguration[];
  companyId?: string;
  fiscalTimeZone?: string;
  focusWebhook?: { authorizationHeader: string; authorization: string };
  accountEvidence?: FiscalErpAccountEvidence;
  updatedAt: string;
  updatedBy: string;
}
/** Private configuration is encrypted separately from the company's routine issuance credential. */
export class FiscalSetupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: FiscalCredentialCipherPort,
    private readonly tenants?: TenantContextService,
    private readonly onSaved?: (scope: FiscalTenant, connectionId: string, actor: FiscalActor) => Promise<void>
  ) {}
  async read(
    scope: FiscalTenant,
    id: string
  ): Promise<FiscalProtectedSetup | null> {
    const row = await this.prisma.fiscalConnection.findFirst({
      where: { merchantId: scope.merchantId, environment: scope.environment, id },
    });
    if (!row) throw new Error("fiscal_connection_not_found");
    if (!row.setupCipher) return null;
    try {
      return JSON.parse(
        this.cipher.decrypt(row.setupCipher)
      ) as FiscalProtectedSetup;
    } catch {
      throw new Error("fiscal_setup_unavailable");
    }
  }
  async publicRead(scope: FiscalTenant, id: string) {
    const v = await this.read(scope, id);
    return {
      companyId: v?.companyId ?? null,
      fiscalTimeZone: v?.fiscalTimeZone ?? null,
      focusWebhookConfigured: !!v?.focusWebhook,
      paymentConfigurations: v?.paymentConfigurations?.map(({ provider, environment, acquirerTaxId, providerTimeZone, cryptoDescription, source, confirmedBy, confirmedAt }) => ({ provider, environment, acquirerTaxId, providerTimeZone, cryptoDescription, source, confirmedBy, confirmedAt })) ?? [],
      accountEvidence: v?.accountEvidence
        ? {
            source: v.accountEvidence.source,
            confirmedBy: v.accountEvidence.confirmedBy,
            confirmedAt: v.accountEvidence.confirmedAt,
            expiresAt: v.accountEvidence.expiresAt,
            profileVersionId: v.accountEvidence.profileVersionId,
            policyVersion: v.accountEvidence.policyVersion,
          }
        : null,
    };
  }
  async paymentSources(scope: FiscalTenant, intentId?: string) {
    let paymentMerchantId = scope.merchantId, paymentId: string | undefined;
    if (intentId !== undefined) {
      const intent = await this.prisma.fiscalIntent.findFirst({ where: { ...scope, id: intentId }, include: { snapshot: true } });
      if (!intent?.snapshot.paymentProofRef) throw new Error("fiscal_payment_source_not_found");
      if (!await supportsFiscalOrderScope(this.prisma, intent.snapshot)) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
      paymentMerchantId = intent.snapshot.orderMerchantId; paymentId = intent.snapshot.paymentProofRef;
    }
    const read = async () => await this.prisma.paymentIntent.findMany({ where: { merchantId: paymentMerchantId, ...(paymentId ? { id: paymentId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, merchantId: true, sessionId: true, method: true, status: true, creation: true, createdAt: true } });
    const rows = await (this.tenants ? this.tenants.run({ merchantId: paymentMerchantId, userId: "fiscal-owned-payment-source", role: "system" }, read) : read());
    return rows.flatMap(row => {
      const original = (row.creation as { input?: CreateProviderPaymentInput } | null)?.input;
      return !original?.marketplaceFunding && original?.provider && ["stripe", "asaas", "mercadopago", "crypto"].includes(original.provider) && original.intentId === row.id && original.merchantId === row.merchantId && original.sessionId === row.sessionId && (original.providerAccountFingerprint || original.provider === "crypto")
        ? [{ ...(intentId ? { intentId } : { paymentIntentId: row.id }), provider: original.provider, method: row.method, status: row.status, createdAt: row.createdAt }] : [];
    });
  }
  async save(
    scope: FiscalTenant,
    id: string,
    input: {
      companyId?: unknown;
      fiscalTimeZone?: unknown;
      focusWebhook?: unknown;
      accountConfiguration?: unknown;
      paymentConfiguration?: unknown;
    },
    actor: FiscalActor
  ) {
    if (!actor.actorId) throw new Error("fiscal_actor_required");
    const row = await this.prisma.fiscalConnection.findFirst({
      where: { merchantId: scope.merchantId, environment: scope.environment, id },
    });
    if (!row) throw new Error("fiscal_connection_not_found");
    const previous = await this.read(scope, id);
    const next: FiscalProtectedSetup = {
      ...previous,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.actorId,
    };
    if (input.paymentConfiguration !== undefined) {
      const c = input.paymentConfiguration as { paymentIntentId?: string; intentId?: string; confirmed?: boolean; environment?: string; acquirerTaxId?: string; providerTimeZone?: string; cryptoDescription?: string };
      if (!c || c.confirmed !== true || (!!c.paymentIntentId === !!c.intentId)) throw new Error("fiscal_payment_configuration_invalid");
      let paymentMerchantId = scope.merchantId; let paymentId = c.paymentIntentId;
      if (c.intentId) { const intent = await this.prisma.fiscalIntent.findFirst({ where: { ...scope, id: c.intentId }, include: { snapshot: true } });
        if (!intent?.snapshot.paymentProofRef) throw new Error("fiscal_payment_source_not_found");
      if (!await supportsFiscalOrderScope(this.prisma, intent.snapshot)) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
        paymentId = intent.snapshot.paymentProofRef; paymentMerchantId = intent.snapshot.orderMerchantId;
      }
      const read = async () => await this.prisma.paymentIntent.findFirst({ where: { merchantId: paymentMerchantId, id: paymentId } });
      const payment = await (this.tenants ? this.tenants.run({ merchantId: paymentMerchantId, userId: "fiscal-payment-configuration", role: "system" }, read) : read());
      const original = (payment?.creation as { input?: CreateProviderPaymentInput } | null)?.input;
      if (!payment || !original || original.intentId !== payment.id || original.merchantId !== payment.merchantId || original.sessionId !== payment.sessionId || !["stripe", "asaas", "mercadopago", "crypto"].includes(original.provider ?? "")) throw new Error("fiscal_original_payment_binding_required");
      if (original.marketplaceFunding || await this.prisma.marketplaceFundingPlan.count({ where: { paymentIntentId: payment.id } })) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
      let fingerprint = original.providerAccountFingerprint; let environment = c.environment;
      if (original.provider === "crypto") {
        const privateReceipt = payment.privateReceipt as PrivateCryptoReceipt | null;
        if (privateReceipt?.kind !== "crypto_v1" || !privateReceipt.quote) throw new Error("fiscal_crypto_receipt_required");
        fingerprint = fiscalCryptoAccountFingerprint(privateReceipt.quote); environment = privateReceipt.quote.evmNetwork;
        if (!c.cryptoDescription?.trim() || c.cryptoDescription.length > 60) throw new Error("fiscal_payment_crypto_classification_required");
      } else if (!["test", "live"].includes(environment ?? "")) throw new Error("fiscal_payment_configuration_invalid");
      if (!fingerprint) throw new Error("fiscal_original_payment_binding_required");
      const acquirer = c.acquirerTaxId === undefined ? undefined : normalizeFiscalTaxId(c.acquirerTaxId);
      if (c.acquirerTaxId !== undefined && (!acquirer || acquirer.length !== 14)) throw new Error("fiscal_payment_configuration_invalid");
      if (c.providerTimeZone) try { new Intl.DateTimeFormat("en", { timeZone: c.providerTimeZone }).format(); } catch { throw new Error("fiscal_payment_configuration_invalid"); }
      const value: FiscalProtectedPaymentConfiguration = { provider: original.provider!, accountFingerprint: fingerprint, environment: environment!, ...(acquirer ? { acquirerTaxId: acquirer } : {}), ...(c.providerTimeZone ? { providerTimeZone: c.providerTimeZone } : {}), ...(c.cryptoDescription ? { cryptoDescription: c.cryptoDescription.trim() } : {}), source: "responsible_confirmation", confirmedBy: actor.actorId, confirmedAt: new Date().toISOString() };
      next.paymentConfigurations = [...(previous?.paymentConfigurations ?? []).filter(v => v.provider !== value.provider || v.accountFingerprint !== value.accountFingerprint || v.environment !== value.environment), value];
    }
    if (input.companyId !== undefined) {
      if (
        typeof input.companyId !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.companyId)
      )
        throw new Error("fiscal_setup_invalid");
      next.companyId = input.companyId;
    }
    if (input.fiscalTimeZone !== undefined) {
      if (typeof input.fiscalTimeZone !== "string")
        throw new Error("fiscal_setup_invalid");
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: input.fiscalTimeZone,
        }).format();
      } catch {
        throw new Error("fiscal_setup_invalid");
      }
      next.fiscalTimeZone = input.fiscalTimeZone;
    }
    if (input.focusWebhook !== undefined) {
      const hook = input.focusWebhook as Record<string, unknown>;
      if (
        row.provider !== "focus" ||
        !hook ||
        typeof hook.authorizationHeader !== "string" ||
        !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(hook.authorizationHeader) ||
        ["host", "content-type", "content-length", "cookie"].includes(
          hook.authorizationHeader.toLowerCase()
        ) ||
        typeof hook.authorization !== "string" ||
        hook.authorization.length < 16 ||
        hook.authorization.length > 4096 ||
        /[\r\n]/.test(hook.authorization)
      )
        throw new Error("fiscal_setup_invalid");
      next.focusWebhook = {
        authorizationHeader: hook.authorizationHeader.toLowerCase(),
        authorization: hook.authorization,
      };
    }
    if (input.accountConfiguration !== undefined) {
      const config = input.accountConfiguration as {
        profileVersionId: string;
        policyVersion: string;
        expiresAt: string;
        certificateValidUntil: string;
        effects: FiscalErpAccountEvidence["effects"];
        confirmed: boolean;
      };
      if (
        !config ||
        typeof config.profileVersionId !== "string" ||
        !config.profileVersionId.trim()
      )
        throw new Error("fiscal_setup_invalid");
      const profile =
        config &&
        (await this.prisma.fiscalProfileVersion.findFirst({
          where: {
            ...scope,
            id: config.profileVersionId,
            provider: row.provider,
            confirmedAt: { not: null },
          },
        }));
      if (
        !profile ||
        config.confirmed !== true ||
        typeof config.policyVersion !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,100}$/.test(config.policyVersion) ||
        ![config.expiresAt, config.certificateValidUntil].every(
          (v) => Number.isFinite(Date.parse(v)) && Date.parse(v) > Date.now()
        ) ||
        Date.parse(config.expiresAt) > Date.now() + 366 * 86400000 ||
        !config.effects ||
        [
          "stockOnSave",
          "stockOnAuthorize",
          "stockOnCancel",
          "accountsOnSave",
          "accountsOnAuthorize",
          "accountsOnCancel",
          "automaticEmail",
        ].some(
          (k) =>
            typeof config.effects[k as keyof typeof config.effects] !==
            "boolean"
        )
      )
        throw new Error("fiscal_setup_invalid");
      next.accountEvidence = {
        scope: {
          ...scope,
          connectionId: id,
          provider: row.provider,
          issuerTaxId: row.issuerTaxId,
        },
        policyVersion: config.policyVersion,
        profileVersionId: profile.id,
        source: "responsible_confirmation",
        confirmedBy: actor.actorId,
        confirmationPermission: "fiscal.configure",
        confirmedAt: new Date().toISOString(),
        expiresAt: config.expiresAt,
        certificateValidUntil: config.certificateValidUntil,
        effects: {
          stockOnSave: config.effects.stockOnSave,
          stockOnAuthorize: config.effects.stockOnAuthorize,
          stockOnCancel: config.effects.stockOnCancel,
          accountsOnSave: config.effects.accountsOnSave,
          accountsOnAuthorize: config.effects.accountsOnAuthorize,
          accountsOnCancel: config.effects.accountsOnCancel,
          automaticEmail: config.effects.automaticEmail,
          ...(typeof config.effects.automaticInvoiceGeneration === "boolean"
            ? {
                automaticInvoiceGeneration:
                  config.effects.automaticInvoiceGeneration,
              }
            : {}),
          ...(typeof config.effects.automaticInvoiceAuthorization === "boolean"
            ? {
                automaticInvoiceAuthorization:
                  config.effects.automaticInvoiceAuthorization,
              }
            : {}),
        },
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.fiscalConnection.update({
        where: { id },
        data: {
          setupCipher: this.cipher.encrypt(JSON.stringify(next)),
          readiness: [],
        },
      });
      await tx.merchantAuditEvent.create({
        data: {
          merchantId: scope.merchantId,
          actorType: actor.actorKind,
          actorId: actor.actorId!,
          action: "fiscal.setup",
          resourceType: "fiscal_connection",
          resourceId: id,
          metadata: {
            provider: row.provider,
            environment: scope.environment,
            result: "inspection_required",
          },
        },
      });
    });
    await this.onSaved?.(scope, id, actor);
    return this.publicRead(scope, id);
  }
}
