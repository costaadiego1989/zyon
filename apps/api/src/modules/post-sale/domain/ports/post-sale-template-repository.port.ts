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
  // Meta/Twilio official template fields (business-initiated WhatsApp).
  metaCategory: string | null;
  metaLanguage: string | null;
  metaTemplateBody: string | null;
  metaVariableMap: Record<string, string> | null;
  twilioContentSid: string | null;
  metaStatus: string | null;
  metaRejectionReason: string | null;
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
  metaCategory?: string;
  metaLanguage?: string;
  metaTemplateBody?: string;
  metaVariableMap?: Record<string, string>;
}

export interface UpdateTemplateMetaInput {
  merchantId: string;
  type: string;
  channel: string;
  twilioContentSid?: string;
  metaStatus?: string;
  metaRejectionReason?: string | null;
}

export interface PostSaleTemplateRepositoryPort {
  findByMerchantAndType(merchantId: string, type: string, channel: string): Promise<PostSaleTemplate | null>;
  findAllByMerchant(merchantId: string): Promise<PostSaleTemplate[]>;
  upsert(input: UpsertTemplateInput): Promise<PostSaleTemplate>;
  updateMeta(input: UpdateTemplateMetaInput): Promise<PostSaleTemplate>;
}
