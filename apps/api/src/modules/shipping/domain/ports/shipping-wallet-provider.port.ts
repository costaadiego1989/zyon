export const SHIPPING_WALLET_PROVIDER = Symbol("SHIPPING_WALLET_PROVIDER");

export interface ShippingWalletProvider {
  location(): { base: string; environment: "test" | "live"; rechargeUrl: string };
  read(base: string, token: string): Promise<{ balanceCents: number; reservedCents: number; debtsCents: number }>;
  matchesCredential(encryptedAccessToken: string, resolvedToken: string): boolean;
}
