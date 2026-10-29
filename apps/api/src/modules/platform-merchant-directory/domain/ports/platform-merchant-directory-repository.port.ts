export const PLATFORM_MERCHANT_DIRECTORY_REPOSITORY = Symbol("PLATFORM_MERCHANT_DIRECTORY_REPOSITORY");

export type PlatformMerchantDirectoryEntry = {
  id: string;
  name: string;
  storeSlug?: string;
  storeCategory?: string;
  plan: "CHECKOUT_ONLY" | "STORE_ONLY" | "BOTH" | "API";
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PlatformMerchantDirectoryPage = {
  items: PlatformMerchantDirectoryEntry[];
  nextCursor?: string;
};

export type PlatformMerchantDirectoryQuery = {
  query?: string;
  cursor?: string;
  limit: number;
};

export type PlatformMerchantDirectoryReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  itemCount: number;
  limit: number;
  searchApplied: boolean;
};

export interface PlatformMerchantDirectoryRepository {
  list(input: PlatformMerchantDirectoryQuery): Promise<PlatformMerchantDirectoryPage>;
  recordRead(input: PlatformMerchantDirectoryReadAudit): Promise<void>;
}
