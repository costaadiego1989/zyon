import { Injectable, Inject , Logger} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";
import { mapCompanySettings } from "../../../merchant/application/company-settings.mapper.js";

export type StoreSettings = MerchantStoreSettings;

@Injectable()
export class GetStoreSettingsUseCase {
  private readonly logger = new Logger(GetStoreSettingsUseCase.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<MerchantStoreSettings> {
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true, name: true, businessMode: true },
    });

    if (!row) return {};

    const stored = (row.storeSettings ?? {}) as MerchantStoreSettings;

    return { ...stored, company: mapCompanySettings(stored.company, row.name, row.businessMode) };
  }
}
