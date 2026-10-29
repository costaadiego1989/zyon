import { Inject, Injectable } from "@nestjs/common";
import {
  PLATFORM_MERCHANT_DIRECTORY_REPOSITORY,
  type PlatformMerchantDirectoryReadAudit,
  type PlatformMerchantDirectoryRepository,
} from "../domain/ports/platform-merchant-directory-repository.port.js";

export type ListPlatformMerchantDirectoryInput = {
  query?: string;
  cursor?: string;
  limit?: string;
};

@Injectable()
export class ListPlatformMerchantDirectoryUseCase {
  constructor(
    @Inject(PLATFORM_MERCHANT_DIRECTORY_REPOSITORY)
    private readonly merchants: PlatformMerchantDirectoryRepository,
  ) {}

  async execute(
    input: ListPlatformMerchantDirectoryInput,
    audit: Omit<PlatformMerchantDirectoryReadAudit, "itemCount" | "limit" | "searchApplied">,
  ) {
    const query = normalizeQuery(input);
    const page = await this.merchants.list(query);
    await this.merchants.recordRead({
      ...audit,
      itemCount: page.items.length,
      limit: query.limit,
      searchApplied: Boolean(query.query),
    });
    return page;
  }
}

function normalizeQuery(input: ListPlatformMerchantDirectoryInput) {
  return {
    query: optionalText(input.query, "platform_merchants_invalid_query", 120),
    cursor: optionalText(input.cursor, "platform_merchants_invalid_cursor", 160),
    limit: pageSize(input.limit),
  };
}

function pageSize(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("platform_merchants_invalid_limit");
  return parsed;
}

function optionalText(value: string | undefined, code: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(code);
  return normalized;
}
