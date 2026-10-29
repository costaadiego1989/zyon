import type { Prisma, PrismaClient } from "@prisma/client";
import type { SupportFaqItem, SupportSettings } from "@zyon/shared-types";
import type { SupportSettingsRepository } from "../domain/ports/support-settings-repository.port.js";

export class PrismaSupportSettingsRepository implements SupportSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(merchantId: string): Promise<SupportSettings | null> {
    const row = await this.prisma.supportSetting.findUnique({ where: { merchantId } });
    if (!row) return null;
    return {
      merchantId: row.merchantId,
      faqItems: row.faqItems as unknown as SupportFaqItem[],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(settings: SupportSettings): Promise<SupportSettings> {
    const row = await this.prisma.supportSetting.upsert({
      where: { merchantId: settings.merchantId },
      create: {
        merchantId: settings.merchantId,
        faqItems: settings.faqItems as unknown as Prisma.InputJsonValue,
      },
      update: {
        faqItems: settings.faqItems as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      merchantId: row.merchantId,
      faqItems: row.faqItems as unknown as SupportFaqItem[],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(merchantId: string): Promise<void> {
    await this.prisma.supportSetting.deleteMany({ where: { merchantId } });
  }
}
