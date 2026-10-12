export const TIKTOKSHOP_OAUTH_PORT = Symbol("TIKTOKSHOP_OAUTH_PORT");

export interface TikTokShopOAuthPort {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
  }>;
  getShopIdentity(accessToken: string, selectedShopId?: string): Promise<{ id: string; name: string; cipher: string }>;
}
