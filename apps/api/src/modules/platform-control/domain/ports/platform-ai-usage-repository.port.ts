import type { PlatformAiUsageMerchant } from "../platform-ai-usage.js";

export const PLATFORM_AI_USAGE_REPOSITORY = Symbol("PLATFORM_AI_USAGE_REPOSITORY");

export type PlatformAiUsageMerchantQuery = {
  from: Date;
  to: Date;
  limit: number;
};

export type PlatformAiUsageReadAudit = {
  actorOperatorId: string;
  correlationId: string;
  environment: string;
  from: Date;
  to: Date;
  limit: number;
  itemCount: number;
};

export interface PlatformAiUsageRepository {
  listByMerchant(input: PlatformAiUsageMerchantQuery): Promise<PlatformAiUsageMerchant[]>;
  recordRead(input: PlatformAiUsageReadAudit): Promise<void>;
}
