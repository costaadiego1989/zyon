export const MERCHANT_GUIDE_SOURCES = Symbol("MERCHANT_GUIDE_SOURCES");
export interface MerchantGuideSource {
  kind: "merchant_help"; merchantId: string; audience: "merchant"; context: "cashback"; sourceType: "merchant_guide";
  id: string; version: number; active: boolean; chunks: Array<{ id: string; content: string }>;
}
/** Trusted reviewed sources only. No buyer data or model-supplied authority. */
export interface MerchantGuideSourcesPort {
  listMerchantGuides(merchantId: string): Promise<MerchantGuideSource[]>;
}
