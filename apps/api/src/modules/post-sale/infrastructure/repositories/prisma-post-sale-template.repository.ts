import { Injectable, Inject } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PostSaleTemplateRepositoryPort, PostSaleTemplate, UpsertTemplateInput } from "../../domain/ports/post-sale-template-repository.port.js";

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
    const row = await (this.prisma as any).postSaleMessageTemplate.upsert({
      where: { merchantId_type_channel: { merchantId: input.merchantId, type: input.type, channel: input.channel } },
      update: {
        name: input.name,
        body: input.body,
        subject: input.subject || null,
        updatedAt: new Date(),
      },
      create: {
        id: require("cuid")(),
        merchantId: input.merchantId,
        type: input.type,
        channel: input.channel,
        name: input.name,
        body: input.body,
        subject: input.subject || null,
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: any): PostSaleTemplate {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      type: row.type,
      channel: row.channel,
      name: row.name,
      body: row.body,
      subject: row.subject,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
