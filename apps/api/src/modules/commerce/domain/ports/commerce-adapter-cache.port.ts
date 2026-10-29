export const COMMERCE_ADAPTER_CACHE_PORT = Symbol("COMMERCE_ADAPTER_CACHE_PORT");

export interface CommerceAdapterCachePort {
  invalidateAdapter(merchantId: string): void;
}
