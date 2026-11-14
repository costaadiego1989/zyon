import { Injectable, Inject, Logger, ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";
import { slugify } from "../../../../shared/utils/slugify.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { isInitialBusinessSelectionWrite, selectInitialBusinessMode } from "../../../merchant/application/initial-business-mode-selection.js";

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
        where: { id: { not: merchantId }, storeSlug: settings.slug },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException("slug_already_taken");
      }
    }

    try {
      const incoming = settings as unknown as Record<string, unknown>;
      const { business_mode: _mode, ...storedSettings } = incoming;
      const update = {
        where: { id: merchantId },
        data: { storeSettings: storedSettings as object, ...(settings.slug ? { storeSlug: settings.slug } : {}) },
      };
      if (isInitialBusinessSelectionWrite(incoming)) await this.prisma.$transaction(async tx => {
        await selectInitialBusinessMode(tx, merchantId, incoming);
        await tx.merchant.update(update);
      });
      else await this.prisma.merchant.update(update);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("slug_already_taken");
      }
      throw error;
    }

    return settings;
  }
}
