/**
 * Repository for per-merchant WhatsApp templates. Backed by the
 * `PostSaleMessageTemplate` table (kept for compatibility; conceptually now the
 * platform-wide WhatsApp template store, scoped by merchantId+type+channel).
 */
export const WHATSAPP_TEMPLATE_REPOSITORY = Symbol("WHATSAPP_TEMPLATE_REPOSITORY");

export interface WhatsAppTemplateRecord {
  id: string;
  merchantId: string;
  type: string;
  channel: string;
  name: string;
  body: string;
  subject: string | null;
  isActive: boolean;
  metaCategory: string | null;
  metaLanguage: string | null;
  metaTemplateBody: string | null;
  metaVariableMap: Record<string, string> | null;
  twilioContentSid: string | null;
  metaStatus: string | null;
  metaRejectionReason: string | null;
  metaRevision?: number;
  metaLastCheckedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertWhatsAppTemplateInput {
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

export interface UpdateWhatsAppTemplateMetaInput {
  merchantId: string;
  type: string;
  channel: string;
  twilioContentSid?: string;
  metaStatus?: string;
  metaRejectionReason?: string | null;
}

export interface WhatsAppTemplateRepositoryPort {
  findByMerchantAndType(merchantId: string, type: string, channel: string): Promise<WhatsAppTemplateRecord | null>;
  findAllByMerchant(merchantId: string): Promise<WhatsAppTemplateRecord[]>;
  upsert(input: UpsertWhatsAppTemplateInput): Promise<WhatsAppTemplateRecord>;
  updateMeta(input: UpdateWhatsAppTemplateMetaInput): Promise<WhatsAppTemplateRecord>;
}
