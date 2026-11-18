import type { FiscalConnection, FiscalIntent, FiscalIssuanceRevision, FiscalProfileVersion, FiscalSaleSnapshot } from "@prisma/client";
import type { FiscalIdentity, FiscalProviderPort } from "./fiscal-provider.js";
import type { FiscalAdmittedPayment } from "./fiscal-payment-evidence.port.js";
import type { FiscalProviderStageJournal, FiscalStageReconciliationPort } from "./fiscal-provider-stage.port.js";
import type { FiscalSnapshotEnvelope } from "./fiscal-sale-snapshot.port.js";
export interface FiscalIssuanceContext {
  intent: FiscalIntent; identity: FiscalIdentity; connection: FiscalConnection; profile: FiscalProfileVersion;
  snapshot: FiscalSaleSnapshot; envelope: FiscalSnapshotEnvelope; orderScopeSupported: boolean;
}
export type FiscalIssuanceProvider = FiscalProviderPort & FiscalStageReconciliationPort;
export interface FiscalProviderFactoryPort {
  build(context: FiscalIssuanceContext, issuedAt: string, payment: FiscalAdmittedPayment): Readonly<Record<string, unknown>>;
  create(context: FiscalIssuanceContext, payload: Readonly<Record<string, unknown>>, journal: FiscalProviderStageJournal): FiscalIssuanceProvider;
}
export type FiscalRevision = FiscalIssuanceRevision;

export interface FiscalIssuanceSessionPort {
  context: FiscalIssuanceContext; journal: FiscalProviderStageJournal;
  revision(): Promise<FiscalIssuanceRevision | null>;
  providerEmailRequest(): Promise<ReturnType<typeof import("./fiscal-provider-email.js").restoreFiscalProviderEmailRequest>>;
  freeze(payload: Readonly<Record<string, unknown>>, payment: import("./fiscal-payment-evidence.port.js").FiscalPaymentEvidence, issuedAt?: string): Promise<FiscalIssuanceRevision>;
  pending(state: import("./fiscal-provider.js").FiscalState, reason: string, delay?: number): Promise<boolean>;
  persist(receipt: import("./fiscal-provider.js").FiscalSubmissionResult, stockEvidence?: import("./fiscal-stock-evidence.port.js").FiscalStockEffectEvidence, pendingReason?: string): Promise<boolean>;
  finishRead(reason?: string, delay?: number): Promise<boolean>;
  releaseEvidence(): Promise<string | null>;
  stages(): Promise<(import("./fiscal-provider-stage.port.js").FiscalProviderStageRecord | null)[]>;
}
export interface FiscalIssuanceStorePort {
  clock(): Date;
  readOnly(scope: import("./fiscal-repository.port.js").FiscalTenant, id: string): Promise<FiscalIssuanceSessionPort>;
  claimForQuery(scope: import("./fiscal-repository.port.js").FiscalTenant, id: string): Promise<import("./fiscal-repository.port.js").FiscalIntentRecord | null>;
  claimForCancellation(scope: import("./fiscal-repository.port.js").FiscalTenant, id: string, reviewId: string, confirmation: { actorId: string; justification: string }): Promise<import("./fiscal-repository.port.js").FiscalIntentRecord | null>;
  open(claim: import("./fiscal-repository.port.js").FiscalIntentRecord): Promise<FiscalIssuanceSessionPort>;
  reprocess(scope: import("./fiscal-repository.port.js").FiscalTenant, id: string, profileId: string, actor: { actorKind: string; actorId: string; permission: string }): Promise<void>;
}
