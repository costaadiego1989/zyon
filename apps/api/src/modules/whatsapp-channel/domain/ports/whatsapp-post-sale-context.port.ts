export const WHATSAPP_POST_SALE_CONTEXT_PORT = Symbol("WHATSAPP_POST_SALE_CONTEXT_PORT");

export interface PostSaleContext {
  stage: "awaiting_nps" | "awaiting_review";
  orderId: string;
  productId?: string;
  buyerId: string;
  askedAt: string;
}

export interface WhatsAppPostSaleContextPort {
  setPostSaleContext(merchantId: string, buyerPhone: string, context: PostSaleContext): Promise<void>;
  clearPostSaleContext(merchantId: string, buyerPhone: string): Promise<void>;
}
