export const SHOPEE_TOKEN_PORT = Symbol("SHOPEE_TOKEN_PORT");
export interface ShopeeTokenPort { getValidAccessToken(merchantId: string, connectionId: string): Promise<string>; }
