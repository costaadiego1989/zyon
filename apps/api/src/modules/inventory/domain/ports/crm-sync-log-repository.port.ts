export const CRM_SYNC_LOG_REPOSITORY = Symbol("CRM_SYNC_LOG_REPOSITORY");

export type CrmSyncStage = "lead" | "customer";
export type CrmSyncStatus = "success" | "failed";

export interface CrmSyncLogRow {
  id: string;
  merchantId: string;
  provider: string;
  email: string;
  stage: CrmSyncStage;
  status: CrmSyncStatus;
  errorCode: string | null;
  createdAt: Date;
}

export interface CrmSyncLogRepositoryPort {
  record(entry: {
    merchantId: string;
    provider: string;
    email: string;
    stage: CrmSyncStage;
    status: CrmSyncStatus;
    errorCode?: string;
  }): Promise<void>;

  list(merchantId: string, limit?: number): Promise<CrmSyncLogRow[]>;

  /** True if this merchant already has a lead-stage log row for the email. */
  hasLeadFor(merchantId: string, email: string): Promise<boolean>;
}
