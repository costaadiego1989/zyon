/**
 * WhatsApp Session Repository Port — persistence for WA sessions.
 */

export const WHATSAPP_SESSION_REPOSITORY = Symbol("WhatsAppSessionRepository");

export interface PostSaleContextData {
  stage: "awaiting_nps" | "awaiting_review";
  orderId: string;
  productId?: string;
  buyerId: string;
  askedAt: string;
}

export interface WhatsAppSessionEntity {
  id: string;
  merchantId: string;
  buyerPhone: string;
  buyerAlias?: string;
  checkoutSessionId?: string;
  deviceId: string;
  currentOptions: string[];
  previousOptions: string[];
  currentPage: number;
  lastActivityAt: Date;
  status: "active" | "expired" | "handoff";
  postSaleContext?: PostSaleContextData;
  createdAt: Date;
}

export interface WhatsAppSessionRepository {
  findActiveByPhone(merchantId: string, buyerPhone: string): Promise<WhatsAppSessionEntity | null>;
  create(data: Omit<WhatsAppSessionEntity, "id" | "createdAt">): Promise<WhatsAppSessionEntity>;
  update(id: string, data: Partial<WhatsAppSessionEntity>): Promise<WhatsAppSessionEntity>;
  expire(id: string): Promise<void>;
  updateMenuState(id: string, currentOptions: string[], previousOptions: string[], page: number): Promise<void>;
  setPostSaleContext(id: string, context: PostSaleContextData): Promise<void>;
  clearPostSaleContext(id: string): Promise<void>;
}

