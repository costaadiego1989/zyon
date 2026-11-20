import { supportsFiscalOrderScope } from "../application/fiscal-order-scope.reader.js";
import { FISCAL_ORDER_SCOPE_UNSUPPORTED } from "../domain/fiscal-order-scope.js";
import { createHash } from "node:crypto";
import { fiscalCryptoAccountFingerprint } from "../domain/fiscal-crypto-account.js";
import type { PrismaClient } from "@prisma/client";
import type {
  FiscalPaymentEvidence,
  FiscalPaymentEvidencePort,
} from "../domain/fiscal-payment-evidence.port.js";
import type { FiscalSnapshotRecord } from "../domain/fiscal-sale-snapshot.port.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import {
  fiscalCalendarDate,
  fiscalProviderInstant,
} from "../domain/fiscal-payment-date.js";
import type {
  PaymentProviderPort,
  CreateProviderPaymentInput,
} from "../../payment/domain/ports/payment-provider.port.js";
import type { PrivateCryptoReceipt } from "../../payment/domain/ports/crypto-verifier.port.js";
import type { FiscalSetupService } from "../application/fiscal-setup.service.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
const brands: Record<string, string> = {
  visa: "01",
  debvisa: "01",
  mastercard: "02",
  master: "02",
  debmaster: "02",
  amex: "03",
  american_express: "03",
  sorocred: "04",
  diners: "05",
  diners_club: "05",
  discover: "14",
  jcb: "18",
  elo: "06",
  hipercard: "07",
  aura: "08",
  cabal: "09",
};
export class FiscalPaymentEvidenceReader implements FiscalPaymentEvidencePort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PaymentProviderPort,
    private readonly setup: FiscalSetupService,
    private readonly tenants: TenantContextService
  ) {}
  async read(snapshot: FiscalSnapshotRecord): Promise<FiscalPaymentEvidence> {
    if (!await supportsFiscalOrderScope(this.prisma, snapshot)) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
    const envelope = readFiscalSnapshotEnvelope(snapshot.items);
    const intent = await this.prisma.fiscalIntent.findFirst({
      where: {
        merchantId: snapshot.merchantId,
        environment: snapshot.environment,
        snapshotId: snapshot.id,
      },
      select: { connectionId: true },
    });
    if (!intent || !snapshot.paymentProofRef)
      throw new Error("fiscal_original_payment_binding_required");
    const payment = await this.tenants.run(
      {
        merchantId: snapshot.orderMerchantId,
        userId: "fiscal-original-payment",
        role: "system",
      },
      async () =>
        await this.prisma.paymentIntent.findFirst({
          where: {
            id: snapshot.paymentProofRef!,
            merchantId: snapshot.orderMerchantId,
            sessionId: envelope.sessionId,
            status: "approved",
          },
        })
    );
    const original = (
      payment?.creation as {
        state?: string;
        input?: CreateProviderPaymentInput;
      } | null
    )?.input;
    if (
      !payment ||
      !original ||
      original.intentId !== payment.id ||
      original.merchantId !== payment.merchantId ||
      original.sessionId !== payment.sessionId ||
      original.amountCents !== payment.amountCents ||
      original.currency !== payment.currency ||
      original.method !== payment.method ||
      payment.approvedAmountCents !== payment.amountCents ||
      !payment.providerPaymentId ||
      !original.provider
    )
      throw new Error("fiscal_original_payment_binding_required");
    const setup = await this.setup.read(
      { merchantId: snapshot.merchantId, environment: snapshot.environment },
      intent.connectionId
    );
    if (!setup?.fiscalTimeZone)
      throw new Error("fiscal_payment_timezone_required");
    if (original.provider === "crypto") {
      const stored = payment.privateReceipt as PrivateCryptoReceipt | null;
      if (
        stored?.kind !== "crypto_v1" ||
        !stored.transfers?.length ||
        stored.transfers.map((r) => r.txHash).join(",") !==
          payment.providerPaymentId
      )
        throw new Error("fiscal_crypto_receipt_required");
      const accountId = fiscalCryptoAccountFingerprint(stored.quote);
      const environment = stored.quote.evmNetwork;
      const expected =
        snapshot.environment === "production" ? "mainnet" : "testnet";
      if (environment !== expected)
        throw new Error("fiscal_payment_environment_mismatch");
      const configuration = setup.paymentConfigurations?.find(
        (c) =>
          c.provider === "crypto" &&
          c.accountFingerprint === accountId &&
          c.environment === environment
      );
      if (!configuration?.cryptoDescription)
        throw new Error("fiscal_payment_crypto_classification_required");
      let receipt = stored;
      if (stored.transfers.some((t) => !t.occurredAt)) {
        try {
          if (!this.provider.enrichCryptoReceipt) throw new Error("missing");
          receipt = await this.provider.enrichCryptoReceipt(stored);
        } catch {
          throw Object.assign(
            new Error("fiscal_crypto_payment_time_unavailable"),
            { retryable: true }
          );
        }
      }
      if (
        receipt.transfers.some(
          (t) => !t.occurredAt || !Number.isFinite(Date.parse(t.occurredAt))
        )
      )
        throw new Error("fiscal_crypto_payment_time_unavailable");
      const paidAt = new Date(
        Math.max(...receipt.transfers.map((t) => Date.parse(t.occurredAt!)))
      ).toISOString();
      const binding = {
        merchantId: payment.merchantId,
        proofRef: payment.id,
        provider: "crypto",
        accountId,
        environment,
        operationId: payment.providerPaymentId,
        amountCents: payment.amountCents,
        currency: payment.currency,
      };
      return {
        binding,
        receipt: {
          ...binding,
          captured: true,
          instrument: "crypto",
          paidAt,
          fiscalDate: fiscalCalendarDate(paidAt, setup.fiscalTimeZone),
          fiscalTimeZone: setup.fiscalTimeZone,
          description: configuration.cryptoDescription,
          evidenceReference:
            "crypto:receipt:" +
            createHash("sha256")
              .update(payment.providerPaymentId)
              .digest("hex"),
        },
      };
    }
    if (!original.providerAccountFingerprint)
      throw new Error("fiscal_original_payment_binding_required");
    let receipt;
    try {
      if (!this.provider.readPaymentReceipt)
        throw new Error("payment_receipt_provider_contract_unsupported");
      receipt = await this.provider.readPaymentReceipt({
        original,
        merchantId: payment.merchantId,
        providerPaymentId: payment.providerPaymentId,
        provider: original.provider,
        providerAccountFingerprint: original.providerAccountFingerprint,
        settlementMode: original.settlementMode,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const code = /^payment_receipt_[a-z_]{1,90}$/.test(raw)
        ? "fiscal_" + raw
        : raw === "payment_provider_account_changed"
        ? "fiscal_original_payment_account_unavailable"
        : "fiscal_payment_receipt_query_failed";
      throw Object.assign(new Error(code), {
        retryable: /query_failed|time_unavailable/.test(code),
      });
    }
    const expected = snapshot.environment === "production" ? "live" : "test";
    if (
      receipt.environment !== expected
    )
      throw new Error("fiscal_payment_environment_mismatch");
    if (
      receipt.provider !== original.provider ||
      receipt.accountFingerprint !== original.providerAccountFingerprint ||
      receipt.operationId !== payment.providerPaymentId ||
      receipt.amountCents !== payment.amountCents ||
      receipt.currency !== payment.currency ||
      receipt.captured !== true
    )
      throw new Error("fiscal_payment_evidence_mismatch");
    const configuration = setup.paymentConfigurations?.find(
      (c) =>
        c.provider === receipt.provider &&
        c.accountFingerprint === receipt.accountFingerprint &&
        c.environment === receipt.environment
    );
    const electronic = receipt.instrument !== "boleto";
    if (electronic && !configuration?.acquirerTaxId)
      throw new Error("fiscal_payment_acquirer_configuration_required");
    const paidAt = fiscalProviderInstant(
      receipt.paidAt,
      configuration?.providerTimeZone
    );
    const brandCode = receipt.brand
      ? brands[receipt.brand.toLowerCase()]
      : undefined;
    if (["credit", "debit"].includes(receipt.instrument) && !brandCode)
      throw new Error("fiscal_payment_card_brand_unavailable");
    const binding = {
      merchantId: payment.merchantId,
      proofRef: payment.id,
      provider: receipt.provider,
      accountId: receipt.accountFingerprint,
      environment: receipt.environment,
      operationId: receipt.operationId,
      amountCents: receipt.amountCents,
      currency: receipt.currency,
    };
    return {
      binding,
      receipt: {
        ...binding,
        captured: true,
        instrument: receipt.instrument,
        paidAt,
        fiscalDate: fiscalCalendarDate(paidAt, setup.fiscalTimeZone),
        fiscalTimeZone: setup.fiscalTimeZone,
        ...(configuration?.acquirerTaxId
          ? { acquirerTaxId: configuration.acquirerTaxId }
          : {}),
        ...(receipt.authorizationCode
          ? { authorizationCode: receipt.authorizationCode }
          : {}),
        ...(receipt.authorizationKind
          ? { authorizationKind: receipt.authorizationKind }
          : {}),
        ...(receipt.nsu ? { nsu: receipt.nsu } : {}),
        ...(brandCode ? { brandCode } : {}),
        evidenceReference: receipt.evidenceReference,
      },
    };
  }
}
