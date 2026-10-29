import { prepareSalesWhatsApp, salesDefaults, salesTemplateType } from "../../domain/sales-template-content.js";
import { buildCatalog } from "../../domain/catalog/template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
import type { ApprovedTemplateVersion } from "../../domain/ports/whatsapp-template-repository.port.js";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { type RecoveryTemplateEdit } from "../../domain/recovery-template-content.js";
import type { RecoveryLifecycleRecord, RecoveryLifecycleRepository } from "../../domain/ports/recovery-template-lifecycle.port.js";

@Injectable()
export class PrismaRecoveryTemplateLifecycleRepository implements RecoveryLifecycleRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async ensure(merchantId: string, type = "cart_recovery"): Promise<void> {
    const defaults = salesDefaults(type);
    const prepared = prepareSalesWhatsApp(type, defaults.whatsapp.body);
    await this.prisma.$transaction(async (tx: any) => {
      for (const channel of ["email", "whatsapp"] as const) {
        await tx.postSaleMessageTemplate.createMany({
          skipDuplicates: true,
          data: {
            merchantId, type, channel, name: buildCatalog()[salesTemplateType(type)].label,
            body: defaults[channel].body,
            subject: channel === "email" ? defaults.email.subject : null,
            ...(channel === "whatsapp" ? { metaCategory: prepared.category, metaLanguage: "pt_BR", metaTemplateBody: prepared.metaBody, metaVariableMap: prepared.variableMap } : {}),
          },
        });
      }
    });
  }

  async read(merchantId: string, type = "cart_recovery") {
    const rows = await (this.prisma as any).postSaleMessageTemplate.findMany({ where: { merchantId, type: salesTemplateType(type) } }) as RecoveryLifecycleRecord[];
    const email = rows.find(r => r.channel === "email");
    const whatsapp = rows.find(r => r.channel === "whatsapp");
    if (!email || !whatsapp) throw new Error("recovery_templates_not_initialized");
    return { email, whatsapp };
  }

  async save(merchantId: string, input: RecoveryTemplateEdit, type = "cart_recovery"): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const where = { merchantId, type, channel: "whatsapp", metaRevision: input.whatsapp.revision };
      const current = await tx.postSaleMessageTemplate.findFirst({ where }) as RecoveryLifecycleRecord | null;
      if (!current) throw new ConflictException("template_revision_conflict");
      if (current.metaStatus === "submitting") throw new ConflictException("template_submission_in_progress");
      const changed = current.body !== input.whatsapp.body;
      const prepared = prepareSalesWhatsApp(type, input.whatsapp.body);
      const history = [...(current.metaApprovedVersions ?? [])];
      if (changed && current.metaStatus === "approved" && current.twilioContentSid && current.metaWabaId && current.metaTemplateBody && current.metaVariableMap
          && !history.some(v => v.revision === current.metaRevision)) {
        history.push({ revision: current.metaRevision, body: approvedBody(current), metaTemplateBody: current.metaTemplateBody,
          metaVariableMap: current.metaVariableMap, metaCategory: current.metaCategory ?? prepared.category,
          metaLanguage: current.metaLanguage ?? "pt_BR", contentSid: current.twilioContentSid, wabaId: current.metaWabaId });
      }
      const result = await tx.postSaleMessageTemplate.updateMany({ where: { ...where, metaStatus: current.metaStatus }, data: changed ? {
        body: input.whatsapp.body, metaTemplateBody: prepared.metaBody, metaVariableMap: prepared.variableMap,
        metaCategory: prepared.category, metaLanguage: "pt_BR", metaRevision: { increment: 1 },
        metaStatus: "draft", twilioContentSid: null, metaWabaId: null, metaApprovedVersions: history, metaRejectionReason: null,
        metaLastCheckedAt: null, metaClaimToken: null, metaNextCheckAt: new Date(), updatedAt: new Date(),
      } : { metaRevision: { increment: 1 }, updatedAt: new Date() } });
      if (result.count !== 1) throw new ConflictException("template_revision_conflict");
      await tx.postSaleMessageTemplate.update({
        where: { merchantId_type_channel: { merchantId, type, channel: "email" } },
        data: { body: input.email.body, subject: input.email.subject },
      });
    });
  }

  async due(now: Date): Promise<RecoveryLifecycleRecord[]> {
    return (this.prisma as any).postSaleMessageTemplate.findMany({
      where: { type: { in: [...WHATSAPP_TEMPLATE_TYPES] }, channel: "whatsapp", isActive: true, metaNextCheckAt: { lte: now } },
      orderBy: [{ metaNextCheckAt: "asc" }, { id: "asc" }], take: 50,
    });
  }

  async claim(record: RecoveryLifecycleRecord, now: Date, submitting: boolean): Promise<boolean> {
    const token = randomUUID();
    const prepared = submitting ? prepareSalesWhatsApp(record.type, record.body) : null;
    const result = await (this.prisma as any).postSaleMessageTemplate.updateMany({
      where: { id: record.id, merchantId: record.merchantId, metaRevision: record.metaRevision, metaStatus: record.metaStatus, metaNextCheckAt: record.metaNextCheckAt },
      data: { metaClaimToken: token, metaNextCheckAt: new Date(now.getTime() + 5 * 60_000), ...(prepared ? { metaStatus: "submitting", metaTemplateBody: prepared.metaBody, metaVariableMap: prepared.variableMap, metaCategory: prepared.category, metaLanguage: "pt_BR" } : {}) },
    });
    if (result.count === 1) record.metaClaimToken = token;
    return result.count === 1;
  }

  async complete(record: RecoveryLifecycleRecord, patch: { status: string; wabaId?: string; contentSid?: string | null; reason?: string | null; checkedAt?: Date; nextCheckAt: Date | null }, submitting: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const result = await tx.postSaleMessageTemplate.updateMany({
        where: { id: record.id, merchantId: record.merchantId, metaRevision: record.metaRevision, metaClaimToken: record.metaClaimToken, metaStatus: submitting ? "submitting" : record.metaStatus, twilioContentSid: record.twilioContentSid },
        data: { metaWabaId: patch.wabaId, metaStatus: patch.status, twilioContentSid: patch.contentSid, metaRejectionReason: patch.reason,
          metaLastCheckedAt: patch.checkedAt, metaNextCheckAt: patch.nextCheckAt, metaClaimToken: null },
      });
      if (result.count !== 1 || patch.status === record.metaStatus || !["approved", "rejected", "paused", "disabled"].includes(patch.status)) return;
      const approved = patch.status === "approved";
      const label = buildCatalog()[salesTemplateType(record.type)].label;
      await tx.merchantNotification.create({ data: {
        id: randomUUID(), merchantId: record.merchantId, type: record.type === "cart_recovery" ? "cart_recovery_template_status" : "post_sale_template_status",
        title: approved ? `Template ${label}: versão ${record.metaRevision} aprovada` : `Template ${label}: atualização da versão ${record.metaRevision}`,
        body: approved ? `A Meta aprovou a versão ${record.metaRevision}. Consulte o estado atual no painel de templates; edições posteriores exigem nova aprovação.`
          : `A versão ${record.metaRevision} ficou indisponível para envio no WhatsApp. A campanha usa e-mail quando autorizado e disponível. Consulte o estado atual no painel de templates.`,
        metadata: { revision: record.metaRevision, status: patch.status, contentSid: patch.contentSid ?? record.twilioContentSid, emailStatus: "pending", path: record.type === "cart_recovery" ? "/cart-recovery" : "/post-sale" },
      } });
    });
  }

  async restore(record: RecoveryLifecycleRecord, version: ApprovedTemplateVersion, checkedAt: Date): Promise<void> {
    const history = [...(record.metaApprovedVersions ?? [])];
    if (record.metaStatus === "approved" && record.twilioContentSid && record.metaWabaId && record.metaTemplateBody && record.metaVariableMap && !history.some(v => v.revision === record.metaRevision)) {
      history.push({ revision: record.metaRevision, body: approvedBody(record), metaTemplateBody: record.metaTemplateBody, metaVariableMap: record.metaVariableMap, metaCategory: record.metaCategory ?? version.metaCategory, metaLanguage: record.metaLanguage ?? "pt_BR", contentSid: record.twilioContentSid, wabaId: record.metaWabaId });
    }
    const result = await (this.prisma as any).postSaleMessageTemplate.updateMany({
      where: { id: record.id, merchantId: record.merchantId, metaRevision: record.metaRevision, metaStatus: record.metaStatus, metaClaimToken: record.metaClaimToken ?? null },
      data: { body: version.body, metaTemplateBody: version.metaTemplateBody, metaVariableMap: version.metaVariableMap,
        metaCategory: version.metaCategory, metaLanguage: version.metaLanguage, twilioContentSid: version.contentSid,
        metaWabaId: version.wabaId, metaApprovedVersions: history, metaStatus: "approved", metaRevision: { increment: 1 },
        metaRejectionReason: null, metaLastCheckedAt: checkedAt, metaNextCheckAt: checkedAt, metaClaimToken: null },
    });
    if (result.count !== 1) throw new ConflictException("template_revision_conflict");
  }

  async seedMerchantPage(afterId?: string): Promise<string | undefined> {
    const merchants = await (this.prisma as any).merchant.findMany({ where: afterId ? { id: { gt: afterId } } : {}, orderBy: { id: "asc" }, take: 5, select: { id: true } }) as { id: string }[];
    for (const merchant of merchants) {
      for (const type of WHATSAPP_TEMPLATE_TYPES) await this.ensure(merchant.id, type);
    }
    return merchants.length === 5 ? merchants.at(-1)?.id : undefined;
  }
}

function approvedBody(record: RecoveryLifecycleRecord): string {
  return (record.metaTemplateBody ?? record.body).replace(/\{\{(\d+)\}\}/g, (token, position: string) =>
    record.metaVariableMap?.[position] ? `{{${record.metaVariableMap[position]}}}` : token);
}
