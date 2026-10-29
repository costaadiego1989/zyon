import type { PlatformAuditCursor, PlatformAuditEvent } from "../platform-audit.js";

export const PLATFORM_AUDIT_REPOSITORY = Symbol("PLATFORM_AUDIT_REPOSITORY");

export type PlatformAuditQuery = {
  cursor?: PlatformAuditCursor;
  limit: number;
  action?: string;
  actorOperatorId?: string;
  from?: Date;
  to?: Date;
};

export type PlatformAuditPage = {
  items: PlatformAuditEvent[];
  nextCursor?: PlatformAuditCursor;
};

export type PlatformAuditReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  returnedItems: number;
  limit: number;
  actionFilterApplied: boolean;
  actorFilterApplied: boolean;
  dateRangeApplied: boolean;
  cursorApplied: boolean;
};

export interface PlatformAuditRepository {
  list(input: PlatformAuditQuery): Promise<PlatformAuditPage>;
  recordRead(input: PlatformAuditReadAudit): Promise<void>;
}
