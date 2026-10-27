export const POST_SALE_REPLY_HANDLER_PORT = Symbol("POST_SALE_REPLY_HANDLER_PORT");

export interface PostSaleReplyHandlerPort {
  handleNpsReply(input: { merchantId: string; buyerId: string; orderId?: string; score: number; feedback?: string }): Promise<void>;
  handleReviewReply(input: { merchantId: string; buyerId: string; productId: string; orderId?: string; text: string; rating?: number }): Promise<void>;
}
