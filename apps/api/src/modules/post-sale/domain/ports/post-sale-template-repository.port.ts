export const POST_SALE_TEMPLATE_REPOSITORY = Symbol("POST_SALE_TEMPLATE_REPOSITORY");

export interface PostSaleTemplate {
  id: string;
  merchantId: string;
  type: string;
  channel: string;
  name: string;
  body: string;
  subject: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertTemplateInput {
  merchantId: string;
  type: string;
  channel: string;
  name: string;
  body: string;
  subject?: string;
}

export interface PostSaleTemplateRepositoryPort {
  findByMerchantAndType(merchantId: string, type: string, channel: string): Promise<PostSaleTemplate | null>;
  findAllByMerchant(merchantId: string): Promise<PostSaleTemplate[]>;
  upsert(input: UpsertTemplateInput): Promise<PostSaleTemplate>;
}
