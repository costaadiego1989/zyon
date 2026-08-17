import { Injectable, Inject, Logger, BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { SeoSettings, GtmSettings } from "@zyon/shared-types";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";

export interface UpdateSeoInput {
  seo?: Partial<SeoSettings>;
  gtm?: Partial<GtmSettings>;
}

export interface UpdateSeoOutput {
  seo: SeoSettings;
  gtm: GtmSettings;
  updatedAt: Date;
}

@Injectable()
export class UpdateSeoSettingsUseCase {
  private readonly logger = new Logger(UpdateSeoSettingsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, input: UpdateSeoInput): Promise<UpdateSeoOutput> {
    this.validate(input);

    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true },
    });

    const existing = (row?.storeSettings ?? {}) as MerchantStoreSettings;

    const mergedSeo: SeoSettings = { ...existing.seo, ...input.seo };
    const mergedGtm: GtmSettings = {
      ...existing.gtm,
      ...input.gtm,
      pixelIds: { ...existing.gtm?.pixelIds, ...input.gtm?.pixelIds },
    };

    const updatedSettings: MerchantStoreSettings = {
      ...existing,
      seo: mergedSeo,
      gtm: mergedGtm,
    };

    const updated = await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: updatedSettings as unknown as object },
      select: { updatedAt: true },
    });

    this.logger.log(`SEO/GTM settings updated for merchant ${merchantId}`);

    return {
      seo: mergedSeo,
      gtm: mergedGtm,
      updatedAt: updated.updatedAt,
    };
  }

  private validate(input: UpdateSeoInput): void {
    const errors: string[] = [];

    if (input.seo) {
      if (input.seo.title && input.seo.title.length > 70) {
        errors.push("SEO title must be ≤70 characters");
      }
      if (input.seo.description && input.seo.description.length > 160) {
        errors.push("SEO description must be ≤160 characters");
      }
      if (input.seo.ogTitle && input.seo.ogTitle.length > 70) {
        errors.push("OG title must be ≤70 characters");
      }
      if (input.seo.ogDescription && input.seo.ogDescription.length > 160) {
        errors.push("OG description must be ≤160 characters");
      }
      if (input.seo.keywords && input.seo.keywords.length > 10) {
        errors.push("Keywords must have at most 10 items");
      }
      if (input.seo.twitterCard && !["summary", "summary_large_image"].includes(input.seo.twitterCard)) {
        errors.push("Twitter card must be 'summary' or 'summary_large_image'");
      }
    }

    if (input.gtm) {
      if (input.gtm.gtmId && !/^GTM-[A-Z0-9]+$/i.test(input.gtm.gtmId)) {
        errors.push("GTM ID must match format GTM-XXXXXX");
      }
      if (input.gtm.gaTrackingId && !/^G-[A-Z0-9]+$/i.test(input.gtm.gaTrackingId)) {
        errors.push("GA4 ID must match format G-XXXXXX");
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join("; "));
    }
  }
}
