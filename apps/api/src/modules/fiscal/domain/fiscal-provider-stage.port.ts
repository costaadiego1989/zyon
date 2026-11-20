import type { FiscalIdentity } from "./fiscal-provider.js";

export type FiscalProviderStage = "contact.create" | "order.create" | "invoice.generate" | "invoice.validate" | "invoice.submit" | "invoice.cancel";
/** Only redacted entity IDs/results. Never store credentials or the provider's fiscal body here. */
export interface FiscalProviderStageRecord {
  identity: FiscalIdentity; stage: FiscalProviderStage; reference: string;
  outcome: "started" | "accepted" | "unknown" | "not_accepted";
  payloadHash?: string; remoteId?: string; relatedIds?: Readonly<Record<string, string>>; reasonCode?: string;
}
export interface FiscalProviderStageJournal {
  /** Read-only lease/version admission before compound-stage discovery IO; begin still fences every write. */
  check(identity: FiscalIdentity, stage?: FiscalProviderStage): Promise<boolean>;
  read(identity: FiscalIdentity, stage: FiscalProviderStage): Promise<FiscalProviderStageRecord | null>;
  /** Persist write_started atomically under the current claim/lease/version and unique identity+stage.
   * Refuse a second started/unknown/accepted operation. false means ZERO provider write IO. */
  begin(record: FiscalProviderStageRecord): Promise<boolean>;
  /** Fenced update; false leaves the result uncertain even when the provider accepted it. */
  finish(record: FiscalProviderStageRecord): Promise<boolean>;
}
export type FiscalStageQueryResult = { found: false } | { found: true; remoteId: string; relatedIds?: Readonly<Record<string, string>> };
export interface FiscalStageReconciliationPort {
  /** Query the SAME entity (contact/order/invoice). An invoice404 never clears a contact/order stage. */
  reconcileStage(identity: FiscalIdentity, record: FiscalProviderStageRecord): Promise<FiscalStageQueryResult>;
}
