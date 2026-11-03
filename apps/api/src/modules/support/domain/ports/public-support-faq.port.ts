export const PUBLIC_SUPPORT_FAQ = Symbol("PUBLIC_SUPPORT_FAQ");
export interface PublicSupportFaqPort {
  snapshot(merchantId: string): Promise<{ merchantId: string; version: number;
    items: Array<{ id: string; question: string; answer: string }> }>;
}
