import type { FiscalEnvironment, FiscalProvider, FiscalState } from "./fiscal-provider.js";

export interface FiscalTenant { merchantId: string; environment: FiscalEnvironment }
export interface FiscalActor { actorKind: string; actorId?: string }
export interface FiscalEventInput extends FiscalActor {
  action: string; previousState?: string; nextState?: string; safeReasonCode?: string; providerEvidenceRef?: string;
}
export interface FiscalIntentInput extends FiscalTenant {
  orderId: string; operation: "sale"; connectionId: string; profileVersionId: string; snapshotId: string;
  stableReference: string; state: FiscalState;
}
export interface FiscalIntentRecord extends Omit<FiscalIntentInput, "operation" | "state"> {
  id: string; operation: string; state: string; remoteOrderId: string | null; remoteInvoiceId: string | null;
  writeStage: string | null; writeStartedAt: Date | null; attempts: number; nextAttemptAt: Date;
  leaseUntil: Date | null; leaseToken: string | null; version: number; lastErrorCode: string | null;
}
export interface FiscalClaimPatch {
  state?: FiscalState; remoteOrderId?: string; remoteInvoiceId?: string; writeStage?: string | null;
  writeStartedAt?: Date | null; nextAttemptAt?: Date; lastErrorCode?: string | null; leaseUntil?: Date | null;
}
export interface FiscalHistoryRecord extends FiscalTenant {
  id: string; intentId: string; actorKind: string; actorId: string | null; action: string;
  previousState: string | null; nextState: string | null; safeReasonCode: string | null;
  providerEvidenceRef: string | null; occurredAt: Date; orderId: string; provider: FiscalProvider;
}
export interface FiscalListQuery { search?: string; state?: string; page?: number; pageSize?: number }
export interface FiscalListResult {
  items: { id: string; orderId: string; recipientName: string; provider: FiscalProvider; state: string;
    deliveries: { channel: string; state: string }[] }[];
  total: number; counts: Record<string, number>; page: number; pageSize: number;
}
export interface FiscalRepositoryPort {
  transaction<T>(work: (repository: FiscalRepositoryPort) => Promise<T>): Promise<T>;
  createIntent(input: FiscalIntentInput, actor: FiscalActor): Promise<FiscalIntentRecord>;
  findIntent(scope: FiscalTenant, id: string): Promise<FiscalIntentRecord | null>;
  claim(scope: FiscalTenant, now: Date, leaseMs: number): Promise<FiscalIntentRecord | null>;
  updateClaim(scope: FiscalTenant, id: string, token: string, version: number, now: Date, patch: FiscalClaimPatch, event: FiscalEventInput): Promise<boolean>;
  history(scope: FiscalTenant, id: string): Promise<FiscalHistoryRecord[]>;
  list(scope: FiscalTenant, query: FiscalListQuery): Promise<FiscalListResult>;
}
