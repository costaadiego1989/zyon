import { Injectable, Inject } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { MerchantStoreSettings } from "../../../merchant/domain/merchant.types.js";

export type StoreSettings = MerchantStoreSettings;

@Injectable()
export class GetStoreSettingsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<MerchantStoreSettings> {
    const row = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { storeSettings: true, name: true, users: { select: { email: true }, take: 1 } },
    });

    if (!row) return {};

    const stored = (row.storeSettings ?? {}) as MerchantStoreSettings;

    if (!stored.company?.razaoSocial && row.name) {
      stored.company = { ...stored.company, razaoSocial: row.name };
    }
    if (!stored.company?.email && row.users?.[0]?.email) {
      stored.company = { ...stored.company, email: row.users[0].email };
    }

    return stored;
  }
}
