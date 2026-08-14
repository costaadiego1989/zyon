import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { StoreSettings } from "./get-store-settings.use-case.js";

export type { StoreSettings };

@Injectable()
export class UpdateStoreSettingsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, settings: StoreSettings): Promise<StoreSettings> {
    const theme = {
      logo: settings.brand?.logo ?? null,
      primary: settings.brand?.colors?.primary ?? null,
      secondary: settings.brand?.colors?.secondary ?? null,
      heading: settings.brand?.fonts?.heading ?? null,
      body: settings.brand?.fonts?.body ?? null,
      primaryDomain: settings.domain?.primary ?? null,
      customDomains: settings.domain?.custom ?? [],
      currency: settings.currency ?? "BRL",
    };

    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: { theme },
    });

    return settings;
  }
}
