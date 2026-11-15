import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PUBLIC_SUPPORT_FAQ, type PublicSupportFaqPort } from "./domain/ports/public-support-faq.port.js";

const faq = z.object({ id: z.string().max(191).optional(), question: z.string().trim().min(1).max(3000),
  answer: z.string().trim().min(1).max(4000) });
export function parsePublicSupportFaqItems(value: unknown) {
  return z.array(faq).max(100).parse(value ?? []).map(item => ({
    id: item.id || createHash("sha256").update(item.question).digest("hex"), question: item.question, answer: item.answer,
  }));
}
/** Separate persistence boundary: importing public FAQs must not import chat or KB. */
export class PrismaPublicSupportFaq implements PublicSupportFaqPort {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => number = Date.now) {}
  async snapshot(merchantId: string) {
    const row = await this.prisma.supportSetting.findUnique({ where: { merchantId },
      select: { merchantId: true, updatedAt: true, faqItems: true } });
    if (row && row.merchantId !== merchantId) throw new Error("public_faq_scope_mismatch");
    const items = parsePublicSupportFaqItems(row?.faqItems);
    return { merchantId, version: row?.updatedAt.getTime() ?? this.clock(), items };
  }
}
@Module({ imports: [PersistenceModule], providers: [{ provide: PUBLIC_SUPPORT_FAQ,
  useFactory: (prisma: PrismaClient) => new PrismaPublicSupportFaq(prisma), inject: [PRISMA_CLIENT] }], exports: [PUBLIC_SUPPORT_FAQ] })
export class PublicSupportKnowledgeModule {}
