import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { RECOVERY_TEMPLATE_DEFAULTS, prepareRecoveryWhatsApp, type RecoveryTemplateEdit } from "../../domain/recovery-template-content.js";
import type { RecoveryLifecycleRecord, RecoveryLifecycleRepository } from "../../domain/ports/recovery-template-lifecycle.port.js";

@Injectable()
export class PrismaRecoveryTemplateLifecycleRepository implements RecoveryLifecycleRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async ensure(merchantId: string): Promise<void> {
    const prepared = prepareRecoveryWhatsApp(RECOVERY_TEMPLATE_DEFAULTS.whatsapp.body);
    await this.prisma.$transaction(async (tx: any) => {
      for (const channel of ["email", "whatsapp"] as const) {
        await tx.postSaleMessageTemplate.upsert({
          where: { merchantId_type_channel: { merchantId, type: "cart_recovery", channel } },
          update: {},
          create: {
            merchantId, type: "cart_recovery", channel, name: "Recuperação de carrinho",
            body: RECOVERY_TEMPLATE_DEFAULTS[channel].body,
            subject: channel === "email" ? RECOVERY_TEMPLATE_DEFAULTS.email.subject : null,
            ...(channel === "whatsapp" ? { metaCategory: "MARKETING", metaLanguage: "pt_BR", metaTemplateBody: prepared.metaBody, metaVariableMap: prepared.variableMap } : {}),
          },
        });
      }
    });
  }

  async read(merchantId: string) {
    const rows = await (this.prisma as any).postSaleMessageTemplate.findMany({ where: { merchantId, type: "cart_recovery" } }) as RecoveryLifecycleRecord[];
    const email = rows.find(r => r.channel === "email");
    const whatsapp = rows.find(r => r.channel === "whatsapp");
    if (!email || !whatsapp) throw new Error("recovery_templates_not_initialized");
    return { email, whatsapp };
  }

  async save(merchantId: string, input: RecoveryTemplateEdit): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const where = { merchantId, type: "cart_recovery", channel: "whatsapp", metaRevision: input.whatsapp.revision };
      const current = await tx.postSaleMessageTemplate.findFirst({ where }) as RecoveryLifecycleRecord | null;
      if (!current) throw new ConflictException("template_revision_conflict");
      if (current.metaStatus === "submitting") throw new ConflictException("template_submission_in_progress");
      const changed = current.body !== input.whatsapp.body;
      const prepared = prepareRecoveryWhatsApp(input.whatsapp.body);
      const result = await tx.postSaleMessageTemplate.updateMany({ where: { ...where, metaStatus: current.metaStatus }, data: changed ? {
        body: input.whatsapp.body, metaTemplateBody: prepared.metaBody, metaVariableMap: prepared.variableMap,
        metaCategory: "MARKETING", metaLanguage: "pt_BR", metaRevision: { increment: 1 },
        metaStatus: "draft", twilioContentSid: null, metaRejectionReason: null,
        metaLastCheckedAt: null, metaClaimToken: null, metaNextCheckAt: new Date(), updatedAt: new Date(),
      } : { metaRevision: { increment: 1 }, updatedAt: new Date() } });
      if (result.count !== 1) throw new ConflictException("template_revision_conflict");
      await tx.postSaleMessageTemplate.update({
        where: { merchantId_type_channel: { merchantId, type: "cart_recovery", channel: "email" } },
        data: { body: input.email.body, subject: input.email.subject },
      });
    });
  }

  async due(now: Date): Promise<RecoveryLifecycleRecord[]> {
    return (this.prisma as any).postSaleMessageTemplate.findMany({
      where: { type: "cart_recovery", channel: "whatsapp", isActive: true, metaNextCheckAt: { lte: now } },
      orderBy: [{ metaNextCheckAt: "asc" }, { id: "asc" }], take: 50,
    });
  }

  async claim(record: RecoveryLifecycleRecord, now: Date, submitting: boolean): Promise<boolean> {
    const token = randomUUID();
    const result = await (this.prisma as any).postSaleMessageTemplate.updateMany({
      where: { id: record.id, merchantId: record.merchantId, metaRevision: record.metaRevision, metaStatus: record.metaStatus, metaNextCheckAt: record.metaNextCheckAt },
      data: { metaClaimToken: token, metaNextCheckAt: new Date(now.getTime() + 5 * 60_000), ...(submitting ? { metaStatus: "submitting" } : {}) },
    });
    if (result.count === 1) record.metaClaimToken = token;
    return result.count === 1;
  }

  async complete(record: RecoveryLifecycleRecord, patch: { status: string; contentSid?: string | null; reason?: string | null; checkedAt?: Date; nextCheckAt: Date | null }, submitting: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const result = await tx.postSaleMessageTemplate.updateMany({
        where: { id: record.id, merchantId: record.merchantId, metaRevision: record.metaRevision, metaClaimToken: record.metaClaimToken, metaStatus: submitting ? "submitting" : record.metaStatus, twilioContentSid: record.twilioContentSid },
        data: { metaStatus: patch.status, twilioContentSid: patch.contentSid, metaRejectionReason: patch.reason,
          metaLastCheckedAt: patch.checkedAt, metaNextCheckAt: patch.nextCheckAt, metaClaimToken: null },
      });
      if (result.count !== 1 || patch.status === record.metaStatus || !["approved", "rejected", "paused", "disabled"].includes(patch.status)) return;
      const approved = patch.status === "approved";
      await tx.merchantNotification.create({ data: {
        id: randomUUID(), merchantId: record.merchantId, type: "cart_recovery_template_status",
        title: approved ? `Template de recuperação: versão ${record.metaRevision} aprovada` : `Template de recuperação: atualização da versão ${record.metaRevision}`,
        body: approved ? `A Meta aprovou a versão ${record.metaRevision}. Consulte o estado atual no Cart Recovery; edições posteriores exigem nova aprovação.`
          : `A versão ${record.metaRevision} ficou indisponível para envio no WhatsApp. A recuperação continua por e-mail quando autorizado. Consulte o estado atual no Cart Recovery.`,
        metadata: { revision: record.metaRevision, status: patch.status, contentSid: patch.contentSid ?? record.twilioContentSid, emailStatus: "pending", path: "/cart-recovery" },
      } });
    });
  }

  async seedMerchantPage(afterId?: string): Promise<string | undefined> {
    const merchants = await (this.prisma as any).merchant.findMany({ where: afterId ? { id: { gt: afterId } } : {}, orderBy: { id: "asc" }, take: 50, select: { id: true } }) as { id: string }[];
    for (const merchant of merchants) await this.ensure(merchant.id);
    return merchants.length === 50 ? merchants.at(-1)?.id : undefined;
  }
}
