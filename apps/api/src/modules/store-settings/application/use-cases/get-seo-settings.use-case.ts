import { Injectable, Inject, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { SeoSettings, GtmSettings } from "@zyon/shared-types";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";

export interface SeoGtmConfig {
  seo: SeoSettings;
  gtm: GtmSettings;
  lastUpdatedAt: Date | null;
}

@Injectable()
export class GetSeoSettingsUseCase {
  private readonly logger = new Logger(GetSeoSettingsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<SeoGtmConfig> {
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true, updatedAt: true },
    });

    if (!row) {
      return { seo: {}, gtm: {}, lastUpdatedAt: null };
    }

    const stored = (row.storeSettings ?? {}) as MerchantStoreSettings;

    return {
      seo: stored.seo ?? {},
      gtm: stored.gtm ?? {},
      lastUpdatedAt: row.updatedAt ?? null,
    };
  }
}
