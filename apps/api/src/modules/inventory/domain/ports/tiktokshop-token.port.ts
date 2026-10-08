export const TIKTOKSHOP_TOKEN_PORT = Symbol("TIKTOKSHOP_TOKEN_PORT");

export interface TikTokShopTokenPort {
  getValidAccessToken(merchantId: string, connectionId: string): Promise<string>;
}
