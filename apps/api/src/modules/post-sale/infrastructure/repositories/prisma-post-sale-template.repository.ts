import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type {
  PostSaleTemplateRepositoryPort,
  PostSaleTemplate,
  UpsertTemplateInput,
  UpdateTemplateMetaInput,
} from "../../domain/ports/post-sale-template-repository.port.js";

@Injectable()
export class PrismaPostSaleTemplateRepository implements PostSaleTemplateRepositoryPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async findByMerchantAndType(merchantId: string, type: string, channel: string): Promise<PostSaleTemplate | null> {
    const row = await (this.prisma as any).postSaleMessageTemplate.findUnique({
      where: { merchantId_type_channel: { merchantId, type, channel } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findAllByMerchant(merchantId: string): Promise<PostSaleTemplate[]> {
    const rows = await (this.prisma as any).postSaleMessageTemplate.findMany({
      where: { merchantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row: any) => this.toDomain(row));
  }

  async upsert(input: UpsertTemplateInput): Promise<PostSaleTemplate> {
    const metaFields = {
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
        ...metaFields,
        updatedAt: new Date(),
      },
      create: {
        // id omitted — schema uses @default(cuid()), Prisma generates it.
        merchantId: input.merchantId,
        type: input.type,
        channel: input.channel,
        name: input.name,
        body: input.body,
        subject: input.subject || null,
        ...metaFields,
      },
    });
    return this.toDomain(row);
  }

  async updateMeta(input: UpdateTemplateMetaInput): Promise<PostSaleTemplate> {
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

  private toDomain(row: any): PostSaleTemplate {
    // Accept both Prisma camelCase and raw snake_case defensively.
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
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
    };
  }
}
