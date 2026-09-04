export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export function computeStockStatus(
  quantity: number,
  reserved: number,
  lowStockThreshold?: number | null,
): StockStatus {
  const available = quantity - reserved;
  if (available <= 0) return "out_of_stock";
  if (lowStockThreshold != null && available <= lowStockThreshold) return "low_stock";
  return "in_stock";
}
