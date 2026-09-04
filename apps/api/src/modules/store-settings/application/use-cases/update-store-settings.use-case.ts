import { Injectable, Inject, Logger, ConflictException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";
import { slugify } from "../../../../shared/utils/slugify.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type StoreSettings = MerchantStoreSettings;

@Injectable()
export class UpdateStoreSettingsUseCase {
  private readonly logger = new Logger(UpdateStoreSettingsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, settings: MerchantStoreSettings): Promise<MerchantStoreSettings> {
    // Validate and normalize slug if provided
    if (settings.slug) {
      settings.slug = slugify(settings.slug);

      // Check uniqueness (another merchant can't have the same slug)
      const taken = await this.prisma.merchant.findFirst({
        where: {
          id: { not: merchantId },
          storeSettings: { path: ["slug"], equals: settings.slug },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException("slug_already_taken");
      }
    }

    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: settings as unknown as object },
    });

    return settings;
  }
}
