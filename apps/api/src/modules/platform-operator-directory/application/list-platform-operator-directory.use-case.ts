import { Inject, Injectable } from "@nestjs/common";
import {
  isPlatformOperatorRole,
  platformPermissionsForRole,
  type PlatformOperatorRole,
} from "../../platform-control/domain/platform-operator.js";
import {
  PLATFORM_OPERATOR_DIRECTORY_REPOSITORY,
  type PlatformOperatorDirectoryReadAudit,
  type PlatformOperatorDirectoryRepository,
  type PlatformOperatorDirectoryStatus,
} from "../domain/ports/platform-operator-directory-repository.port.js";

export type ListPlatformOperatorDirectoryInput = {
  query?: unknown;
  cursor?: unknown;
  limit?: unknown;
  role?: unknown;
  status?: unknown;
};

type ReadAuditContext = Omit<
  PlatformOperatorDirectoryReadAudit,
  "returnedItems" | "totalOperators" | "limit" | "searchApplied" | "roleFilterApplied" | "statusFilterApplied"
>;

@Injectable()
export class ListPlatformOperatorDirectoryUseCase {
  constructor(
    @Inject(PLATFORM_OPERATOR_DIRECTORY_REPOSITORY)
    private readonly operators: PlatformOperatorDirectoryRepository,
  ) {}

  async execute(input: ListPlatformOperatorDirectoryInput, audit: ReadAuditContext) {
    const query = normalizeQuery(input);
    const page = await this.operators.list(query);
    await this.operators.recordRead({
      ...audit,
      returnedItems: page.items.length,
      totalOperators: page.summary.total,
      limit: query.limit,
      searchApplied: Boolean(query.query),
      roleFilterApplied: Boolean(query.role),
      statusFilterApplied: Boolean(query.status),
    });
    return {
      ...page,
      items: page.items.map(item => ({
        ...item,
        permissions: platformPermissionsForRole(item.role),
      })),
    };
  }
}

function normalizeQuery(input: ListPlatformOperatorDirectoryInput) {
  const role = optionalRole(input.role);
  const status = optionalStatus(input.status);
  return {
    query: optionalText(input.query, "platform_operators_invalid_query", 120),
    cursor: optionalCursor(input.cursor),
    limit: pageSize(input.limit),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
  };
}

function pageSize(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]\d?|100)$/.test(value)) {
    throw new Error("platform_operators_invalid_limit");
  }
  return Number(value);
}

function optionalText(value: unknown, code: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new Error("platform_operators_invalid_cursor");
  }
  return value;
}

function optionalRole(value: unknown): PlatformOperatorRole | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !isPlatformOperatorRole(value)) {
    throw new Error("platform_operators_invalid_role");
  }
  return value;
}

function optionalStatus(value: unknown): PlatformOperatorDirectoryStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (value !== "active" && value !== "disabled") {
    throw new Error("platform_operators_invalid_status");
  }
  return value;
}
