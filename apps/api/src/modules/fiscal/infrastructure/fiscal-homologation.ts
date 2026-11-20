import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { parseFiscalTestDatabaseUrl } from "../../../testing/fiscal-test-database.js";
import { FiscalCredentialCipher } from "./fiscal-credential-cipher.js";
import { FiscalSetupService } from "../application/fiscal-setup.service.js";
import { FiscalRuntimeConfiguration } from "./fiscal-runtime-configuration.js";
import { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "./prisma-fiscal-profile.repository.js";
import { fiscalProfileSupport } from "./fiscal-profile-support.js";
import { FiscalProviderFactory } from "./fiscal-provider.factory.js";
import { PrismaFiscalIssuanceStore } from "./prisma-fiscal-issuance.store.js";
import { FiscalIssuanceService } from "../application/fiscal-issuance.service.js";
import { FiscalReconciliationService } from "../application/fiscal-reconciliation.service.js";
import { FiscalStockEvidenceReader } from "./fiscal-stock-evidence.reader.js";
import { PrismaFiscalStockCoordinator } from "../../../shared/persistence/fiscal-stock-coordination.js";
import { FiscalWorker } from "./fiscal.worker.js";
import { FiscalArtifactStore } from "./fiscal-artifact.store.js";
import { FiscalDocumentService } from "../application/fiscal-document.service.js";
import { PrismaFiscalDocumentAccess } from "./prisma-fiscal-document.access.js";
import { FiscalDeliveryService } from "../application/fiscal-delivery.service.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import {
  admitFiscalPaymentEvidence,
  type FiscalPaymentEvidence,
} from "../domain/fiscal-payment-evidence.port.js";
import type { FiscalProvider } from "../domain/fiscal-provider.js";
export interface FiscalHomologationOperation {
  mode: "preflight" | "emit";
  provider: FiscalProvider;
  environment: "homologation";
  merchantId: string;
  intentId: string;
  schema: string;
  operationId: string;
}
export function homologationBindingHash(value: {
  schema: string;
  operationId: string;
  merchantId: string;
  intentId: string;
  reference: string;
  snapshotHash: string;
  paymentId: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        value.schema,
        value.operationId,
        value.merchantId,
        value.intentId,
        value.reference,
        value.snapshotHash,
        value.paymentId,
      ])
    )
    .digest("hex");
}
/** Private local composition only. It is never registered in AppModule or exposed through HTTP. */
export async function executeFiscalHomologation(
  prisma: PrismaClient,
  operation: FiscalHomologationOperation,
  options: {
    env?: NodeJS.ProcessEnv;
    fetcher?: typeof fetch;
    guard: (
      binding: {
        provider: FiscalProvider;
        reference: string;
        companyId?: string;
        verified: () => boolean;
      },
      transport?: typeof fetch
    ) => typeof fetch;
  }
) {
  const env = options.env ?? process.env;
  parseFiscalTestDatabaseUrl(env.FISCAL_TEST_DATABASE_URL);
  if (
    !["preflight", "emit"].includes(operation.mode) ||
    operation.environment !== "homologation" ||
    !/^(?:fiscal_test_|fiscal_hml_)[a-f0-9]{32}$/.test(operation.schema) ||
    !/^[a-f0-9]{32}$/.test(operation.operationId)
  )
    throw Error("fiscal_homologation_binding_invalid");
  const schema = await prisma.$queryRaw<
    Array<{ schema: string }>
  >`SELECT current_schema() AS schema`;
  if (schema[0]?.schema !== operation.schema)
    throw Error("fiscal_homologation_schema_mismatch");
  const scope = {
    merchantId: operation.merchantId,
    environment: "homologation" as const,
  };
  const intent = await prisma.fiscalIntent.findFirst({
    where: {
      ...scope,
      id: operation.intentId,
      connection: { provider: operation.provider },
    },
    include: {
      snapshot: { include: { completedOrder: true } },
      connection: true,
      profile: true,
    },
  });
  if (!intent) throw Error("fiscal_homologation_owned_operation_required");
  const snapshot = intent.snapshot,
    envelope = readFiscalSnapshotEnvelope(snapshot.items),
    connection = intent.connection;
  const payment = await prisma.paymentIntent.findFirst({
    where: {
      merchantId: snapshot.orderMerchantId,
      id: snapshot.paymentProofRef ?? "",
      sessionId: snapshot.completedOrder.sessionId,
      status: "approved",
    },
  });
  const receipt = payment?.privateReceipt as {
    kind?: string;
    operationId?: string;
    evidence?: FiscalPaymentEvidence;
  } | null;
  const marker = await prisma.fiscalEvent.findFirst({
    where: {
      ...scope,
      intentId: intent.id,
      actorKind: "local_homologation",
      actorId: operation.operationId,
      action: "homologation.prepared",
    },
  });
  const expected = homologationBindingHash({
    schema: operation.schema,
    operationId: operation.operationId,
    merchantId: scope.merchantId,
    intentId: intent.id,
    reference: intent.stableReference,
    snapshotHash: snapshot.contentHash,
    paymentId: snapshot.paymentProofRef ?? "",
  });
  const creation = payment?.creation as {
    kind?: string;
    operationId?: string;
  } | null;
  if (
    !marker ||
    marker.providerEvidenceRef !== expected ||
    !/^synthetic_nfe_[a-f0-9]{32}$/.test(intent.stableReference) ||
    !snapshot.orderId.startsWith("fiscal_hml_") ||
    receipt?.kind !== "fiscal_local_homologation_v1" ||
    receipt.operationId !== operation.operationId ||
    creation?.kind !== "local_homologation_setup" ||
    creation.operationId !== operation.operationId ||
    !receipt.evidence ||
    !payment ||
    payment.approvedAmountCents !== payment.amountCents ||
    payment.amountCents !== receipt.evidence.binding.amountCents ||
    payment.currency !== snapshot.currency
  )
    throw Error("fiscal_homologation_synthetic_payment_required");
  admitFiscalPaymentEvidence(snapshot, receipt.evidence);
  if (
    !connection.isActive ||
    !connection.activatedAt ||
    connection.disconnectedAt ||
    snapshot.completedAt < connection.activatedAt ||
    snapshot.completedAt.getTime() !==
      snapshot.completedOrder.completedAt.getTime()
  )
    throw Error("fiscal_homologation_activation_required");
  if (
    envelope.policy.emailOwner !== "zyon" ||
    envelope.policy.whatsappOwner !== "zyon" ||
    envelope.buyerContacts.email ||
    envelope.buyerContacts.phone
  )
    throw Error("fiscal_homologation_communications_forbidden");
  const profiles = new FiscalProfileService(
    new PrismaFiscalProfileRepository(prisma),
    fiscalProfileSupport
  );
  if (!profiles.readiness(intent.profile).ready)
    throw Error("fiscal_homologation_confirmed_profile_required");
  const cipher = new FiscalCredentialCipher(env),
    setup = new FiscalSetupService(prisma, cipher),
    savedSetup = await setup.read(scope, connection.id);
  const report = {
    provider: operation.provider,
    environment: "homologation",
    operationId: operation.operationId,
    issuerMasked: "**********" + connection.issuerTaxId.slice(-4),
    snapshotHash: snapshot.contentHash,
    customerCommunications: "disabled",
    financialPayment: "local_synthetic_only",
  };
  if (operation.mode === "preflight")
    return {
      code: 2,
      report: {
        ...report,
        status: "not_run",
        state: intent.state,
        reason: "authenticated_inspection_required",
      },
    };
  // Current ERP inspectors verify the company/grant, but their environment proof is responsible confirmation.
  // That is insufficient to authorize an external sandbox write. No documented effective-environment query is invented here.
  if (operation.provider !== "focus")
    return {
      code: 2,
      report: {
        ...report,
        status: "blocked",
        state: intent.state,
        reason: "fiscal_homologation_effective_provider_environment_unverified",
      },
    };
  if (
    ![
      "queued",
      "processing",
      "reconciliation_required",
      "authorized",
      "cancelled",
    ].includes(intent.state)
  )
    throw Error("fiscal_homologation_operation_not_runnable");
  let verified = false;
  const fetcher = options.guard(
    {
      provider: operation.provider,
      reference: intent.stableReference,
      companyId: savedSetup?.companyId,
      verified: () => verified,
    },
    options.fetcher
  );
  const configuration = new FiscalRuntimeConfiguration(
    prisma,
    cipher,
    setup,
    env,
    fetcher
  );
  const checks = await configuration.inspect(connection, "");
  if (!checks.length || checks.some((c) => c.status !== "verified"))
    return {
      code: 2,
      report: {
        ...report,
        status: "blocked",
        state: intent.state,
        reason: "fiscal_homologation_account_not_verified",
        pending: checks
          .filter((c) => c.status !== "verified")
          .map((c) => c.code),
      },
    };
  verified = true;
  const factory = new FiscalProviderFactory({
    credential: (s) => configuration.credentials.credential(s),
    authorization: { read: (s) => configuration.credentials.authorization(s) },
    accountEvidence: configuration.accountEvidence,
    policyVersion: (context) =>
      (context.profile.itemRules as { policyVersion?: string }).policyVersion ??
      "",
    fetch: fetcher,
  });
  const store = new PrismaFiscalIssuanceStore(
      prisma,
      () => new Date(),
      profiles
    ),
    stock = new PrismaFiscalStockCoordinator(prisma);
  const issuance = new FiscalIssuanceService(store, factory, {
    read: async (value) =>
      value.id === snapshot.id &&
      value.merchantId === scope.merchantId &&
      value.environment === "homologation" &&
      value.contentHash === snapshot.contentHash
        ? receipt.evidence!
        : null,
  });
  const reconciliation = new FiscalReconciliationService(
    store,
    factory,
    new FiscalStockEvidenceReader({
      credential: (s) => configuration.credentials.credential(s),
      olistOrigin: (s) => configuration.stockOrigin(s),
      fetch: fetcher,
    }),
    stock
  );
  const artifacts = new FiscalArtifactStore(prisma),
    documents = new FiscalDocumentService(
      new PrismaFiscalDocumentAccess(prisma),
      artifacts,
      store,
      factory
    );
  // Neither sender has a network adapter or a send closure. This binding cannot message a customer.
  const deliveries = new FiscalDeliveryService(prisma, store, {
    email: {
      prepare: async () => ({
        ready: false,
        reasonCode: "fiscal_homologation_communications_disabled",
      }),
    },
    whatsapp: {
      prepare: async () => ({
        ready: false,
        reasonCode: "fiscal_homologation_communications_disabled",
      }),
    },
  });
  const recover = async () => {
    await documents.recover(scope, intent.id);
    await deliveries.dispatchAll(scope, intent.id);
  };
  const worker = new FiscalWorker(
    prisma,
    issuance,
    {
      run: async (claim) => {
        await reconciliation.run(claim);
        await recover();
      },
    },
    stock
  );
  await worker.runOnce(scope, intent.id);
  let current = await prisma.fiscalIntent.findFirstOrThrow({
    where: { ...scope, id: intent.id },
  });
  if (["processing", "reconciliation_required"].includes(current.state))
    await reconciliation.reconcile(scope, intent.id);
  current = await prisma.fiscalIntent.findFirstOrThrow({
    where: { ...scope, id: intent.id },
  });
  if (["authorized", "cancelled"].includes(current.state)) await recover();
  const document = await prisma.fiscalDocument.findFirst({
    where: { ...scope, intentId: intent.id },
    include: {
      artifacts: { select: { kind: true, sha256: true, size: true } },
    },
  });
  const complete =
    document?.state === "authorized" &&
    !!document.authorizationProtocol &&
    document.documentState === "available" &&
    document.artifacts.some((a) => a.kind === "xml") &&
    document.artifacts.some((a) => a.kind === "danfe");
  const evidenceMode = options.fetcher ? "local_contract" : "external";
  return {
    code: complete ? 0 : 3,
    report: {
      ...report,
      status: complete
        ? evidenceMode === "external"
          ? "sefaz_homologation_authorized"
          : "local_contract_authorized"
        : "pending",
      evidenceMode,
      state: current.state,
      documentState: document?.documentState ?? "document_pending",
      artifacts: document?.artifacts ?? [],
    },
  };
}
