import { enqueueCanonicalPublicBusinessSources } from "../../graph-rag/infrastructure/public-business-write.js";
import { parsePublicSupportFaqItems } from "../public-support-knowledge.module.js";
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
    const row = await this.prisma.$transaction(async tx => {
      const merchantId = settings.merchantId;
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      const before = await tx.supportSetting.findUnique({ where: { merchantId }, select: { faqItems: true } });
      const previous = parsePublicSupportFaqItems(before?.faqItems);
      const saved = await tx.supportSetting.upsert({
        where: { merchantId },
        create: { merchantId, faqItems: settings.faqItems as unknown as Prisma.InputJsonValue },
        update: { faqItems: settings.faqItems as unknown as Prisma.InputJsonValue },
      });
      const current = parsePublicSupportFaqItems(saved.faqItems);
      await enqueueCanonicalPublicBusinessSources(tx, merchantId, [...previous, ...current].map(item => ({ sourceType: "faq" as const, sourceId: item.id })));
      // The legacy collection belongs to the existing FAQ reader. Unchanged
      // public content survives normalization/private-only churn; actual edits
      // retire its old promises even when legacy embedding is unavailable.
      if (!current.length || JSON.stringify(previous) !== JSON.stringify(current))
        await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "faq", sourceId: "faq-collection" } });
      return saved;
    });
    return {
      merchantId: row.merchantId,
      faqItems: row.faqItems as unknown as SupportFaqItem[],
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async delete(merchantId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      const before = await tx.supportSetting.findUnique({ where: { merchantId }, select: { faqItems: true } });
      const previous = parsePublicSupportFaqItems(before?.faqItems);
      await tx.supportSetting.deleteMany({ where: { merchantId } });
      await enqueueCanonicalPublicBusinessSources(tx, merchantId, previous.map(item => ({ sourceType: "faq" as const, sourceId: item.id })));
      await tx.knowledgeChunk.deleteMany({ where: { merchantId, sourceType: "faq", sourceId: "faq-collection" } });
    });
  }
}
