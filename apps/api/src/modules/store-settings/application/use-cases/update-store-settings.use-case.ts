import { Injectable, Inject, Logger, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";
import { slugify } from "../../../../shared/utils/slugify.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { selectInitialBusinessMode } from "../../../merchant/application/initial-business-mode-selection.js";
import { normalizeCompanySettingsPatch, mergeCompanySettingsPatch, enqueueCompanySettingsWork, assertCompanyServiceNamesMode } from "../../../merchant/application/company-settings-write.js";
import { mapCompanySettings } from "../../../merchant/application/company-settings.mapper.js";

export type StoreSettings = MerchantStoreSettings;

@Injectable()
export class UpdateStoreSettingsUseCase {
  private readonly logger = new Logger(UpdateStoreSettingsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, settings: MerchantStoreSettings): Promise<MerchantStoreSettings> {
    settings = normalizeCompanySettingsPatch(settings) as MerchantStoreSettings;
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
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
        const current = await tx.merchant.findUnique({ where: { id: merchantId }, select: { storeSettings: true, businessMode: true } });
        if (!current) throw new NotFoundException("merchant_not_found");
        const storedSettings = mergeCompanySettingsPatch(current.storeSettings, incoming);
        await selectInitialBusinessMode(tx, merchantId, incoming);
        const selected = await tx.merchant.findUnique({ where: { id: merchantId }, select: { businessMode: true } });
        if (!selected) throw new NotFoundException("merchant_not_found");
        assertCompanyServiceNamesMode(incoming, selected.businessMode);
        await tx.merchant.update({ where: { id: merchantId }, data: {
          storeSettings: storedSettings as Prisma.InputJsonObject, ...(settings.slug ? { storeSlug: settings.slug } : {}),
        } });
        await enqueueCompanySettingsWork(tx, merchantId, current.storeSettings, storedSettings, current.businessMode, selected.businessMode);
        return { ...storedSettings, company: mapCompanySettings(storedSettings.company, undefined, selected.businessMode) } as MerchantStoreSettings;
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("slug_already_taken");
      }
      throw error;
    }

  }
}
