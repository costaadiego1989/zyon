export function usesPrismaPurchaseHistory(): boolean {
  if (
    process.env.CHECKOUT_REPOSITORY === "in-memory" ||
    process.env.BUYER_PURCHASE_HISTORY_REPOSITORY === "in-memory"
  ) {
    return false;
  }
  return true;
}
