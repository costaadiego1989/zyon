import type {
  PlatformOperatorAccessCommand,
} from "../../../platform-control/domain/platform-operator-access.js";
import type { PlatformOperatorRole } from "../../../platform-control/domain/platform-operator.js";

export const PLATFORM_OPERATOR_DIRECTORY_REPOSITORY = Symbol("PLATFORM_OPERATOR_DIRECTORY_REPOSITORY");

export type PlatformOperatorDirectoryStatus = "active" | "disabled";

export type PlatformOperatorDirectoryEntry = {
  id: string;
  email: string;
  role: PlatformOperatorRole;
  disabledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformOperatorDirectorySummary = {
  total: number;
  active: number;
  disabled: number;
};

export type PlatformOperatorDirectoryPage = {
  items: PlatformOperatorDirectoryEntry[];
  summary: PlatformOperatorDirectorySummary;
  nextCursor?: string;
};

export type PlatformOperatorDirectoryQuery = {
  query?: string;
  cursor?: string;
  limit: number;
  role?: PlatformOperatorRole;
  status?: PlatformOperatorDirectoryStatus;
};

export type PlatformOperatorDirectoryReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  returnedItems: number;
  totalOperators: number;
  limit: number;
  searchApplied: boolean;
  roleFilterApplied: boolean;
  statusFilterApplied: boolean;
};

export interface PlatformOperatorDirectoryRepository {
  list(input: PlatformOperatorDirectoryQuery): Promise<PlatformOperatorDirectoryPage>;
  recordRead(input: PlatformOperatorDirectoryReadAudit): Promise<void>;
  executeAccessCommand(input: PlatformOperatorAccessCommand): Promise<PlatformOperatorDirectoryEntry>;
}
