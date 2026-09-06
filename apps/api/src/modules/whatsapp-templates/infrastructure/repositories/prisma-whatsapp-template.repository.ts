import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type {
  WhatsAppTemplateRepositoryPort,
  WhatsAppTemplateRecord,
  UpsertWhatsAppTemplateInput,
  UpdateWhatsAppTemplateMetaInput,
} from "../../domain/ports/whatsapp-template-repository.port.js";

/**
 * Backed by the `postSaleMessageTemplate` table (kept for compatibility; now
 * the platform-wide WhatsApp template store). Scoped by merchantId+type+channel.
 */
@Injectable()
export class PrismaWhatsAppTemplateRepository implements WhatsAppTemplateRepositoryPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByMerchantAndType(merchantId: string, type: string, channel: string): Promise<WhatsAppTemplateRecord | null> {
    const row = await (this.prisma as any).postSaleMessageTemplate.findUnique({
      where: { merchantId_type_channel: { merchantId, type, channel } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findAllByMerchant(merchantId: string): Promise<WhatsAppTemplateRecord[]> {
    const rows = await (this.prisma as any).postSaleMessageTemplate.findMany({
      where: { merchantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r: any) => this.toDomain(r));
  }

  async upsert(input: UpsertWhatsAppTemplateInput): Promise<WhatsAppTemplateRecord> {
    const meta = {
      metaCategory: input.metaCategory ?? undefined,
      metaLanguage: input.metaLanguage ?? undefined,
      metaTemplateBody: input.metaTemplateBody ?? undefined,
      metaVariableMap: input.metaVariableMap ? (input.metaVariableMap as any) : undefined,
    };
    const row = await (this.prisma as any).postSaleMessageTemplate.upsert({
      where: { merchantId_type_channel: { merchantId: input.merchantId, type: input.type, channel: input.channel } },
      update: {
        name: input.name,
        body: input.body,
        subject: input.subject || null,
        ...meta,
        updatedAt: new Date(),
      },
      create: {
        merchantId: input.merchantId,
        type: input.type,
        channel: input.channel,
        name: input.name,
        body: input.body,
        subject: input.subject || null,
        ...meta,
      },
    });
    return this.toDomain(row);
  }

  async updateMeta(input: UpdateWhatsAppTemplateMetaInput): Promise<WhatsAppTemplateRecord> {
    const row = await (this.prisma as any).postSaleMessageTemplate.update({
      where: { merchantId_type_channel: { merchantId: input.merchantId, type: input.type, channel: input.channel } },
      data: {
        twilioContentSid: input.twilioContentSid ?? undefined,
        metaStatus: input.metaStatus ?? undefined,
        metaRejectionReason: input.metaRejectionReason === undefined ? undefined : input.metaRejectionReason,
        updatedAt: new Date(),
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: any): WhatsAppTemplateRecord {
    return {
      id: row.id,
      merchantId: row.merchantId ?? row.merchant_id,
      type: row.type,
      channel: row.channel,
      name: row.name,
      body: row.body,
      subject: row.subject ?? null,
      isActive: row.isActive ?? row.is_active,
      metaCategory: row.metaCategory ?? row.meta_category ?? null,
      metaLanguage: row.metaLanguage ?? row.meta_language ?? null,
      metaTemplateBody: row.metaTemplateBody ?? row.meta_template_body ?? null,
      metaVariableMap: (row.metaVariableMap ?? row.meta_variable_map ?? null) as Record<string, string> | null,
      twilioContentSid: row.twilioContentSid ?? row.twilio_content_sid ?? null,
      metaStatus: row.metaStatus ?? row.meta_status ?? null,
      metaRejectionReason: row.metaRejectionReason ?? row.meta_rejection_reason ?? null,
      metaRevision: row.metaRevision,
      metaLastCheckedAt: row.metaLastCheckedAt ?? null,
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    };
  }
}
