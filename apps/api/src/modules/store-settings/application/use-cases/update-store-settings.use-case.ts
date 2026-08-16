import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";

export type StoreSettings = MerchantStoreSettings;

@Injectable()
export class UpdateStoreSettingsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, settings: MerchantStoreSettings): Promise<MerchantStoreSettings> {
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { storeSettings: settings as unknown as object },
    });

    return settings;
  }
}
