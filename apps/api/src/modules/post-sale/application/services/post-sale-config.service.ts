import { Injectable, Inject, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";

/**
 * Resolved post-sale campaign configuration for a merchant.
 *
 * Source of truth: `merchant.storeSettings.postSaleCampaigns` (written by the
 * dashboard). This service applies platform defaults for any missing field so
 * the scheduling use-cases can gate deterministically. INV: every read is
 * scoped by merchant_id.
 */
export interface PostSaleCampaignConfig {
  followUpEnabled: boolean;
  reviewEnabled: boolean;
  reviewDelayDays: number;
  npsEnabled: boolean;
  npsDelayDays: number;
  crossSellEnabled: boolean;
  crossSellDelayDays: number;
  winBackEnabled: boolean;
  winBackThresholdDays: number;
  loyaltyEnabled: boolean;
  loyaltyMilestones: string;
  reorderEnabled: boolean;
}

export const DEFAULT_POST_SALE_CONFIG: PostSaleCampaignConfig = {
  followUpEnabled: true,
  reviewEnabled: true,
  reviewDelayDays: 3,
  npsEnabled: true,
  npsDelayDays: 7,
  crossSellEnabled: true,
  crossSellDelayDays: 5,
  winBackEnabled: false,
  winBackThresholdDays: 30,
  loyaltyEnabled: false,
  loyaltyMilestones: "3,5,10",
  reorderEnabled: false,
};

const NUMERIC_KEYS: ReadonlyArray<keyof PostSaleCampaignConfig> = [
  "reviewDelayDays",
  "npsDelayDays",
  "crossSellDelayDays",
  "winBackThresholdDays",
];

@Injectable()
export class PostSaleConfigService {
  private readonly logger = new Logger(PostSaleConfigService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /**
   * Read the merchant's post-sale campaign config, merged over defaults.
   * Never throws — on any error returns defaults so scheduling stays functional.
   */
  async getConfig(merchantId: string): Promise<PostSaleCampaignConfig> {
    try {
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { storeSettings: true },
      });
      const saved = (merchant?.storeSettings as Record<string, unknown> | null)?.[
        "postSaleCampaigns"
      ] as Partial<PostSaleCampaignConfig> | undefined;
      if (!saved) return { ...DEFAULT_POST_SALE_CONFIG };
      return this.merge(saved);
    } catch (err) {
      this.logger.warn(
        `Failed to load post-sale config for ${merchantId}, using defaults: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return { ...DEFAULT_POST_SALE_CONFIG };
    }
  }

  private merge(saved: Partial<PostSaleCampaignConfig>): PostSaleCampaignConfig {
    const merged: PostSaleCampaignConfig = { ...DEFAULT_POST_SALE_CONFIG, ...saved };
    // Coerce numeric fields; fall back to default when NaN / non-positive.
    for (const key of NUMERIC_KEYS) {
      const value = Number(merged[key]);
      if (!Number.isFinite(value) || value < 0) {
        (merged[key] as number) = DEFAULT_POST_SALE_CONFIG[key] as number;
      } else {
        (merged[key] as number) = value;
      }
    }
    return merged;
  }
}
