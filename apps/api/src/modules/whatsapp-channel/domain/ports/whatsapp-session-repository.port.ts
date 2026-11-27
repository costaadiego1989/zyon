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
  conversationState?: import("../ui/meta-ui.types.js").WhatsAppConversationState;
  createdAt: Date;
}

export interface WhatsAppSessionRepository {
  /** Production routing and handoff share this lock before expiry/creation. */
  withRoutingLock?<T>(identity: { merchantId: string; buyerPhone: string; deviceId: string }, work: (repository: WhatsAppSessionRepository, checkout: WhatsAppRoutingCheckoutWriter) => Promise<T>): Promise<T>;
  findActiveByPhone(merchantId: string, buyerPhone: string, deviceId?: string): Promise<WhatsAppSessionEntity | null>;
  create(data: Omit<WhatsAppSessionEntity, "id" | "createdAt">): Promise<WhatsAppSessionEntity>;
  renewExpiredNative(expected: WhatsAppSessionEntity): Promise<{ session: WhatsAppSessionEntity; renewed: boolean }>;
  update(id: string, data: Partial<WhatsAppSessionEntity>): Promise<WhatsAppSessionEntity>;
  expire(id: string): Promise<void>;
  updateMenuState(id: string, currentOptions: string[], previousOptions: string[], page: number): Promise<void>;
  setPostSaleContext(id: string, context: PostSaleContextData): Promise<void>;
  clearPostSaleContext(id: string): Promise<void>;
}

/** Narrow collaborator enlisted by the repository in the routing transaction.
 * It cannot create an independently committed checkout after the lock expires. */
export interface WhatsAppRoutingCheckoutInput {
  merchantId: string;
  sessionId: string;
  conversationId: string;
  globalUserId: string;
  customer: { phone: string; phone_verified: true; fullName: string | null; email: string | null;
    cpf: string | null; address: Record<string, string> | null };
  now: Date;
}
export type WhatsAppRoutingCheckoutWriter = (input: WhatsAppRoutingCheckoutInput) => Promise<void>;

