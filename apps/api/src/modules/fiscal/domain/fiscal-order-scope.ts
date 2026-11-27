export const FISCAL_ORDER_SCOPE_UNSUPPORTED = "fiscal_order_scope_unsupported";

/** Catalog origin does not grant another merchant authority to issue this order. */
export function isFiscalOrderScope(orderMerchantId: string, merchantIds: readonly string[]): boolean {
  return !!orderMerchantId.trim() && merchantIds.every(merchantId => merchantId === orderMerchantId);
}
